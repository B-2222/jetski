// Freestyle trick detection and scoring. Everything is read from the physics state,
// so a trick only counts if the ski really did it.
const DEG = 180 / Math.PI;

export class Tricks {
  constructor(onTrick) {
    this.onTrick = onTrick;
    this.score = 0; this.combo = 0; this.comboTimer = 0; this.comboPoints = 0;
    this.reset();
  }

  reset() {
    this.air = 0; this.airYaw = 0; this.airRoll = 0; this.airPitch = 0;
    this.slideT = 0; this.slideMax = 0; this.spin = 0; this.calm = 0;
    this.wheelieT = 0; this.tailT = 0; this.tailCool = 0; this.subT = 0; this.subDone = false;
  }

  award(name, pts) {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 3;
    const mult = Math.min(5, this.combo);
    const total = Math.round(pts * mult);
    this.score += total;
    this.comboPoints += total;
    this.onTrick && this.onTrick(name, total, mult);
  }

  crash() {
    this.combo = 0; this.comboTimer = 0; this.comboPoints = 0;
    this.reset();
  }

  update(dt, ski, spray) {
    const st = ski.stats;
    if (!ski.riderOn) return;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) { this.combo = 0; this.comboPoints = 0; }

    // ---- air, with rotations ----
    const w = ski.w;
    if (st.airborne) {
      this.air += dt;
      const q = ski.q;
      // rates about body axes
      const up = rot(q, 0, 1, 0), fwd = rot(q, 0, 0, 1), left = rot(q, 1, 0, 0);
      this.airYaw += (w.x * up[0] + w.y * up[1] + w.z * up[2]) * dt * DEG;
      this.airRoll += (w.x * fwd[0] + w.y * fwd[1] + w.z * fwd[2]) * dt * DEG;
      this.airPitch += (w.x * left[0] + w.y * left[1] + w.z * left[2]) * dt * DEG;
    } else if (this.air > 0) {
      const a = this.air;
      if (Math.abs(this.airRoll) > 300) this.award('Barrel roll', 2500);
      else if (Math.abs(this.airPitch) > 300) this.award(this.airPitch < 0 ? 'Backflip' : 'Frontflip', 3000);
      else if (Math.abs(this.airYaw) > 320) this.award('Air 360', 1800);
      else if (Math.abs(this.airYaw) > 150) this.award('Air 180', 900);
      else if (a > 0.45) this.award(`Air ${a.toFixed(1)} s`, Math.round(250 * a * a + 100));
      this.air = 0; this.airYaw = 0; this.airRoll = 0; this.airPitch = 0;
    }

    // ---- slides and spins on the water ----
    const slip = Math.abs(st.slip || 0);
    const moving = (st.speed || 0) > 3 || Math.abs(st.yawRate || 0) > 60;
    if (!st.airborne && moving && slip > 25) {
      this.slideT += dt; this.slideMax = Math.max(this.slideMax, slip);
      this.spin += Math.abs(st.yawRate || 0) * dt;
      this.calm = 0;
    } else if (this.slideT > 0) {
      this.calm += dt;
      if (this.calm > 0.3) {
        if (this.spin > 690) this.award(`${Math.floor(this.spin / 360) * 360} spin`, 400 * Math.floor(this.spin / 360) + 600);
        else if (this.spin > 320) this.award('360 slide', 1100);
        else if (this.spin > 150) this.award('180 slide', 600);
        else if (this.slideT > 0.5) this.award(`Powerslide ${Math.round(this.slideMax)}°`, Math.round(this.slideMax * 6 * Math.min(2, this.slideT)));
        this.slideT = 0; this.slideMax = 0; this.spin = 0; this.calm = 0;
      }
    }

    // ---- wheelie / standing it up ----
    if (!st.airborne && (st.pitch || 0) > 22 && (st.wetPts || 0) > 0) this.wheelieT += dt;
    else {
      if (this.wheelieT > 0.7) this.award(`Wheelie ${this.wheelieT.toFixed(1)} s`, Math.round(300 * this.wheelieT));
      this.wheelieT = 0;
    }

    // ---- rooster tail ----
    this.tailCool = Math.max(0, this.tailCool - dt);
    if (spray.roosterHeight > 5) this.tailT += dt; else this.tailT = 0;
    if (this.tailT > 0.8 && this.tailCool === 0) { this.award(`Rooster tail ${spray.roosterHeight.toFixed(1)} m`, Math.round(60 * spray.roosterHeight)); this.tailCool = 4; this.tailT = 0; }

    // ---- submarine: nose and deck under, still riding ----
    if ((st.deckWet || 0) > 1.5 && (st.speed || 0) > 3) { this.subT += dt; if (this.subT > 0.4 && !this.subDone) { this.award('Submarine', 1200); this.subDone = true; } }
    else { this.subT = 0; if ((st.deckWet || 0) === 0) this.subDone = false; }
  }
}

function rot(q, x, y, z) {
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
}
