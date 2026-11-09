// Powerslide / spin bench: node tools/slide-test.mjs [craft] [cond]
import { Ocean } from '../src/waves.js';
import { CRAFTS } from '../src/craft.js';
import { Ski } from '../src/physics.js';
const ids = process.argv[2] ? [process.argv[2]] : Object.keys(CRAFTS);
const cond = process.argv[3] || 'glass';
const MPH = 2.23694;
for (const id of ids) {
  console.log(`--- ${CRAFTS[id].name} (${cond})`);
  for (const [v0, lean, brake, label] of [[13, 0, 0, '30mph lock+gas'], [13, -1, 0, '30mph lock+gas lean out'], [18, -1, 0.3, '40mph brake stab, lean out'], [20, 1, 0, '45mph lock+gas lean in'], [20, 0, 0, '45mph lock+gas'], [20, -1, 0, '45mph lock+gas lean out'], [8, 0, 0, '18mph lock+gas']]) {
    const ski = new Ski(CRAFTS[id], new Ocean(cond));
    const dt = 1 / 60; let t = 0;
    for (; t < 2; t += dt) ski.update(dt);
    for (; t < 25 && ski.stats.fwdSpeed < v0; t += dt) { ski.input.throttle = 1; ski.update(dt); }
    let maxSlip = 0, yawTot = 0, ej = null, minSp = 99;
    for (let k = 0; k < 150; k++) {
      const tt = k * dt;
      ski.input.steer = 1; ski.input.leanX = lean;
      ski.input.lever = tt < brake ? 1 : 0; ski.input.throttle = tt < brake ? 0 : 1;
      const r = ski.update(dt);
      maxSlip = Math.max(maxSlip, Math.abs(ski.stats.slip)); yawTot += ski.stats.yawRate * dt;
      minSp = Math.min(minSp, ski.stats.speed);
      if (r) { ej = r; break; }
    }
    console.log(`${label.padEnd(30)} maxSlip ${maxSlip.toFixed(0).padStart(3)}  rotated ${Math.abs(yawTot).toFixed(0).padStart(4)} deg  speed after ${(ski.stats.speed * MPH).toFixed(0)} mph (min ${(minSp * MPH).toFixed(0)}) ${ej ? 'EJECTED ' + ej : ''}`);
  }
}
