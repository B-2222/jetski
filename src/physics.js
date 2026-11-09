// Jet ski rigid-body physics. No rendering code here so it can be tested in Node.
//
// Model summary (see RESEARCH.md section 7):
//  * One 6-DOF rigid body. Mass = hull + fuel + rider. The rider is a mass that
//    moves inside the body frame, so leaning shifts the centre of gravity.
//  * The hull bottom is sampled by a grid of points. Each point carries:
//      - a buoyancy prism (floats the ski, gives roll/pitch stability at rest)
//      - planing pressure  p = 0.5 rho Cp |u| (u . n)  on the bottom normal n
//        (lift grows with speed and trim angle, Savitsky-style, and makes the
//         hull climb onto the plane)
//      - skin friction and a little linear damping
//  * Keel, pump housing and sponsons are small foils with a stall angle. When
//    the slip angle passes the stall the stern lets go: that is the powerslide.
//  * Jet pump: thrust = k rpm^2 (1 - V/Vjet), applied at the nozzle in the
//    nozzle direction (steering angle, VTS trim angle, iBR reverse bucket).
//    Pump only works while the intake is in the water: in the air the load
//    disappears and the engine flies to the rev limiter.
//  * Engine: torque curve, pump load ~ rpm^2, rev limiter, idle control,
//    riding modes, ECU speed limiter, launch control, off-throttle steering assist.

import { G } from './waves.js';
import { RIDING_MODES, TRIM_RANGES } from './craft.js';

const RHO = 1000;
const RHO_AIR = 1.2;
const DEG = Math.PI / 180;
const FUEL_DENSITY = 0.74;  // kg/L petrol
const REV_EFF = 0.68;
const SELF_WAKE_AGE = 1.2;
const NEUTRAL = 1 / (1 + 0.78 * REV_EFF); // bucket position where forward and reverse thrust cancel

// ---------- tiny vector / quaternion helpers ----------
export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  len() { return Math.hypot(this.x, this.y, this.z); }
  crossVectors(a, b) {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z; return this;
  }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z, this.w) || 1; this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this; }
  setFromAxisAngle(ax, ay, az, a) { const s = Math.sin(a / 2); return this.set(ax * s, ay * s, az * s, Math.cos(a / 2)); }
  multiply(b) { // this = this * b
    const a = this;
    const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    return this.set(x, y, z, w);
  }
  // rotate body vector v into out (world)
  rotate(v, out) {
    const { x, y, z, w } = this;
    const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z;
    const iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
    out.x = ix * w + iw * -x + iy * -z - iz * -y;
    out.y = iy * w + iw * -y + iz * -x - ix * -z;
    out.z = iz * w + iw * -z + ix * -y - iy * -x;
    return out;
  }
  // rotate world vector v into body frame
  unrotate(v, out) {
    this.x = -this.x; this.y = -this.y; this.z = -this.z;
    this.rotate(v, out);
    this.x = -this.x; this.y = -this.y; this.z = -this.z;
    return out;
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const approach = (cur, target, rate, dt) => {
  const d = target - cur, m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
};

// ---------- the ski ----------
export class Ski {
  constructor(craft, ocean) {
    this.ocean = ocean;
    this.tmp = { h: 0, dhdt: 0 };
    this.setCraft(craft);
  }

  setCraft(craft) {
    this.craft = craft;
    this.trimRangeKey = craft.trimRanges[0];
    this.buildHull();
    this.reset(0, 0, 0);
  }

  // ---------------- hull definition ----------------
  // u = 0 at the transom, 1 at the bow tip
  keelY(u) {
    // flat run aft, rocker rising into the bow
    if (u < 0.55) return -0.30 + 0.02 * u;
    const r = (u - 0.55) / 0.45;
    return -0.289 + 0.46 * r * r;
  }
  halfChine(u) {
    const hb = this.craft.chineBeam / 2;
    if (u < 0.62) return hb * (0.9 + 0.1 * Math.sin((u / 0.62) * Math.PI / 2));
    const r = (u - 0.62) / 0.38;
    return hb * Math.max(0.05, Math.cos(r * Math.PI / 2) ** 0.8);
  }
  chineY(u) { return this.keelY(u) + this.halfChine(u) * Math.tan(this.deadriseAt(u)); }
  deadriseAt(u) {
    const d = this.craft.deadrise;
    return (u < 0.45 ? d : d + (u - 0.45) * 2.0 * 16) * DEG;
  }

  buildHull() {
    const c = this.craft, L = c.length;
    this.L = L;
    this.zStern = -L / 2;
    const NZ = 12, NT = 4;
    const pts = [];
    const dzSt = (L - 0.12) / NZ;
    for (let i = 0; i < NZ; i++) {
      const z = this.zStern + 0.06 + (i + 0.5) * dzSt;
      const u = (z - this.zStern) / L;
      const ky = this.keelY(u);
      const kyF = this.keelY(Math.min(1, u + 0.01));
      const slope = (kyF - ky) / (0.01 * L);             // dy/dz along the keel
      const hc = this.halfChine(u);
      const beta = this.deadriseAt(u);
      for (let j = -NT; j <= NT; j++) {
        const t = j / NT;                                    // -1 .. 1 (left is +x)
        const x = t * hc;
        const y = ky + Math.abs(x) * Math.tan(beta);
        // outward (downward) normal of surface y = ky(z) + |x| tan(beta)
        const fx = Math.sign(x) * Math.tan(beta), fz = slope;
        let nx = fx, ny = -1, nz = fz;
        if (j === 0) nx = 0;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        const w = (j === -NT || j === NT || j === 0) ? 0.5 : 1;
        const areaPlan = dzSt * (hc / NT) * w * (j === 0 ? 2 : 1);
        const areaSurf = areaPlan / Math.abs(ny);
        // prism height up to the deck (tall in the middle, low at the rails)
        const deckY = 0.16 + 0.24 * (1 - Math.abs(t)) + (u > 0.75 ? (u - 0.75) * 0.8 : 0);
        pts.push({
          pos: new V3(x, y, z), n: new V3(nx, ny, nz), areaPlan, areaSurf,
          hmax: Math.max(0.08, deckY - y), u, t, chine: Math.abs(j) === NT,
        });
      }
      // side flare above the chine out to the full beam (adds waterplane width = roll stability)
      const flare = Math.max(0.02, (this.craft.beam / 2 - hc) * (u < 0.7 ? 1 : Math.max(0, 1 - (u - 0.7) / 0.3)));
      if (flare > 0.025) {
        for (const sgn of [-1, 1]) {
          const yC = ky + hc * Math.tan(beta);
          const nx = sgn * 0.82, ny = -0.57;
          const areaPlan = dzSt * flare;
          pts.push({
            pos: new V3(sgn * (hc + flare * 0.5), yC + 0.05, z), n: new V3(nx, ny, 0), areaPlan,
            areaSurf: areaPlan / 0.57, hmax: Math.max(0.08, 0.2 - 0.05), u, t: sgn * 1.2, chine: false, flare: true,
          });
        }
      }
    }
    this.bottom = pts;

    // upper hull: sides and bow deck. Only pressure/drag, no buoyancy (prisms already cover it).
    const upper = [];
    for (let i = 0; i < 8; i++) {
      const u = 0.08 + i * 0.11;
      const z = this.zStern + u * L;
      const hc = this.halfChine(u) + 0.06;
      for (const s of [-1, 1]) {
        upper.push({ pos: new V3(s * hc, 0.02 + (u > 0.75 ? (u - 0.75) * 0.5 : 0), z), n: new V3(s, 0.05, 0), area: 0.11 * L / 3.3 });
      }
    }
    for (let i = 0; i < 4; i++) { // bow deck and nose cone
      const u = 0.74 + i * 0.075;
      const z = this.zStern + u * L;
      upper.push({ pos: new V3(0, 0.28 + (u - 0.74) * 0.3, z), n: new V3(0, 0.78, 0.62), area: 0.14 * L / 3.3 });
    }
    this.upper = upper;

    // lateral foils (keel strakes, pump housing / ride plate, sponsons)
    const ys = this.keelY(0.03);
    const hcs = this.halfChine(0.08);
    const betaS = this.deadriseAt(0.08);
    const sponY = ys + hcs * Math.tan(betaS) - c.sponsonDrop + 0.01;
    this.fins = [
      { name: 'pump', pos: new V3(0, ys - 0.03, this.zStern + 0.18), area: c.pumpArea, depth: 0.08 },
      // hull side force: concentrated aft, where a planing hull is actually in the water
      { name: 'hullStern', pos: new V3(0, 0, this.zStern + 0.12 * L), area: c.keelArea * 0.7, depth: 0.1, probe: this.keelY(0.12) },
      { name: 'hullAft', pos: new V3(0, 0, this.zStern + 0.3 * L), area: c.keelArea, depth: 0.1, probe: this.keelY(0.3) },
      { name: 'hullMid', pos: new V3(0, 0, this.zStern + 0.5 * L), area: c.keelArea * 1.1, depth: 0.1, probe: this.keelY(0.5) },
      { name: 'hullFwd', pos: new V3(0, 0, this.zStern + 0.7 * L), area: c.keelArea * 0.7, depth: 0.1, probe: this.keelY(0.7) },
      { name: 'sponsonL', pos: new V3(hcs + 0.03, sponY, this.zStern + 0.3), area: c.sponsonArea, depth: 0.07, side: 1 },
      { name: 'sponsonR', pos: new V3(-hcs - 0.03, sponY, this.zStern + 0.3), area: c.sponsonArea, depth: 0.07, side: -1 },
    ];

    this.intakePos = new V3(0, this.keelY(0.2) + 0.01, this.zStern + 0.2 * L);
    this.nozzlePos = new V3(0, ys + 0.1, this.zStern - 0.14);
    this.bowPos = new V3(0, this.keelY(1) + 0.05, this.zStern + L);
    this.riderSeat = new V3(0, 0.74, -0.34 * L / 3.3);    // seated rider CG (est)
    this.footwell = new V3(0.36, 0.20, 0.05);
    this.wakePoint = new V3(0, ys + 0.1, this.zStern + 0.15);
    this.cgFuel = new V3(0, 0.05, 0.35);
  }

  // ---------------- state ----------------
  reset(x, z, heading) {
    this.pos = new V3(x, 0, z);          // world CG position
    this.vel = new V3();
    this.q = new Quat().setFromAxisAngle(0, 1, 0, heading || 0);
    this.w = new V3();                   // angular velocity (world)
    this.fuelL = this.craft.fuelCapacityL * 0.9;
    this.riderOn = true;
    this.riderMass = 80;
    this.rider = this.riderSeat.clone();
    this.riderVel = new V3();
    this.cgLocal = new V3();
    this.origin = new V3();
    this.rpm = this.craft.rpmIdle;
    this.engineOn = true;
    this.limiterCut = false;
    this.throttle = 0; this.demand = 0;
    this.steer = 0;
    this.trim = 0; this.trimTarget = 0;
    this.bucket = NEUTRAL; this.gear = 'N';
    this.lever = 0;
    this.iBRcut = 0;
    this.mode = 'sport';
    this.launchArmed = false; this.launchActive = false;
    this.speedLimiterOn = true;
    this.waterFrac = 1; this.cav = 1;
    this.otas = 0;
    this.thrust = 0;
    this.input = { throttle: 0, lever: 0, steer: 0, leanX: 0, leanZ: 0, stand: 0, trimUp: 0, trimDown: 0 };
    this.stats = {};
    this.accFilt = new V3();
    this.prevVel = new V3();
    this.ejectReason = null;
    this.airTime = 0;
    this.wakeTimer = 0;
    this.time = 0;
    this.updateMass();
    // drop it so it floats near the surface
    this.pos.y = this.ocean.height(x, z) + 0.12;
    this.updateOrigin();
  }

  get trimRange() { return TRIM_RANGES[this.trimRangeKey]; }

  cycleTrimRange() {
    const list = this.craft.trimRanges;
    this.trimRangeKey = list[(list.indexOf(this.trimRangeKey) + 1) % list.length];
    const r = this.trimRange;
    this.trimTarget = clamp(this.trimTarget, r.min, r.max);
  }

  updateMass() {
    const c = this.craft;
    const mFuel = this.fuelL * FUEL_DENSITY;
    const mR = this.riderOn ? this.riderMass : 0;
    this.mass = c.massBase + mFuel + mR;
    const cg = new V3(...c.cgBase).scale(c.massBase)
      .addScaled(this.cgFuel, mFuel)
      .addScaled(this.rider, mR)
      .scale(1 / this.mass);
    // inertia about the combined CG (diagonal only)
    // craft.inertia = [roll, yaw, pitch]; body axes: roll about z, yaw about y, pitch about x
    let Ix = c.inertia[2], Iy = c.inertia[1], Iz = c.inertia[0];
    const add = (m, p) => {
      const dx = p.x - cg.x, dy = p.y - cg.y, dz = p.z - cg.z;
      Ix += m * (dy * dy + dz * dz); Iy += m * (dx * dx + dz * dz); Iz += m * (dx * dx + dy * dy);
    };
    add(c.massBase, new V3(...c.cgBase));
    add(mFuel, this.cgFuel);
    if (mR) { add(mR, this.rider); Ix += 6; Iy += 4; Iz += 5; } // rider's own body inertia
    this.I = new V3(Ix, Iy, Iz);
    // keep the world CG fixed when mass moves inside the ski (internal forces only)
    if (this.cgLocal) this.cgLocal.copy(cg); else this.cgLocal = cg;
  }

  updateOrigin() {
    const r = new V3();
    this.q.rotate(this.cgLocal, r);
    this.origin.copy(this.pos).sub(r);
  }

  // world position of a body-frame point
  toWorld(p, out) { this.q.rotate(p, out); return out.add(this.origin); }
  dirToWorld(d, out) { return this.q.rotate(d, out); }

  // ---------------- controls ----------------
  updateControls(dt) {
    const c = this.craft, inp = this.input;
    const mode = RIDING_MODES[this.mode];
    const fwdSpeed = this.stats.fwdSpeed || 0;

    // handlebars
    this.steer = approach(this.steer, clamp(inp.steer, -1, 1), 5.5, dt);

    // VTS trim motor
    const r = this.trimRange;
    const rate = this.trimRangeKey === 'max' ? 9 : 5.5;  // deg/s
    if (inp.trimUp) this.trimTarget = clamp(this.trimTarget + rate * dt, r.min, r.max);
    if (inp.trimDown) this.trimTarget = clamp(this.trimTarget - rate * dt, r.min, r.max);
    if (inp.trimFullUp) { this.trimTarget = r.max; inp.trimFullUp = 0; }
    if (inp.trimNeutral) { this.trimTarget = 0; inp.trimNeutral = 0; }

    // launch control: trim fully down from a standstill, back up as speed builds
    let trimGoal = this.trimTarget;
    if (this.launchArmed && c.hasLaunchControl) {
      if (!this.launchActive && fwdSpeed < 1.5 && inp.throttle > 0.5) this.launchActive = true;
      if (this.launchActive) {
        trimGoal = fwdSpeed < 14 ? r.min : this.trimTarget;
        if (fwdSpeed > 20) { this.launchActive = false; this.launchArmed = false; }
      }
    }
    this.trim = approach(this.trim, trimGoal, rate, dt);

    // iBR lever / gear logic
    this.lever = approach(this.lever, clamp(inp.lever, 0, 1), 6, dt);
    if (!this.engineOn) { this.gear = 'N'; }
    else if (inp.lever > 0.05) {
      if (this.gear !== 'R') { this.gear = 'R'; this.iBRcut = 0.22; }
    } else if (inp.throttle > 0.05) {
      if (this.gear === 'R') this.iBRcut = 0.18;
      this.gear = 'F';
    } else if (this.gear === 'R') {
      this.gear = fwdSpeed > 2 ? 'F' : 'N';
    }
    const bucketGoal = this.gear === 'R' ? 1 : this.gear === 'N' ? NEUTRAL : 0;
    this.bucket = approach(this.bucket, bucketGoal, 3.2, dt);
    this.iBRcut = Math.max(0, this.iBRcut - dt);

    // throttle by wire: riding-mode map and response rate
    const thr = clamp(inp.throttle, 0, 1);
    this.throttle = approach(this.throttle, thr, mode.response, dt);
    let demand;
    if (this.gear === 'R') {
      // reverse/brake: power follows lever pressure. More allowed while still moving fast (braking).
      const maxRev = fwdSpeed > 4 ? 0.75 : 0.42;
      demand = this.lever * maxRev;
    } else if (this.gear === 'N') {
      demand = 0;
    } else {
      demand = Math.pow(this.throttle, mode.curve);
    }
    // off-throttle assisted steering (iTC): a little power when you turn with the throttle shut
    if (this.gear === 'F' && thr < 0.05 && Math.abs(inp.steer) > 0.6 && fwdSpeed > 4) {
      this.otas = Math.min(this.otas + dt, 2.5);
      if (this.otas < 2.5) demand = Math.max(demand, 0.22);
    } else if (thr > 0.05 || Math.abs(inp.steer) < 0.3) this.otas = 0;
    // brake engagement: power briefly cut while the bucket swings
    if (this.iBRcut > 0) demand = 0;
    // launch control: hold the pump on the edge of cavitation
    if (this.launchActive) {
      const rf = this.rpm / c.rpmLimit;
      const allowed = 0.6 + fwdSpeed / 13;
      if (rf > allowed) demand = Math.min(demand, Math.max(0.25, 1 - (rf - allowed) * 6));
    }
    // ECU speed limiter (65 mph + tolerance agreement)
    if (this.speedLimiterOn && fwdSpeed > c.speedLimit - 0.6) {
      demand *= clamp(1 - (fwdSpeed - (c.speedLimit - 0.6)) * 0.9, 0.0, 1);
    }
    if (!this.engineOn || this.fuelL <= 0) demand = 0;
    this.demand = demand;
    this.rpmCap = c.rpmLimit * (this.gear === 'F' ? mode.rpmCap : 1);

    // rider body
    if (this.riderOn) {
      const stand = clamp(inp.stand, 0, 1);
      const sc = this.L / 3.3;
      const tx = -clamp(inp.leanX, -1, 1) * (0.27 + 0.08 * stand);   // right lean = -x
      const tz = this.riderSeat.z + clamp(inp.leanZ, -1, 1) * 0.36 * sc + stand * 0.2 * sc;
      const ty = this.riderSeat.y + stand * 0.33 - Math.abs(inp.leanX) * 0.06;
      // critically damped spring toward the target pose
      const k = 90, d = 19;
      this.riderVel.x += ((tx - this.rider.x) * k - this.riderVel.x * d) * dt;
      this.riderVel.y += ((ty - this.rider.y) * k - this.riderVel.y * d) * dt;
      this.riderVel.z += ((tz - this.rider.z) * k - this.riderVel.z * d) * dt;
      this.rider.addScaled(this.riderVel, dt);
    }
  }

  // ---------------- engine & pump ----------------
  torqueCurve(rpm) {
    // supercharged: strong mid range, gentle fall above peak power
    const c = this.craft;
    const peakT = (c.powerKW * 1000) / (c.rpmPeakPower * Math.PI / 30) * 1.04;
    const x = rpm / c.rpmPeakPower;
    const shape = x < 0.7 ? 0.55 + 0.45 * Math.sin((x / 0.7) * Math.PI / 2) : 1.0 - 0.18 * (x - 0.7) * (x - 0.7) / 0.09 * 0.25;
    return peakT * clamp(shape, 0.3, 1);
  }

  // ---------------- main step ----------------
  step(dt) {
    const c = this.craft, oc = this.ocean;
    this.time += dt;
    const q = this.q;
    this.updateOrigin();

    const F = new V3(0, -this.mass * G, 0);
    const T = new V3();
    const tmpW = new V3(), tmpN = new V3(), tmpV = new V3(), tmpR = new V3(), tmpF = new V3(), tmpB = new V3();
    const s = this.tmp;
    const cgW = this.pos;
    const vcg = this.vel, w = this.w;

    // body axes in world
    const fwd = q.rotate(new V3(0, 0, 1), new V3());
    const up = q.rotate(new V3(0, 1, 0), new V3());
    const left = q.rotate(new V3(1, 0, 0), new V3());
    const pointVel = (pw, out) => {
      tmpR.copy(pw).sub(cgW);
      out.crossVectors(w, tmpR).add(vcg);
      return out;
    };
    const dbg = this.debug ? (this.dbg = {}) : null;
    let cat = '';
    const apply = (f, pw) => {
      F.add(f);
      tmpR.copy(pw).sub(cgW);
      tmpB.crossVectors(tmpR, f);
      T.add(tmpB);
      if (dbg) {
        const e = dbg[cat] || (dbg[cat] = { roll: 0, yaw: 0, pitch: 0, lat: 0 });
        e.roll += tmpB.dot(fwdD); e.yaw += tmpB.dot(upD); e.pitch += tmpB.dot(leftD); e.lat += f.dot(leftD);
      }
    };

    const fwdD = fwd, upD = up, leftD = left;
    const fwdSpeed = vcg.dot(fwd);
    const horizSpeed = Math.hypot(vcg.x, vcg.z);

    // ---- hull bottom: buoyancy + planing pressure + friction ----
    let wetArea = 0, wetPts = 0, submergedVol = 0, chineL = 0, chineR = 0, bowWet = 0;
    let wetZmin = 99, wetZmax = -99;
    const Cp = 1.15, Cf = 0.0042, cLin = 650, latK = c.hullLatGrip;
    const top = new V3();
    const latDir = left;
    for (const p of this.bottom) {
      this.toWorld(p.pos, tmpW);
      oc.sample(tmpW.x, tmpW.z, s, SELF_WAKE_AGE);
      const h = s.h;
      // buoyancy prism along the body up axis
      top.copy(up).scale(p.hmax).add(tmpW);
      const y0 = tmpW.y, y1 = top.y;
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      let frac = hi - lo > 1e-4 ? (h - lo) / (hi - lo) : (h > lo ? 1 : 0);
      frac = clamp(frac, 0, 1);
      if (frac > 0) {
        const vol = p.areaPlan * p.hmax * frac;
        submergedVol += vol;
        // centre of the submerged part of the prism
        const lowEnd = y0 < y1 ? tmpW : top, highEnd = y0 < y1 ? top : tmpW;
        tmpN.copy(highEnd).sub(lowEnd).scale(frac * 0.5).add(lowEnd);
        tmpF.set(0, RHO * G * vol, 0);
        cat = 'buoy'; apply(tmpF, tmpN);
      }
      const depth = h - y0;
      if (depth > 0) {
        q.rotate(p.n, tmpN);
        pointVel(tmpW, tmpV);
        const wet = Math.min(1, depth / (0.03 + 0.004 * horizSpeed));
        tmpV.y -= s.dhdt;
        const un = tmpV.dot(tmpN);
        const spd = tmpV.len();
        let fp = 0;
        if (un > 0) fp += 0.5 * RHO * Cp * p.areaSurf * spd * un * wet;
        fp += cLin * p.areaSurf * un * wet;
        tmpF.copy(tmpN).scale(-fp);
        // the V bottom resists sideways slip less than a flat plate would
        const lat = tmpF.dot(latDir);
        tmpF.addScaled(latDir, -lat * (1 - latK));
        // skin friction
        tmpB.copy(tmpN).scale(un);
        const vt = tmpV.sub(tmpB);
        const vtl = vt.len();
        tmpF.addScaled(vt, -0.5 * RHO * Cf * p.areaSurf * vtl * wet);
        cat = p.flare ? 'flare' : 'bottom'; apply(tmpF, tmpW);
        wetArea += p.areaSurf * wet; wetPts++;
        if (p.u < wetZmin) wetZmin = p.u; if (p.u > wetZmax) wetZmax = p.u;
        if (p.chine) { if (p.t > 0) chineL += wet; else chineR += wet; }
        if (p.u > 0.75) bowWet += wet;
      }
    }

    // ---- upper hull (sides / deck): drag when they dig in ----
    let deckWet = 0;
    for (const p of this.upper) {
      this.toWorld(p.pos, tmpW);
      const h = oc.height(tmpW.x, tmpW.z, SELF_WAKE_AGE);
      const depth = h - tmpW.y;
      if (depth <= 0) continue;
      const wet = Math.min(1, depth / 0.08);
      q.rotate(p.n, tmpN);
      pointVel(tmpW, tmpV);
      const un = tmpV.dot(tmpN);
      if (un > 0) {
        const fp = 0.5 * RHO * 1.0 * p.area * tmpV.len() * un * wet;
        tmpF.copy(tmpN).scale(-fp);
        cat = 'upper'; apply(tmpF, tmpW);
      }
      // general drag of a submerged deck
      tmpF.copy(tmpV).scale(-0.5 * RHO * 0.25 * p.area * tmpV.len() * wet);
      apply(tmpF, tmpW);
      if (p.n.y > 0.5) deckWet += wet;
    }

    // ---- lateral foils (keel, pump housing, sponsons) with stall ----
    let finGrip = 0, finStall = 0, slipSum = 0;
    for (const f of this.fins) {
      let depth;
      if (f.probe !== undefined) {
        // immersion tested at the keel, force applied at the hull's centre of side pressure
        tmpN.set(f.pos.x, f.probe, f.pos.z); this.toWorld(tmpN, tmpW);
        depth = oc.height(tmpW.x, tmpW.z, SELF_WAKE_AGE) - tmpW.y;
        tmpN.set(f.pos.x, this.cgLocal.y - c.sideForceDrop, f.pos.z);
        this.toWorld(tmpN, tmpW);
      } else {
        this.toWorld(f.pos, tmpW);
        depth = oc.height(tmpW.x, tmpW.z, SELF_WAKE_AGE) - tmpW.y;
      }
      if (depth <= 0) { f.sub = 0; continue; }
      const sub = Math.min(1, depth / f.depth);
      f.sub = sub;
      pointVel(tmpW, tmpV);
      const vx = tmpV.dot(left), vz = tmpV.dot(fwd);
      const sp2 = vx * vx + vz * vz;
      if (sp2 < 0.04) continue;
      const a = Math.atan2(Math.abs(vx), Math.abs(vz));      // slip angle at this foil
      const aStall = 15 * DEG, CLa = 3.4;
      let cl;
      if (a < aStall) cl = CLa * a;
      else cl = Math.max(CLa * aStall * (0.42 + 0.58 * Math.exp(-(a - aStall) / (8 * DEG))), 0.3 * Math.sin(2 * a));
      const q2 = 0.5 * RHO * sp2 * f.area * sub;
      const latF = -Math.sign(vx) * q2 * cl;
      const cd = 0.04 + cl * cl / 1.6 + (a > aStall ? 1.2 * Math.sin(a) ** 2 : 0);
      const sp = Math.sqrt(sp2);
      tmpF.copy(left).scale(latF);
      tmpF.addScaled(left, -vx / sp * q2 * cd);
      tmpF.addScaled(fwd, -vz / sp * q2 * cd);
      cat = 'fin:' + f.name; apply(tmpF, tmpW);
      finGrip += Math.abs(latF);
      if (a > aStall && sp > 4) finStall += sub;
      if (f.name === 'pump') slipSum = a;
    }

    // ---- wave-making drag (displacement hump) ----
    const Fr = horizSpeed / Math.sqrt(G * this.L);
    const immersion = clamp(submergedVol / (this.mass / RHO), 0, 1.2);
    if (horizSpeed > 0.3 && immersion > 0.05) {
      const hump = Math.exp(-(((Fr - 0.72) / 0.36) ** 2)) * 0.11 + 0.02 * smooth(0, 0.4, Fr);
      const dragW = this.mass * G * hump * immersion * smooth(1.6, 0.9, Fr);
      tmpF.set(-vcg.x / horizSpeed * dragW, 0, -vcg.z / horizSpeed * dragW);
      tmpW.copy(cgW); tmpW.y -= 0.1;
      apply(tmpF, tmpW);
    }

    // ---- air drag on ski + rider ----
    const vlen = vcg.len();
    if (vlen > 0.1) {
      const CdA = this.riderOn ? 0.78 + 0.15 * clamp(this.input.stand, 0, 1) : 0.45;
      tmpF.copy(vcg).scale(-0.5 * RHO_AIR * CdA * vlen);
      this.toWorld(new V3(0, 0.55, 0), tmpW);
      apply(tmpF, tmpW);
    }

    // ---- jet pump & engine ----
    this.toWorld(this.intakePos, tmpW);
    const intakeDepth = oc.height(tmpW.x, tmpW.z, SELF_WAKE_AGE) - tmpW.y;
    const wfTarget = smooth(-0.03, 0.06, intakeDepth);
    this.waterFrac = approach(this.waterFrac, wfTarget, wfTarget > this.waterFrac ? 7 : 30, dt);
    const wf = this.waterFrac;

    const omega = this.rpm * Math.PI / 30;
    const omegaTop = c.rpmLimit * Math.PI / 30;
    const kt = c.staticThrust / (omegaTop * omegaTop * 0.93 * 0.93);
    const vj = c.jetSpeedTop * omega / omegaTop;
    const inflow = Math.max(0, fwdSpeed);
    const rf = this.rpm / c.rpmLimit;
    // cavitation: high rpm with little inflow (hard launch). Pump slips and unloads.
    const cavAmt = smooth(0, 0.25, rf - (0.62 + inflow / 14)) * wf;
    this.cav = 1 - c.cavitation * cavAmt;
    const unload = 1 - 0.22 * clamp(inflow / Math.max(vj, 1), 0, 1);
    // pump torque balances engine torque at about 93% of the limiter in still water
    const peakTq = this.torqueCurve(c.rpmLimit * 0.93);
    const kq = peakTq / (omegaTop * omegaTop * 0.93 * 0.93);
    const Qp = kq * omega * omega * (0.04 + 0.96 * wf) * unload * (1 - 0.5 * c.cavitation * cavAmt);
    const Qf = 4 + 0.012 * omega;
    let Te = 0;
    if (this.engineOn && this.fuelL > 0) {
      Te = this.torqueCurve(this.rpm) * this.demand;
      const idleOmega = c.rpmIdle * Math.PI / 30;
      if (omega < idleOmega * 1.15) Te += Math.max(0, (idleOmega * 1.15 - omega) * 1.6);
      if (this.rpm > this.rpmCap) this.limiterCut = true;
      if (this.limiterCut && this.rpm < this.rpmCap - 140) this.limiterCut = false;
      if (this.limiterCut) Te = 0;
    }
    let newOmega = omega + (Te - Qp - Qf) / c.engineInertia * dt;
    if (newOmega < 0) newOmega = 0;
    this.rpm = newOmega * 30 / Math.PI;
    if (!this.engineOn && this.rpm < 300) this.rpm = 0;

    let thrust = kt * omega * omega * wf * this.cav * (1 - inflow / Math.max(vj, 0.5));
    thrust = Math.max(thrust, -0.25 * kt * omega * omega * wf);
    this.thrust = thrust;
    this.jetSpeed = vj;

    // nozzle direction in body frame: steering yaw, VTS pitch, iBR bucket
    const delta = this.steer * 21 * DEG;
    const tr = this.trim * DEG;
    let dx = Math.sin(delta) * Math.cos(tr);
    let dy = -Math.sin(tr);
    let dz = Math.cos(delta) * Math.cos(tr);
    const b = this.bucket;
    // with the bucket down the jet is turned forward and down under the hull
    dz = dz * (1 - b) + b * (-0.78 * REV_EFF);
    dy = dy * (1 - b) + b * (0.22 * REV_EFF);
    dx = dx * (1 - b * 0.25);
    const dirBody = new V3(dx, dy, dz);
    this.nozzleDirBody = dirBody;
    q.rotate(dirBody, tmpN);
    this.toWorld(this.nozzlePos, tmpW);
    this.nozzleWorld = tmpW.clone();
    tmpF.copy(tmpN).scale(thrust);
    cat = 'jet'; apply(tmpF, tmpW);
    const nozzleWaterH = oc.height(tmpW.x, tmpW.z, SELF_WAKE_AGE);
    this.nozzleDepth = nozzleWaterH - tmpW.y;

    // ---- rider "body english": knees and feet push the hull ----
    if (this.riderOn) {
      const lx = clamp(this.input.leanX, -1, 1);
      // right lean = roll to the right = positive rotation about the forward axis
      tmpB.copy(fwd).scale(lx * 160);
      T.add(tmpB);
      const airborne = wetPts === 0;
      if (airborne) { // small pitch control in the air (rider shifting body)
        tmpB.copy(left).scale(clamp(this.input.leanZ, -1, 1) * 140); // lean forward = nose down
        T.add(tmpB);
      }
    }

    // ---- hydrodynamic roll and yaw damping of the wetted hull (grows with speed) ----
    if (wetPts > 0) {
      const wetFrac = clamp(wetArea / 1.2, 0, 1);
      const rollRate = w.dot(fwd), yawRate = w.dot(up);
      const kRoll = (90 + 38 * horizSpeed) * wetFrac;
      const kYaw = (120 + 30 * horizSpeed) * wetFrac;
      const pitchRate = w.dot(left);
      const kPitch = (200 + 75 * horizSpeed) * wetFrac;
      T.addScaled(fwd, -rollRate * kRoll);
      T.addScaled(up, -yawRate * kYaw);
      T.addScaled(left, -pitchRate * kPitch);
      // heave damping: the planing surface resists bouncing
      tmpF.set(0, -vcg.y * (300 + 55 * horizSpeed) * wetFrac, 0);
      F.add(tmpF);
    }

    // ---- integrate ----
    const accel = F.clone().scale(1 / this.mass);
    this.prevVel.copy(vcg);
    vcg.addScaled(accel, dt);
    this.pos.addScaled(vcg, dt);

    // angular: in body frame with the diagonal inertia
    const wb = q.unrotate(w, new V3());
    const tb = q.unrotate(T, new V3());
    const I = this.I;
    const Lx = I.x * wb.x, Ly = I.y * wb.y, Lz = I.z * wb.z;
    const gx = wb.y * Lz - wb.z * Ly, gy = wb.z * Lx - wb.x * Lz, gz = wb.x * Ly - wb.y * Lx;
    wb.x += (tb.x - gx) / I.x * dt;
    wb.y += (tb.y - gy) / I.y * dt;
    wb.z += (tb.z - gz) / I.z * dt;
    q.rotate(wb, w);
    // quaternion integration
    const dq = new Quat(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    dq.multiply(q);
    q.x += dq.x; q.y += dq.y; q.z += dq.z; q.w += dq.w;
    q.normalize();
    this.updateOrigin();

    // ---- fuel ----
    if (this.engineOn) {
      const powerFrac = clamp((Te * omega) / (c.powerKW * 1000), 0, 1.1);
      const lps = (c.fuelBurnWOT * 3.785 / 3600) * (0.04 + 0.96 * powerFrac);
      this.fuelL = Math.max(0, this.fuelL - lps * dt);
    }

    // ---- wake rings: biggest around the hump, smaller on the plane ----
    this.wakeTimer -= dt;
    if (this.wakeTimer <= 0 && horizSpeed > 1.2 && wetPts > 0) {
      this.wakeTimer = 0.14;
      const disp = Math.exp(-(((Fr - 0.9) / 0.6) ** 2)) * 0.26 + 0.07 * smooth(1, 4, Fr) + 0.04;
      const wp = this.toWorld(this.wakePoint, new V3());
      oc.addWake(wp.x, wp.z, disp * clamp(immersion * 1.4, 0.3, 1.1) * Math.min(1, horizSpeed / 3));
    }

    // ---- stats for HUD / effects / ejection ----
    const latSpeed = vcg.dot(left);
    const st = this.stats;
    st.fwdSpeed = fwdSpeed;
    st.speed = horizSpeed;
    st.latSpeed = latSpeed;
    st.slip = Math.atan2(-latSpeed, Math.max(Math.abs(fwdSpeed), 0.5)) / DEG; // + = sliding to the right
    st.wetPts = wetPts; st.wetArea = wetArea;
    st.wetLen = wetPts ? (wetZmax - wetZmin) * this.L : 0;
    st.chineL = chineL; st.chineR = chineR; st.bowWet = bowWet; st.deckWet = deckWet;
    st.finStall = finStall; st.finGrip = finGrip; st.pumpSlip = slipSum / DEG;
    st.intakeDepth = intakeDepth;
    st.airborne = wetPts === 0 && intakeDepth < 0;
    st.Fr = Fr;
    st.immersion = immersion;
    // attitude
    st.pitch = Math.asin(clamp(fwd.y, -1, 1)) / DEG;
    st.roll = Math.atan2(left.y, up.y) / DEG;  // + = rolled right (right side down)
    st.yawRate = w.dot(up) / DEG;
    st.heading = Math.atan2(fwd.x, fwd.z);
    if (st.airborne) this.airTime += dt; else this.airTime = 0;
    // specific force felt by the rider, body frame, low-passed
    const sfx = accel.dot(left) + G * left.y, sfy = accel.dot(up) + G * up.y, sfz = accel.dot(fwd) + G * fwd.y;
    const k = Math.min(1, dt / 0.06);
    this.accFilt.x += (sfx - this.accFilt.x) * k;
    this.accFilt.y += (sfy - this.accFilt.y) * k;
    this.accFilt.z += (sfz - this.accFilt.z) * k;
    st.gLat = -this.accFilt.x / G; st.gVert = this.accFilt.y / G; st.gLong = this.accFilt.z / G;
    st.pumpState = wf < 0.5 ? 'AIR' : cavAmt > 0.35 ? 'CAVITATING' : 'HOOKED';
  }

  // one rendered frame: controls + mass once, physics in fixed substeps
  update(dt) {
    dt = Math.min(dt, 1 / 20);
    const n = Math.max(1, Math.ceil(dt / (1 / 300)));
    const h = dt / n;
    this.updateControls(dt);
    this.updateMass();
    for (let i = 0; i < n; i++) { this.ocean.step(h); this.step(h); }
    const why = this.checkEjection();
    if (why) this.eject(why);
    return why;
  }

  // checks that throw the rider off. Returns a reason string or null.
  checkEjection() {
    if (!this.riderOn) return null;
    const st = this.stats;
    if (st.gLong < -2.7) return 'Stuffed the nose';
    if (st.gVert > 8.5) return 'Landed too hard';
    if (Math.abs(st.gLat) > 2.9) return 'Hooked and got thrown';
    if (Math.abs(st.roll) > 95) return 'Rolled it';
    if (st.pitch > 70) return 'Blew over backwards';
    if (st.pitch < -65) return 'Nose dived';
    return null;
  }

  eject(reason) {
    this.riderOn = false;
    this.ejectReason = reason;
    this.engineOn = false;   // lanyard pulled
    this.updateMass();
  }

  reboard() {
    // right the ski if needed, keep its heading, put the rider back on
    const head = this.stats.heading || 0;
    this.q.setFromAxisAngle(0, 1, 0, head);
    this.w.set(0, 0, 0);
    this.vel.scale(0.2);
    this.riderOn = true;
    this.rider.copy(this.riderSeat);
    this.riderVel.set(0, 0, 0);
    this.engineOn = true;
    this.gear = 'N'; this.bucket = NEUTRAL;
    this.ejectReason = null;
    this.updateMass();
    this.pos.y = Math.max(this.pos.y, this.ocean.height(this.pos.x, this.pos.z) + 0.05);
  }
}

export { clamp, smooth, approach, DEG };
