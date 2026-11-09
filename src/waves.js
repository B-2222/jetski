// Water surface shared by the physics and the renderer.
// The ocean is a sum of travelling sine waves (deep-water dispersion, w = sqrt(g k))
// plus a ring buffer of expanding wake rings. Every wake ring is a small circular
// ridge that spreads out from where the hull pushed water aside; many of them
// overlapping along the ski's path add up to a V-shaped wake you can jump.

export const G = 9.81;
export const MAX_WAVES = 8;
export const WAKE_N = 64;          // must match the shader uniform array size
export const WAKE_LIFE = 9.0;      // seconds a wake ring lives
export const WAKE_SPEED = 2.6;     // m/s ring expansion speed

// len = wavelength (m), amp = amplitude (m), dir = heading in degrees
export const CONDITIONS = {
  glass: {
    label: 'Glassy lake',
    waves: [
      { len: 9, amp: 0.018, dir: 20 }, { len: 5, amp: 0.010, dir: -40 },
      { len: 14, amp: 0.016, dir: 65 }, { len: 3.3, amp: 0.005, dir: 110 },
    ],
  },
  chop: {
    label: 'Lake chop',
    waves: [
      { len: 8.0, amp: 0.045, dir: 10 }, { len: 5.2, amp: 0.03, dir: -35 },
      { len: 11, amp: 0.04, dir: 55 }, { len: 3.4, amp: 0.014, dir: 100 },
      { len: 14, amp: 0.035, dir: -80 }, { len: 2.4, amp: 0.008, dir: 150 },
    ],
  },
  swell: {
    label: 'Ocean swell',
    waves: [
      { len: 62, amp: 0.65, dir: 0 }, { len: 38, amp: 0.32, dir: 25 },
      { len: 22, amp: 0.14, dir: -30 }, { len: 7, amp: 0.06, dir: 70 },
      { len: 4, amp: 0.03, dir: -60 }, { len: 2.5, amp: 0.012, dir: 120 },
    ],
  },
  rough: {
    label: 'Rough ocean',
    waves: [
      { len: 44, amp: 0.95, dir: 0 }, { len: 27, amp: 0.5, dir: 30 },
      { len: 16, amp: 0.28, dir: -25 }, { len: 9, amp: 0.15, dir: 60 },
      { len: 5, amp: 0.08, dir: -70 }, { len: 3, amp: 0.035, dir: 130 },
    ],
  },
};

export class Ocean {
  constructor(conditionKey = 'chop') {
    this.t = 0;
    // packed per wave: dirX, dirZ, k, omega, amp, phase
    this.waveData = new Float32Array(MAX_WAVES * 6);
    this.waveCount = 0;
    // packed per ring: x, z, birthTime, amplitude
    this.wake = new Float32Array(WAKE_N * 4);
    for (let i = 0; i < WAKE_N; i++) this.wake[i * 4 + 2] = -1e6;
    this.wakeIdx = 0;
    this.setConditions(conditionKey);
  }

  setConditions(key) {
    this.key = key;
    const c = CONDITIONS[key] || CONDITIONS.chop;
    this.waveCount = Math.min(MAX_WAVES, c.waves.length);
    this.waveData.fill(0);
    // fixed pseudo-random phases so the sea looks the same every run
    let seed = 1234;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < this.waveCount; i++) {
      const w = c.waves[i];
      const k = (2 * Math.PI) / w.len;
      const a = (w.dir * Math.PI) / 180;
      const o = i * 6;
      this.waveData[o] = Math.cos(a);
      this.waveData[o + 1] = Math.sin(a);
      this.waveData[o + 2] = k;
      this.waveData[o + 3] = Math.sqrt(G * k);
      this.waveData[o + 4] = w.amp;
      this.waveData[o + 5] = rnd() * Math.PI * 2;
    }
  }

  step(dt) { this.t += dt; }

  addWake(x, z, amp) {
    const o = this.wakeIdx * 4;
    this.wake[o] = x; this.wake[o + 1] = z; this.wake[o + 2] = this.t; this.wake[o + 3] = amp;
    this.wakeIdx = (this.wakeIdx + 1) % WAKE_N;
  }

  // Waves only, no wake: cheapest, for thousands of spray particles.
  baseHeight(x, z) {
    const t = this.t, d = this.waveData;
    let h = 0;
    for (let i = 0; i < this.waveCount; i++) {
      const o = i * 6;
      h += d[o + 4] * Math.sin(d[o + 2] * (d[o] * x + d[o + 1] * z) - d[o + 3] * t + d[o + 5]);
    }
    return h;
  }

  // Height including wake: used by buoys and the hull.
  height(x, z, minAge = 0) {
    const t = this.t, d = this.waveData;
    let h = 0;
    for (let i = 0; i < this.waveCount; i++) {
      const o = i * 6;
      h += d[o + 4] * Math.sin(d[o + 2] * (d[o] * x + d[o + 1] * z) - d[o + 3] * t + d[o + 5]);
    }
    return h + this.wakeHeight(x, z, null, minAge);
  }

  // Height and vertical surface velocity dh/dt. Used by the hull.
  sample(x, z, out, minAge = 0) {
    const t = this.t, d = this.waveData;
    let h = 0, dh = 0;
    for (let i = 0; i < this.waveCount; i++) {
      const o = i * 6;
      const ph = d[o + 2] * (d[o] * x + d[o + 1] * z) - d[o + 3] * t + d[o + 5];
      h += d[o + 4] * Math.sin(ph);
      dh -= d[o + 4] * d[o + 3] * Math.cos(ph);
    }
    out.h = h + this.wakeHeight(x, z, out, minAge);
    out.dhdt = dh + (out._wdh || 0);
    return out;
  }

  // Sum of wake rings. Profile: crest at the ring radius with a shallow trough inside.
  // minAge lets the hull ignore the rings it is still sitting in (its own bow wave
  // is already part of its buoyancy); older rings, like the wake you turn back into, count.
  wakeHeight(x, z, out, minAge = 0) {
    const t = this.t, w = this.wake;
    let h = 0, dh = 0;
    for (let i = 0; i < WAKE_N; i++) {
      const o = i * 4;
      const age = t - w[o + 2];
      if (age < minAge || age > WAKE_LIFE) continue;
      const dx = x - w[o], dz = z - w[o + 1];
      const R = 0.5 + WAKE_SPEED * age;
      const width = 0.45 + 0.22 * age;
      const dist2 = dx * dx + dz * dz;
      const lim = R + 3.5 * width;
      if (dist2 > lim * lim) continue;
      const s = Math.sqrt(dist2) - R;
      if (s < -4 * width) continue;
      const amp = w[o + 3] * Math.exp(-age / 3.2) / (1 + 0.3 * age);
      const u = s / width, v = (s + 1.5 * width) / width;
      const e1 = Math.exp(-u * u), e2 = Math.exp(-v * v);
      h += amp * (e1 - 0.55 * e2);
      // ds/dt = -WAKE_SPEED, so dh/dt = dh/ds * -WAKE_SPEED
      const dhds = amp * (-2 * u * e1 + 0.55 * 2 * v * e2) / width;
      dh += -dhds * WAKE_SPEED;
    }
    if (out) out._wdh = dh;
    return h;
  }
}
