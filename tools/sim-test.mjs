// Physics test bench. Run: node tools/sim-test.mjs [craftId]
// Drives the ski through standard manoeuvres and prints numbers to compare
// with the real-world targets in RESEARCH.md.
import { Ocean } from '../src/waves.js';
import { CRAFTS } from '../src/craft.js';
import { Ski } from '../src/physics.js';

const MPH = 2.23694;
const ids = process.argv[2] ? [process.argv[2]] : Object.keys(CRAFTS);
const only = process.argv[3];

function make(id, cond = 'glass') {
  const oc = new Ocean(cond);
  const ski = new Ski(CRAFTS[id], oc);
  return { oc, ski };
}
function run(ski, seconds, fn) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) { fn && fn(t); ski.update(dt); if (ski.ejectReason) return t; }
  return null;
}
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

for (const id of ids) {
  console.log(`\n===== ${CRAFTS[id].name} =====`);

  if (!only || only === 'rest') {
    const { ski } = make(id);
    run(ski, 8);
    const st = ski.stats;
    const bow = ski.toWorld(ski.bowPos, { x: 0, y: 0, z: 0, add() { return this; } });
    console.log(`rest: pitch ${f1(st.pitch)} deg, roll ${f1(st.roll)}, CG y ${f2(ski.pos.y)}, immersion ${f2(st.immersion)}, wetPts ${st.wetPts}, rpm ${ski.rpm | 0} gear ${ski.gear}`);
    void bow;
  }

  if (!only || only === 'accel') {
    for (const lim of [true, false]) {
      const { ski } = make(id);
      ski.speedLimiterOn = lim;
      run(ski, 3);
      let t30 = null, t60 = null, maxPitch = -99, tPlane = null, t0 = 0;
      const log = [];
      run(ski, 30, (t) => {
        ski.input.throttle = 1;
        const v = ski.stats.fwdSpeed * MPH || 0;
        if (t30 === null && v >= 30) t30 = t;
        if (t60 === null && v >= 60) t60 = t;
        if (t < 6) maxPitch = Math.max(maxPitch, ski.stats.pitch || 0);
        if (tPlane === null && t > 0.5 && ski.stats.immersion < 0.45) tPlane = t;
        if (Math.abs(t - Math.round(t)) < 0.009 && t < 8) log.push(`${Math.round(t)}s:${f1(v)}mph ${ski.rpm | 0}rpm p${f1(ski.stats.pitch)} ${ski.stats.pumpState}`);
        void t0;
      });
      const st = ski.stats;
      console.log(`WOT limiter=${lim}: 0-30 ${t30 && f2(t30)}s, 0-60 ${t60 && f2(t60)}s, top ${f1(st.fwdSpeed * MPH)} mph @ ${ski.rpm | 0} rpm, pitch ${f1(st.pitch)}, maxPitch(hump) ${f1(maxPitch)}, plane@ ${tPlane && f2(tPlane)}s, wetLen ${f2(st.wetLen)}m, immersion ${f2(st.immersion)}`);
      if (lim) console.log('   ' + log.join(' | '));
    }
  }

  if (!only || only === 'turn') {
    for (const [lean, label] of [[0, 'neutral'], [1, 'lean in'], [-1, 'lean out']]) {
      const { ski } = make(id);
      run(ski, 2);
      run(ski, 6, () => { ski.input.throttle = 1; });
      // hold about 40 mph then turn hard right
      const v0 = ski.stats.fwdSpeed;
      let maxSlip = 0, sumLat = 0, n = 0, sumYaw = 0, sumRoll = 0;
      const ej = run(ski, 4, (t) => {
        ski.input.throttle = 1; ski.input.steer = 1; ski.input.leanX = lean;
        if (t > 1.5) { maxSlip = Math.max(maxSlip, ski.stats.slip); sumLat += ski.stats.gLat; sumYaw += ski.stats.yawRate; sumRoll += ski.stats.roll; n++; }
      });
      const st = ski.stats;
      const yaw = sumYaw / n;
      const radius = st.speed / Math.abs(yaw * Math.PI / 180);
      console.log(`turn ${label} from ${f1(v0 * MPH)}mph: speed now ${f1(st.speed * MPH)}mph, yaw ${f1(yaw)} deg/s, radius ${f1(radius)} m, latG ${f2(sumLat / n)}, roll ${f1(sumRoll / n)}, max slip ${f1(maxSlip)} deg, finStall ${f2(st.finStall)} ${ej !== null ? 'EJECTED ' + ski.ejectReason : ''}`);
    }
    // powerslide: hard turn plus iBR stab plus lean out
    const { ski } = make(id);
    run(ski, 2); run(ski, 6, () => { ski.input.throttle = 1; });
    let maxSlip = 0;
    const ej = run(ski, 3, (t) => {
      ski.input.steer = 1; ski.input.leanX = -0.6;
      ski.input.throttle = t > 0.35 ? 1 : 0; ski.input.lever = t < 0.35 ? 1 : 0;
      maxSlip = Math.max(maxSlip, ski.stats.slip);
    });
    console.log(`powerslide (brake stab + steer + lean out): max slip ${f1(maxSlip)} deg, speed after ${f1(ski.stats.speed * MPH)}mph ${ej !== null ? 'EJECTED ' + ski.ejectReason : ''}`);
  }

  if (!only || only === 'brake') {
    const { ski } = make(id);
    run(ski, 2); run(ski, 12, () => { ski.input.throttle = 1; });
    const v0 = ski.stats.fwdSpeed;
    const p0 = { x: ski.pos.x, z: ski.pos.z };
    let tStop = null;
    run(ski, 12, (t) => { ski.input.throttle = 0; ski.input.lever = 1; if (tStop === null && ski.stats.fwdSpeed < 0.5) tStop = t; });
    const dB = Math.hypot(ski.pos.x - p0.x, ski.pos.z - p0.z);
    const b2 = make(id).ski;
    run(b2, 2); run(b2, 12, () => { b2.input.throttle = 1; });
    const q0 = { x: b2.pos.x, z: b2.pos.z };
    let tc = null; const dist = [];
    run(b2, 25, (t) => { b2.input.throttle = 0; if (tc === null && b2.stats.fwdSpeed < 0.5) { tc = t; dist.push(Math.hypot(b2.pos.x - q0.x, b2.pos.z - q0.z)); } });
    console.log(`stop from ${f1(v0 * MPH)}mph: iBR ${tStop && f2(tStop)}s / ${f1(dB)}m (ends ${f1(ski.stats.fwdSpeed * MPH)}mph, gear ${ski.gear}); coasting ${tc && f2(tc)}s / ${dist[0] && f1(dist[0])}m`);
  }

  if (!only || only === 'trim') {
    for (const key of ['stock', 'max']) {
      const { ski } = make(id);
      if (!ski.craft.trimRanges.includes(key) && key !== 'stock') continue;
      ski.trimRangeKey = ski.craft.trimRanges.includes(key) ? key : ski.craft.trimRanges[0];
      run(ski, 2);
      run(ski, 8, () => { ski.input.throttle = 1; });
      let maxP = -99, minNoz = 99;
      const ej = run(ski, 6, () => { ski.input.throttle = 1; ski.trimTarget = ski.trimRange.max; maxP = Math.max(maxP, ski.stats.pitch); minNoz = Math.min(minNoz, ski.nozzleDepth); });
      console.log(`trim full up (${ski.trimRange.label} +${ski.trimRange.max}): speed ${f1(ski.stats.speed * MPH)}mph pitch ${f1(ski.stats.pitch)} (max ${f1(maxP)}), nozzle depth ${f2(ski.nozzleDepth)}m (min ${f2(minNoz)}) ${ej !== null ? 'EJECTED ' + ski.ejectReason : ''}`);
      const s2 = make(id).ski; s2.trimRangeKey = ski.trimRangeKey; run(s2, 2); run(s2, 8, () => { s2.input.throttle = 1; });
      run(s2, 6, () => { s2.input.throttle = 1; s2.trimTarget = s2.trimRange.min; });
      console.log(`trim full down: speed ${f1(s2.stats.speed * MPH)}mph pitch ${f1(s2.stats.pitch)} wetLen ${f2(s2.stats.wetLen)}`);
    }
  }

  if (!only || only === 'reverse') {
    const { ski } = make(id);
    run(ski, 2);
    run(ski, 5, () => { ski.input.lever = 1; ski.input.steer = 1; });
    console.log(`reverse + steer right: fwdSpeed ${f2(ski.stats.fwdSpeed)} m/s, yawRate ${f1(ski.stats.yawRate)} deg/s (negative = bow swings right), gear ${ski.gear}`);
  }
}
