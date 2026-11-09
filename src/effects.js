// Spray: rooster tail from the jet, chine spray, powerslide spray walls, landing splashes.
// Every droplet is a ballistic particle with gravity and air drag.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const JET = 1, CHINE = 2, SPLASH = 3;

export class Spray {
  constructor(scene, ocean, max = 16000) {
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
    this.next = 0;
    for (let i = 0; i < max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -1000; }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.drawSize, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aSize', this.sizeAttr);
    this.uniforms = { uScale: { value: 600 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute float aAlpha; attribute float aSize; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aAlpha;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 220.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard;
          float a = vA * (1.0 - r) * (1.0 - r);
          vec3 col = mix(vec3(0.82, 0.9, 0.96), vec3(1.0), 1.0 - r);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.roosterHeight = 0;
    this.roosterLen = 0;
    this._rh = 0; this._rl = 0;
    this.wasAir = false;
    this.airTimer = 0;
    this.lastVy = 0;
  }

  emit(x, y, z, vx, vy, vz, size, life, kind) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.kind[i] = kind;
  }

  burst(x, y, z, n, speed, upBias, size = 0.25) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const sp = speed * (0.4 + 0.6 * r);
      this.emit(x + Math.cos(a) * 0.6, y, z + Math.sin(a) * 0.6,
        Math.cos(a) * sp, upBias * (0.5 + Math.random()), Math.sin(a) * sp, size * (0.6 + Math.random()), 1.6, SPLASH);
    }
  }

  emitFromSki(ski, dt) {
    const st = ski.stats, oc = this.ocean;
    const R = Math.random;
    const vx = ski.vel.x, vy = ski.vel.y, vz = ski.vel.z;
    const speed = st.speed || 0;

    // ---- jet / rooster tail ----
    if (ski.thrust > 60 && ski.bucket < 0.6 && ski.nozzleWorld && ski.waterFrac > 0.3) {
      const d = ski.nozzleDirBody;
      const dw = new THREE.Vector3(d.x, d.y, d.z).applyQuaternion(new THREE.Quaternion(ski.q.x, ski.q.y, ski.q.z, ski.q.w)).normalize();
      const vj = ski.jetSpeed;
      const strength = Math.min(1.4, ski.thrust / ski.craft.staticThrust + 0.15);
      // water leaves the nozzle opposite to the thrust direction
      const ex = vx - dw.x * vj, ey = vy - dw.y * vj, ez = vz - dw.z * vj;
      const n0 = ski.nozzleWorld;
      const depth = ski.nozzleDepth;
      if (depth < 0.03) {
        // nozzle in the air: a solid jet arcs up and back
        const n = Math.min(260, Math.floor(4200 * strength * dt + R()));
        for (let k = 0; k < n; k++) {
          const sp = 0.03 * vj;
          const t = R() * dt;
          this.emit(n0.x + ex * t, n0.y + ey * t, n0.z + ez * t,
            ex + (R() - 0.5) * sp * 3, ey + (R() - 0.5) * sp * 3, ez + (R() - 0.5) * sp * 3,
            0.18 + 0.22 * R(), 4, JET);
        }
      } else if (depth < 0.4) {
        // nozzle just under the surface: the jet breaks through and throws a plume
        const f = 1 - depth / 0.4;
        const rel = Math.max(0, vj - Math.max(0, st.fwdSpeed));
        const lift = rel * (0.22 + Math.max(0, -dw.y) * 1.25) * f;
        const n = Math.min(180, Math.floor(1800 * strength * f * dt + R()));
        const hx = -dw.x, hz = -dw.z, hl = Math.hypot(hx, hz) || 1;
        const yS = oc.baseHeight(n0.x, n0.z);
        for (let k = 0; k < n; k++) {
          const back = 0.3 + R() * 0.5;
          this.emit(n0.x + hx / hl * back, yS + 0.02, n0.z + hz / hl * back,
            vx + hx / hl * rel * (0.45 + 0.25 * R()) + (R() - 0.5) * 1.5,
            lift * (0.55 + 0.6 * R()),
            vz + hz / hl * rel * (0.45 + 0.25 * R()) + (R() - 0.5) * 1.5,
            0.14 + 0.2 * R(), 3, JET);
        }
      }
      if (depth > 0) {
        // churned foam boil right behind the transom
        const n = Math.floor(80 * strength * dt + R());
        for (let k = 0; k < n; k++) this.emit(n0.x + (R() - 0.5) * 0.4, oc.baseHeight(n0.x, n0.z) + 0.03, n0.z + (R() - 0.5) * 0.4, vx * 0.3, 0.4 + R(), vz * 0.3, 0.3, 0.6, SPLASH);
      }
    }

    // ---- chine spray from the hull points carrying load ----
    for (let k = 0; k < ski.sprayCount; k++) {
      const p = ski.sprayPts[k];
      const pv = Math.hypot(p.vx, p.vz);
      if (pv < 3) continue;
      const strength = Math.min(1, p.f / 2500);
      const n = Math.floor(strength * (22 + pv * 2.2) * dt * 6 + R());
      // outward horizontal direction from the hull normal
      let ox = p.nx, oz = p.nz; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      for (let i = 0; i < n; i++) {
        const out = 1.5 + pv * (0.12 + 0.12 * R()) * (0.5 + strength);
        const up = 1.2 + pv * (0.08 + 0.1 * R()) * (0.4 + strength);
        this.emit(p.x + ox * 0.05, p.y + 0.05, p.z + oz * 0.05,
          p.vx * 0.55 + ox * out, up, p.vz * 0.55 + oz * out, 0.06 + 0.12 * R(), 1.4, CHINE);
      }
    }

    // ---- powerslide spray wall on the leading side ----
    const slip = Math.abs(st.slip || 0);
    if (slip > 10 && speed > 5 && st.wetPts > 0) {
      const latDir = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(ski.q.x, ski.q.y, ski.q.z, ski.q.w));
      const s = Math.sign(st.latSpeed || 0);
      const lat = Math.abs(st.latSpeed);
      const n = Math.floor(Math.min(1, (slip - 10) / 30) * (20 + lat * 9) * dt * 6 + R());
      for (let i = 0; i < n; i++) {
        const along = (R() - 0.65) * ski.L * 0.8;
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(ski.q.x, ski.q.y, ski.q.z, ski.q.w));
        const px = ski.pos.x + latDir.x * s * 0.62 + fwd.x * along, pz = ski.pos.z + latDir.z * s * 0.62 + fwd.z * along;
        const py = oc.baseHeight(px, pz) + 0.05;
        this.emit(px, py, pz,
          vx * 0.4 + latDir.x * s * lat * (0.8 + 0.6 * R()), 1.5 + lat * (0.35 + 0.35 * R()), vz * 0.4 + latDir.z * s * lat * (0.8 + 0.6 * R()),
          0.08 + 0.1 * R(), 1.3, CHINE);
      }
    }

    // ---- landing splash ----
    if (st.airborne) { this.airTimer += dt; this.lastVy = ski.vel.y; }
    else {
      if (this.wasAir && this.airTimer > 0.25) {
        const vyImpact = Math.min(8, Math.abs(this.lastVy));
        const n = Math.floor(80 + vyImpact * 70);
        this.burst(ski.pos.x, oc.baseHeight(ski.pos.x, ski.pos.z) + 0.05, ski.pos.z, n, 2 + vyImpact * 0.8 + speed * 0.1, 1.5 + vyImpact * 0.9);
        oc.addWake(ski.pos.x, ski.pos.z, Math.min(0.5, 0.08 + vyImpact * 0.05));
        this.onLanding && this.onLanding(this.airTimer, vyImpact);
      }
      this.airTimer = 0;
    }
    this.wasAir = st.airborne;
  }

  update(dt, camPos) {
    const oc = this.ocean;
    let rh = 0, rl = 0;
    const g = 9.81;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const o = i * 3;
      const k = this.kind[i];
      // droplets: quadratic air drag (a jet breaks up into spray and slows fast)
      const sp = Math.hypot(this.vel[o], this.vel[o + 1], this.vel[o + 2]);
      const drag = (k === JET ? 0.075 : 0.1) * sp + 0.3;
      const damp = Math.max(0, 1 - drag * dt);
      this.vel[o] *= damp; this.vel[o + 2] *= damp;
      this.vel[o + 1] = this.vel[o + 1] * damp - g * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.age[i] += dt;
      const surface = oc.baseHeight(this.pos[o], this.pos[o + 2]);
      if (this.pos[o + 1] < surface - 0.05 && this.vel[o + 1] < 0 && k === JET && sp > 7 && Math.random() < 0.45) {
        // the jet slamming into the water throws up the rooster tail plume
        const up = sp * (0.12 + 0.2 * Math.random());
        this.emit(this.pos[o], surface + 0.05, this.pos[o + 2], this.vel[o] * 0.45 + (Math.random() - 0.5) * 2, up, this.vel[o + 2] * 0.45 + (Math.random() - 0.5) * 2, 0.22 + 0.25 * Math.random(), 2.2, SPLASH);
      }
      if ((this.pos[o + 1] < surface - 0.05 && this.vel[o + 1] < 0) || this.age[i] > this.life[i]) {
        this.life[i] = 0; this.alpha[i] = 0; this.pos[o + 1] = -1000; continue;
      }
      const t = this.age[i] / this.life[i];
      this.alpha[i] = (k === JET ? 0.6 : k === CHINE ? 0.45 : 0.55) * (1 - t) * Math.min(1, this.age[i] * 25);
      this.drawSize[i] = this.size[i] * (1 + this.age[i] * (k === JET ? 1.4 : 1.1));
      if (k === JET || k === SPLASH) {
        const hh = this.pos[o + 1] - surface;
        if (hh > rh) rh = hh;
        if (camPos && hh > 0.3) rl = Math.max(rl, this.age[i]);
      }
    }
    this.posAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
    // smoothed rooster tail stats for the HUD
    this._rh += (rh - this._rh) * Math.min(1, dt * 3);
    this.roosterHeight = this._rh;
    this.roosterAir = rl;
  }
}
