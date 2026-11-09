// Spray: jet stream, rooster tail, chine spray, powerslide spray walls, landing splashes.
// Every droplet is a ballistic particle with gravity and air drag. The jet stream is a
// chain of water parcels fired from the nozzle, drawn as a glassy tube that breaks up.
import * as THREE from 'three';

const JET = 1, CHINE = 2, SPLASH = 3, MIST = 4;
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function skiQuat(ski) { return _q.set(ski.q.x, ski.q.y, ski.q.z, ski.q.w); }

// ---------------------------------------------------------------- particles
export class Spray {
  constructor(scene, ocean, max = 24000) {
    this.ocean = ocean;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.alpha = new Float32Array(max);
    this.drawSize = new Float32Array(max);
    this.kindF = new Float32Array(max);
    this.next = 0;
    for (let i = 0; i < max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -1000; }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.drawSize, 1).setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.BufferAttribute(this.kindF, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aKind', this.kindAttr);
    this.uniforms = { uScale: { value: 600 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aAlpha; attribute float aSize; attribute float aKind;
        uniform float uScale; uniform vec3 uSunDir;
        varying float vA; varying float vLight; varying float vMist;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * wp;
          vA = aAlpha;
          vMist = aKind > 3.5 ? 1.0 : 0.0;
          // spray glows when the sun is behind it (forward scattering)
          vec3 toCam = normalize(cameraPosition - wp.xyz);
          float fwd = pow(max(dot(-toCam, uSunDir), 0.0), 6.0);
          vLight = 0.82 + 0.25 * max(uSunDir.y, 0.0) + fwd * (vMist > 0.5 ? 0.6 : 1.1);
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, vMist > 0.5 ? 160.0 : 48.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying float vLight; varying float vMist;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard;
          float edge = vMist > 0.5 ? (1.0 - r) * (1.0 - r) * 0.55 : pow(1.0 - r, 1.6);
          float a = vA * edge;
          // droplets get a bright core and a slightly blue rim
          vec3 col = mix(vec3(0.78, 0.88, 0.95), vec3(1.0), vMist > 0.5 ? 0.7 : (1.0 - r));
          gl_FragColor = vec4(col * vLight, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.roosterHeight = 0;
    this._rh = 0;
    this.wasAir = false;
    this.airTimer = 0;
    this.lastVy = 0;
    this.jet = new JetStream(scene, ocean, this);
    this.density = 1;
  }

  setQuality(q) { this.density = q === 'low' ? 0.45 : q === 'ultra' ? 1.25 : 1; this.jet.mesh.visible = true; }

  emit(x, y, z, vx, vy, vz, size, life, kind) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.kind[i] = kind; this.kindF[i] = kind;
  }

  burst(x, y, z, n, speed, upBias, size = 0.22) {
    n = Math.floor(n * this.density);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const sp = speed * (0.35 + 0.65 * r);
      this.emit(x + Math.cos(a) * 0.6, y, z + Math.sin(a) * 0.6,
        Math.cos(a) * sp, upBias * (0.5 + Math.random()), Math.sin(a) * sp, size * 0.45 * (0.5 + Math.random()), 1.8, SPLASH);
      if (k % 3 === 0) this.emit(x + Math.cos(a) * 0.8, y + 0.2, z + Math.sin(a) * 0.8,
        Math.cos(a) * sp * 0.6, upBias * 0.5 * Math.random(), Math.sin(a) * sp * 0.6, size * 1.8, 2.0, MIST);
    }
  }

  emitFromSki(ski, dt) {
    const st = ski.stats, oc = this.ocean;
    const R = Math.random, D = this.density;
    const vx = ski.vel.x, vy = ski.vel.y, vz = ski.vel.z;
    const speed = st.speed || 0;
    const q = skiQuat(ski);

    // ---- jet: a solid stream when the nozzle is in the air, a plume when it is just under ----
    this.jet.update(dt, ski);
    if (ski.thrust > 60 && ski.bucket < 0.6 && ski.nozzleWorld && ski.waterFrac > 0.15) {
      const d = ski.nozzleDirBody;
      const dw = _v.set(d.x, d.y, d.z).applyQuaternion(q).normalize();
      const vj = ski.jetSpeed;
      const strength = Math.min(1.4, ski.thrust / ski.craft.staticThrust + 0.15);
      const n0 = ski.nozzleWorld;
      const depth = ski.nozzleDepth;
      if (depth < 0.03) {
        // mist peeling off the stream right behind the nozzle
        const ex = vx - dw.x * vj, ey = vy - dw.y * vj, ez = vz - dw.z * vj;
        const n = Math.min(80, Math.floor(500 * strength * D * dt + R()));
        for (let k = 0; k < n; k++) {
          const tt = R() * 0.06;
          this.emit(n0.x + ex * tt, n0.y + ey * tt, n0.z + ez * tt,
            ex * 0.85 + (R() - 0.5) * 4, ey * 0.85 + (R() - 0.5) * 4, ez * 0.85 + (R() - 0.5) * 4, 0.1 + 0.12 * R(), 1.2, MIST);
        }
      } else if (depth < 0.42) {
        // nozzle just under the surface: the jet breaks through and throws a plume
        const f = 1 - depth / 0.42;
        const rel = Math.max(0, vj - Math.max(0, st.fwdSpeed));
        const lift = rel * (0.2 + Math.max(0, -dw.y) * 1.1) * f;
        const n = Math.min(200, Math.floor(1900 * strength * f * D * dt + R()));
        const hx = -dw.x, hz = -dw.z, hl = Math.hypot(hx, hz) || 1;
        const yS = oc.baseHeight(n0.x, n0.z);
        for (let k = 0; k < n; k++) {
          const back = 0.3 + R() * 0.5;
          const mist = k % 4 === 0;
          this.emit(n0.x + hx / hl * back, yS + 0.02, n0.z + hz / hl * back,
            vx + hx / hl * rel * (0.45 + 0.25 * R()) + (R() - 0.5) * 1.8,
            lift * (0.5 + 0.65 * R()),
            vz + hz / hl * rel * (0.45 + 0.25 * R()) + (R() - 0.5) * 1.8,
            mist ? 0.22 + 0.18 * R() : 0.05 + 0.09 * R(), mist ? 2.0 : 2.6, mist ? MIST : JET);
        }
      }
      if (depth > 0) {
        // churned boil right behind the transom
        const n = Math.floor(90 * strength * D * dt + R());
        for (let k = 0; k < n; k++) this.emit(n0.x + (R() - 0.5) * 0.5, oc.baseHeight(n0.x, n0.z) + 0.03, n0.z + (R() - 0.5) * 0.5, vx * 0.3, 0.5 + R(), vz * 0.3, 0.2, 0.7, MIST);
      }
    }

    // ---- chine spray from the hull points carrying load ----
    for (let k = 0; k < ski.sprayCount; k++) {
      const p = ski.sprayPts[k];
      const pv = Math.hypot(p.vx, p.vz);
      if (pv < 2.5) continue;
      const strength = Math.min(1, p.f / 2500);
      const n = Math.floor(strength * (30 + pv * 3.2) * dt * 6 * D + R());
      let ox = p.nx, oz = p.nz; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      for (let i = 0; i < n; i++) {
        const out = 1.5 + pv * (0.12 + 0.13 * R()) * (0.5 + strength);
        const up = 1.2 + pv * (0.08 + 0.11 * R()) * (0.4 + strength);
        const mist = i % 3 === 0;
        this.emit(p.x + ox * 0.05, p.y + 0.05, p.z + oz * 0.05,
          p.vx * 0.55 + ox * out, up, p.vz * 0.55 + oz * out, mist ? 0.15 + 0.15 * R() : 0.025 + 0.05 * R(), mist ? 1.4 : 1.3, mist ? MIST : CHINE);
      }
    }

    // ---- powerslide spray wall on the leading side ----
    const slip = Math.abs(st.slip || 0);
    if (slip > 10 && speed > 4 && st.wetPts > 0) {
      const latDir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const s = Math.sign(st.latSpeed || 0);
      const lat = Math.abs(st.latSpeed);
      const n = Math.floor(Math.min(1, (slip - 10) / 30) * (40 + lat * 16) * dt * 6 * D + R());
      for (let i = 0; i < n; i++) {
        const along = (R() - 0.6) * ski.L * 0.85;
        const px = ski.pos.x + latDir.x * s * 0.62 + fwd.x * along, pz = ski.pos.z + latDir.z * s * 0.62 + fwd.z * along;
        const py = oc.baseHeight(px, pz) + 0.05;
        const mist = i % 3 === 0;
        this.emit(px, py, pz,
          vx * 0.4 + latDir.x * s * lat * (0.8 + 0.7 * R()), 1.5 + lat * (0.35 + 0.4 * R()), vz * 0.4 + latDir.z * s * lat * (0.8 + 0.7 * R()),
          mist ? 0.25 + 0.2 * R() : 0.035 + 0.06 * R(), mist ? 1.6 : 1.4, mist ? MIST : CHINE);
      }
    }

    // ---- bow spray when the nose slaps into chop ----
    if ((st.bowWet || 0) > 2 && speed > 6) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const bx = ski.pos.x + fwd.x * ski.L * 0.4, bz = ski.pos.z + fwd.z * ski.L * 0.4;
      const n = Math.floor(Math.min(1, st.bowWet / 12) * speed * 2.2 * dt * 6 * D + R());
      for (let i = 0; i < n; i++) {
        const side = R() < 0.5 ? -1 : 1;
        const a = new THREE.Vector3(fwd.z * side, 0, -fwd.x * side);
        this.emit(bx, oc.baseHeight(bx, bz) + 0.1, bz, vx * 0.5 + a.x * speed * 0.3, 1 + speed * 0.12 * R(), vz * 0.5 + a.z * speed * 0.3, 0.05 + 0.08 * R(), 1.3, CHINE);
      }
    }

    // ---- landing splash ----
    if (st.airborne) { this.airTimer += dt; this.lastVy = ski.vel.y; }
    else {
      if (this.wasAir && this.airTimer > 0.2) {
        const vyImpact = Math.min(8, Math.abs(this.lastVy));
        const n = Math.floor(90 + vyImpact * 80);
        this.burst(ski.pos.x, oc.baseHeight(ski.pos.x, ski.pos.z) + 0.05, ski.pos.z, n, 2 + vyImpact * 0.9 + speed * 0.12, 1.5 + vyImpact * 1.0);
        oc.addWake(ski.pos.x, ski.pos.z, Math.min(0.5, 0.08 + vyImpact * 0.05));
        this.onLanding && this.onLanding(this.airTimer, vyImpact);
      }
      this.airTimer = 0;
    }
    this.wasAir = st.airborne;
  }

  update(dt) {
    const oc = this.ocean;
    let rh = 0;
    const g = 9.81;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const o = i * 3;
      const k = this.kind[i];
      // quadratic air drag: a jet breaks up into spray and slows fast; mist hangs
      const sp = Math.hypot(this.vel[o], this.vel[o + 1], this.vel[o + 2]);
      const drag = (k === JET ? 0.075 : k === MIST ? 0.2 : 0.1) * sp + (k === MIST ? 1.2 : 0.3);
      const damp = Math.max(0, 1 - drag * dt);
      this.vel[o] *= damp; this.vel[o + 2] *= damp;
      this.vel[o + 1] = this.vel[o + 1] * damp - g * dt * (k === MIST ? 0.35 : 1);
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.age[i] += dt;
      const surface = oc.baseHeight(this.pos[o], this.pos[o + 2]);
      if (this.pos[o + 1] < surface - 0.05 && this.vel[o + 1] < 0 && k === JET && sp > 7 && Math.random() < 0.45 * this.density) {
        // jet water slamming into the surface throws up the rooster tail plume
        const up = sp * (0.12 + 0.2 * Math.random());
        this.emit(this.pos[o], surface + 0.05, this.pos[o + 2], this.vel[o] * 0.45 + (Math.random() - 0.5) * 2, up, this.vel[o + 2] * 0.45 + (Math.random() - 0.5) * 2, 0.08 + 0.1 * Math.random(), 2.2, SPLASH);
      }
      if ((this.pos[o + 1] < surface - 0.05 && this.vel[o + 1] < 0) || this.age[i] > this.life[i]) {
        this.life[i] = 0; this.alpha[i] = 0; this.pos[o + 1] = -1000; continue;
      }
      const t = this.age[i] / this.life[i];
      const base = k === JET ? 0.8 : k === CHINE ? 0.75 : k === MIST ? 0.13 : 0.75;
      this.alpha[i] = base * (1 - t) * Math.min(1, this.age[i] * 25);
      this.drawSize[i] = this.size[i] * (1 + this.age[i] * (k === MIST ? 1.5 : k === JET ? 1.2 : 0.9));
      if (k === JET || k === SPLASH) {
        const hh = this.pos[o + 1] - surface;
        if (hh > rh) rh = hh;
      }
    }
    rh = Math.max(rh, this.jet.peak);
    this.posAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true; this.kindAttr.needsUpdate = true;
    this._rh += (rh - this._rh) * Math.min(1, dt * 3);
    this.roosterHeight = this._rh;
  }
}

// ---------------------------------------------------------------- jet stream
// A streakline: parcels of water leave the nozzle at jet speed and fly ballistically.
// Joining consecutive parcels gives the real shape of the stream, so when the ski spins
// the jet curves like a garden hose.
const NP = 140, RS = 10;
export class JetStream {
  constructor(scene, ocean, spray) {
    this.ocean = ocean; this.spray = spray;
    this.p = new Float32Array(NP * 3); this.v = new Float32Array(NP * 3);
    this.age = new Float32Array(NP); this.alive = new Uint8Array(NP); this.seg = new Int32Array(NP); this.flow = new Float32Array(NP);
    this.head = 0; this.count = 0; this.segId = 0; this.wasOn = false; this.carry = 0;
    this.prevNozzle = null; this.peak = 0;
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(NP * RS * 3);
    this.nrmArr = new Float32Array(NP * RS * 3);
    this.alphaArr = new Float32Array(NP * RS);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrmArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    this.idx = new Uint32Array((NP - 1) * RS * 6);
    g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: /* glsl */`
        attribute float aAlpha; varying float vA; varying vec3 vN; varying vec3 vW;
        void main(){ vA = aAlpha; vN = normalize(normal); vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; varying float vA; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
          float fres = pow(1.0 - abs(dot(N, V)), 2.0);
          float sun = pow(max(dot(reflect(-V, N), uSunDir), 0.0), 40.0);
          float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
          vec3 col = mix(vec3(0.62, 0.84, 0.9), vec3(1.0), 0.45 + 0.4 * fres) + vec3(1.0, 0.95, 0.85) * (sun * 2.5 + back * 0.6);
          gl_FragColor = vec4(col, vA * (0.55 + 0.45 * fres));
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  update(dt, ski) {
    const oc = this.ocean;
    const on = ski.engineOn && ski.rpm > ski.craft.rpmIdle * 0.7 && ski.bucket < 0.6 && ski.waterFrac > 0.15 && ski.nozzleWorld && ski.nozzleDepth < 0.04;
    if (on) {
      const q = skiQuat(ski);
      const d = ski.nozzleDirBody;
      const dw = _v.set(d.x, d.y, d.z).applyQuaternion(q).normalize();
      const vj = ski.jetSpeed;
      const n0 = ski.nozzleWorld;
      // velocity of the nozzle itself (ski spinning swings the stream)
      const rx = n0.x - ski.pos.x, ry = n0.y - ski.pos.y, rz = n0.z - ski.pos.z;
      const w = ski.w;
      const nvx = ski.vel.x + w.y * rz - w.z * ry, nvy = ski.vel.y + w.z * rx - w.x * rz, nvz = ski.vel.z + w.x * ry - w.y * rx;
      if (!this.wasOn) { this.segId++; this.prevNozzle = { x: n0.x, y: n0.y, z: n0.z }; }
      const rate = 110;
      this.carry += rate * dt;
      const n = Math.floor(this.carry); this.carry -= n;
      // flow follows rpm: let go of the throttle and the stream collapses to an idle trickle fast
      const strength = Math.min(1, Math.max(0.12, ski.rpm / (ski.craft.rpmLimit * 0.85)) ** 1.3);
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n;
        const i = this.head; this.head = (this.head + 1) % NP;
        const o = i * 3;
        this.p[o] = this.prevNozzle.x + (n0.x - this.prevNozzle.x) * f;
        this.p[o + 1] = this.prevNozzle.y + (n0.y - this.prevNozzle.y) * f;
        this.p[o + 2] = this.prevNozzle.z + (n0.z - this.prevNozzle.z) * f;
        const jit = 0.015 * vj;
        this.v[o] = nvx - dw.x * vj * (0.9 + 0.1 * strength) + (Math.random() - 0.5) * jit;
        this.v[o + 1] = nvy - dw.y * vj * (0.9 + 0.1 * strength) + (Math.random() - 0.5) * jit;
        this.v[o + 2] = nvz - dw.z * vj * (0.9 + 0.1 * strength) + (Math.random() - 0.5) * jit;
        this.age[i] = (1 - f) * dt; this.alive[i] = 1; this.seg[i] = this.segId; this.flow[i] = strength;
      }
      this.prevNozzle = { x: n0.x, y: n0.y, z: n0.z };
      this.strength = strength;
    } else if (this.wasOn) { this.segId++; }
    this.wasOn = on;

    // fly the parcels
    let peak = 0;
    const sp = this.spray;
    for (let i = 0; i < NP; i++) {
      if (!this.alive[i]) continue;
      const o = i * 3;
      const s = Math.hypot(this.v[o], this.v[o + 1], this.v[o + 2]);
      const damp = Math.max(0, 1 - (0.035 * s + 0.2) * dt);
      this.v[o] *= damp; this.v[o + 2] *= damp; this.v[o + 1] = this.v[o + 1] * damp - 9.81 * dt;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      this.age[i] += dt;
      const surf = oc.baseHeight(this.p[o], this.p[o + 2]);
      const hh = this.p[o + 1] - surf;
      if (hh > peak) peak = hh;
      // the stream sheds droplets as it breaks up
      if (this.age[i] > 0.05 && Math.random() < 0.35 * sp.density * this.flow[i]) {
        sp.emit(this.p[o], this.p[o + 1], this.p[o + 2], this.v[o] * 0.9 + (Math.random() - 0.5) * 3, this.v[o + 1] * 0.9 + (Math.random() - 0.5) * 3, this.v[o + 2] * 0.9 + (Math.random() - 0.5) * 3, 0.05 + 0.06 * Math.random(), 1.6, JET);
      }
      if (hh < 0 && this.v[o + 1] < 0) {
        // hitting the water: rooster tail plume
        const n = Math.floor((4 + s * 0.35) * sp.density * this.flow[i]);
        for (let k = 0; k < n; k++) {
          const mist = k % 3 === 0;
          sp.emit(this.p[o] + (Math.random() - 0.5) * 0.4, surf + 0.05, this.p[o + 2] + (Math.random() - 0.5) * 0.4,
            this.v[o] * 0.4 + (Math.random() - 0.5) * 3, s * (0.12 + 0.22 * Math.random()), this.v[o + 2] * 0.4 + (Math.random() - 0.5) * 3,
            mist ? 0.25 + 0.2 * Math.random() : 0.06 + 0.09 * Math.random(), mist ? 2.0 : 2.0, mist ? MIST : SPLASH);
        }
        this.alive[i] = 0;
      } else if (this.age[i] > 1.6) this.alive[i] = 0;
    }
    this.peak = peak;
    this.buildTube();
  }

  buildTube() {
    const P = this.posArr, Nn = this.nrmArr, A = this.alphaArr, I = this.idx;
    let vi = 0, ii = 0;
    const order = [];
    for (let k = 1; k <= NP; k++) order.push((this.head - k + NP * 2) % NP);   // newest first
    let prevRing = -1, prevIdx = -1;
    const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      if (!this.alive[i]) { prevRing = -1; prevIdx = -1; continue; }
      const o = i * 3;
      // tangent from the neighbouring parcel in the same segment
      const j = order[k + 1];
      if (j !== undefined && this.alive[j] && this.seg[j] === this.seg[i]) t.set(this.p[j * 3] - this.p[o], this.p[j * 3 + 1] - this.p[o + 1], this.p[j * 3 + 2] - this.p[o + 2]);
      else if (prevIdx >= 0) t.set(this.p[o] - this.p[prevIdx * 3], this.p[o + 1] - this.p[prevIdx * 3 + 1], this.p[o + 2] - this.p[prevIdx * 3 + 2]);
      else t.set(this.v[o], this.v[o + 1], this.v[o + 2]);
      if (t.lengthSq() < 1e-8) t.set(0, 0, 1);
      t.normalize();
      a.crossVectors(t, Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
      b.crossVectors(t, a).normalize();
      const age = this.age[i];
      const fl = this.flow[i];
      const rad = 0.045 * (0.35 + 0.65 * fl) * (1 + age * 5.5);
      const alpha = Math.max(0, 1 - age / 1.0) * (0.35 + 0.65 * fl);
      const ringStart = vi;
      for (let r = 0; r < RS; r++) {
        const th = (r / RS) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        const nx = a.x * c + b.x * s, ny = a.y * c + b.y * s, nz = a.z * c + b.z * s;
        P[vi * 3] = this.p[o] + nx * rad; P[vi * 3 + 1] = this.p[o + 1] + ny * rad; P[vi * 3 + 2] = this.p[o + 2] + nz * rad;
        Nn[vi * 3] = nx; Nn[vi * 3 + 1] = ny; Nn[vi * 3 + 2] = nz;
        A[vi] = alpha;
        vi++;
      }
      if (prevRing >= 0 && this.seg[prevIdx] === this.seg[i]) {
        for (let r = 0; r < RS; r++) {
          const r2 = (r + 1) % RS;
          const p0 = prevRing + r, p1 = prevRing + r2, c0 = ringStart + r, c1 = ringStart + r2;
          I[ii++] = p0; I[ii++] = c0; I[ii++] = p1;
          I[ii++] = p1; I[ii++] = c0; I[ii++] = c1;
        }
      }
      prevRing = ringStart; prevIdx = i;
    }
    this.geo.setDrawRange(0, ii);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.index.needsUpdate = true;
  }
}
