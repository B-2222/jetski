import * as THREE from 'three';
import { Ocean, CONDITIONS } from './waves.js';
import { CRAFTS, TRIM_RANGES, RIDING_MODES } from './craft.js';
import { Ski, clamp } from './physics.js';
import { SkiModel } from './model.js';
import { OceanView, createSky } from './ocean.js';
import { Spray } from './effects.js';
import { SkiAudio } from './audio.js';
import { World } from './world.js';
import { Tricks } from './tricks.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const MPH = 2.23694, KMH = 3.6;
const store = {
  get(k, d) { try { const v = localStorage.getItem('rt_' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rt_' + k, v); } catch { /* storage blocked */ } },
};

// ---------------- renderer / scene ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
const sunDir = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
scene.fog = new THREE.FogExp2(0xb8d6e8, 0.0009);

const sky = createSky(scene, sunDir);
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1c4a5a, 0.85));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.position.copy(sunDir).multiplyScalar(100);
sun.castShadow = true;
sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
// environment reflections from the sky
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s2 = createSky(envScene, sunDir);
  s2.scale.setScalar(0.02);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(80, 32), new THREE.MeshBasicMaterial({ color: 0x0d3a48 }));
  bottom.rotation.x = -Math.PI / 2; bottom.position.y = -1;
  envScene.add(bottom);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
}

// ---------------- world state ----------------
const settings = {
  craft: store.get('craft', 'rxpx325'),
  cond: store.get('cond', 'chop'),
  units: store.get('units', 'mph'),
  limiter: store.get('limiter', 'on'),
  trim: null,
  sound: store.get('sound', 'on'),
  steerAssist: store.get('assist', 'on') === 'on',
  quality: store.get('quality', 'high'),
};
if (!['low', 'high', 'ultra'].includes(settings.quality)) settings.quality = 'high';
if (!CRAFTS[settings.craft]) settings.craft = 'rxpx325';
if (!CONDITIONS[settings.cond]) settings.cond = 'chop';

const ocean = new Ocean(settings.cond);
let ski = new Ski(CRAFTS[settings.craft], ocean);
let model = new SkiModel(ski);
scene.add(model.group);
const oceanView = new OceanView(scene, ocean, sunDir, settings.quality);
const spray = new Spray(scene, ocean);
spray.uniforms.uSunDir.value.copy(sunDir);
spray.jet.mesh.material.uniforms.uSunDir.value.copy(sunDir);
const audio = new SkiAudio();

const world = new World(scene, ocean);
const tricks = new Tricks((name, pts, mult) => {
  toast(`${name}  +${pts}${mult > 1 ? '  x' + mult : ''}`, mult > 1 ? 'cyan' : '');
});

// ---------------- post-processing / quality ----------------
let composer = null, bloom = null;
function applyQuality(q) {
  settings.quality = q; store.set('quality', q);
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(q === 'ultra' ? Math.min(dpr, 2) : q === 'high' ? Math.min(dpr, 1.5) : 1);
  renderer.shadowMap.enabled = q !== 'low';
  sun.castShadow = q !== 'low';
  const sm = q === 'ultra' ? 4096 : 2048;
  if (sun.shadow.map && sun.shadow.mapSize.x !== sm) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(sm, sm);
  oceanView.setQuality(q);
  spray.setQuality(q);
  if (composer) { composer.dispose(); composer = null; }
  if (q !== 'low') {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), q === 'ultra' ? 0.42 : 0.34, 0.55, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  resize();
}

// physics overlay (G): thrust vector, CG, wetted points, velocity
const overlay = new THREE.Group(); overlay.visible = false; scene.add(overlay);
const ovLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
ovLines.renderOrder = 999; ovLines.frustumCulled = false;
overlay.add(ovLines);
const ovPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x45e3ff, size: 0.07, depthTest: false }));
ovPts.renderOrder = 999; ovPts.frustumCulled = false;
overlay.add(ovPts);

// rider thrown off the ski
const thrownRider = { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: new THREE.Vector3(), inWater: false };

// ---------------- input ----------------
const keys = new Set();
const lastTap = {};
const input = { throttle: 0, lever: 0, steer: 0, leanX: 0, leanZ: 0, stand: 0 };
let paused = true;
let camMode = 0;
const CAMS = ['Chase', 'Far chase', 'Helmet', 'Rooster cam', 'Orbit'];
let unitsMph = settings.units === 'mph';
let touchMode = false;

function cycleCraft(id) {
  settings.craft = id; store.set('craft', id);
  scene.remove(model.group);
  if (!model.riderAttached) scene.remove(model.riderGroup);
  ski = new Ski(CRAFTS[id], ocean);
  ski.speedLimiterOn = settings.limiter === 'on';
  model = new SkiModel(ski);
  scene.add(model.group);
  thrownRider.active = false;
  $('thrown').hidden = true;
  refreshStatic();
  buildTrimScale();
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
  if (e.repeat) { keys.add(k); return; }
  keys.add(k);
  const now = performance.now();
  const dbl = lastTap[k] && now - lastTap[k] < 300;
  lastTap[k] = now;
  if (paused && k !== 'p' && k !== 'escape' && k !== 'enter') return;
  switch (k) {
    case 'e': if (dbl) { ski.input.trimFullUp = 1; toast('VTS full up', 'cyan'); } break;
    case 'q': if (dbl) { ski.input.trimNeutral = 1; toast('VTS neutral', 'cyan'); } break;
    case 't': ski.cycleTrimRange(); toast(ski.trimRange.label + ` ${ski.trimRange.min} to +${ski.trimRange.max}`, ski.trimRangeKey === 'max' ? 'warn' : 'cyan'); buildTrimScale(); refreshStatic(); break;
    case 'm': { const ks = Object.keys(RIDING_MODES); ski.mode = ks[(ks.indexOf(ski.mode) + 1) % ks.length]; toast(RIDING_MODES[ski.mode].label + ' mode'); refreshStatic(); break; }
    case 'l': if (ski.craft.hasLaunchControl) { ski.launchArmed = !ski.launchArmed; toast(ski.launchArmed ? 'Launch control armed' : 'Launch control off'); refreshStatic(); } else toast('No launch control on this ski', 'warn'); break;
    case 'c': camMode = (camMode + 1) % CAMS.length; toast(CAMS[camMode] + ' camera', 'cyan'); break;
    case 'f': ski.input.pop = 1; break;
    case 'k': ski.speedLimiterOn = !ski.speedLimiterOn; settings.limiter = ski.speedLimiterOn ? 'on' : 'off'; store.set('limiter', settings.limiter); toast(ski.speedLimiterOn ? 'Speed limiter on' : 'Speed limiter off (derestricted)', ski.speedLimiterOn ? '' : 'warn'); refreshStatic(); break;
    case 'r': if (e.shiftKey) { resetSki(); } else reboard(); break;
    case 'g': overlay.visible = !overlay.visible; toast(overlay.visible ? 'Physics overlay on' : 'Physics overlay off', 'cyan'); break;
    case 'h': $('help').hidden = !$('help').hidden; break;
    case 'u': unitsMph = !unitsMph; settings.units = unitsMph ? 'mph' : 'kmh'; store.set('units', settings.units); $('optUnits').value = settings.units; break;
    case 'v': { const ks = Object.keys(CONDITIONS); settings.cond = ks[(ks.indexOf(settings.cond) + 1) % ks.length]; ocean.setConditions(settings.cond); store.set('cond', settings.cond); $('optCond').value = settings.cond; toast(CONDITIONS[settings.cond].label); refreshStatic(); break; }
    case 'n': toggleSound(); break;
    case '1': cycleCraft('rxpx325'); break;
    case '2': cycleCraft('gti130'); break;
    case '3': cycleCraft('spark90'); break;
    case 'p': case 'escape': setPaused(!paused); break;
    case 'enter': if (paused) startRide(); break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// mouse drag orbits the camera
let drag = null, orbitYaw = 0, orbitPitch = 0.25, orbitDist = 7;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbitYaw -= (e.clientX - drag.x) * 0.006; orbitPitch = clamp(orbitPitch + (e.clientY - drag.y) * 0.004, -0.1, 1.3);
  drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { orbitDist = clamp(orbitDist * (1 + e.deltaY * 0.001), 3, 30); }, { passive: true });

// touch buttons
const touchState = {};
function buildTouch() {
  const t = $('touch');
  t.hidden = false;
  const defs = [
    ['left', '◀', 'left:max(16px, env(safe-area-inset-left, 0px));bottom:max(20px, env(safe-area-inset-bottom, 0px))'],
    ['right', '▶', 'left:calc(max(16px, env(safe-area-inset-left, 0px)) + 86px);bottom:max(20px, env(safe-area-inset-bottom, 0px))'],
    ['thr', 'GAS', 'right:max(16px, env(safe-area-inset-right, 0px));bottom:max(20px, env(safe-area-inset-bottom, 0px));width:86px;height:86px'],
    ['brk', 'iBR', 'right:calc(max(16px, env(safe-area-inset-right, 0px)) + 98px);bottom:max(20px, env(safe-area-inset-bottom, 0px))'],
    ['tup', 'TRIM+', 'right:max(16px, env(safe-area-inset-right, 0px));bottom:calc(max(20px, env(safe-area-inset-bottom, 0px)) + 100px);width:62px;height:62px;font-size:14px'],
    ['tdn', 'TRIM-', 'right:calc(max(16px, env(safe-area-inset-right, 0px)) + 72px);bottom:calc(max(20px, env(safe-area-inset-bottom, 0px)) + 100px);width:62px;height:62px;font-size:14px'],
  ];
  for (const [id, label, css] of defs) {
    const b = document.createElement('button');
    b.className = 'tbtn'; b.textContent = label; b.style.cssText = css; b.type = 'button';
    b.setAttribute('aria-label', id);
    const on = (e) => { e.preventDefault(); touchState[id] = true; b.classList.add('active'); };
    const off = (e) => { e.preventDefault(); touchState[id] = false; b.classList.remove('active'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    t.appendChild(b);
  }
}
window.addEventListener('touchstart', () => { if (!touchMode) { touchMode = true; buildTouch(); } }, { once: true, passive: true });

let padSteer = false;
function readInput(dt) {
  const k = (c) => keys.has(c);
  padSteer = false;
  let thr = k('w') ? (k('shift') ? 0.5 : 1) : 0;
  let lever = k('s') ? 1 : 0;
  let steerT = (k('d') ? 1 : 0) - (k('a') ? 1 : 0);
  let lx = (k('arrowright') ? 1 : 0) - (k('arrowleft') ? 1 : 0);
  let lz = (k('arrowup') ? 1 : 0) - (k('arrowdown') ? 1 : 0);
  let stand = k(' ') ? 1 : 0;
  let trimUp = k('e'), trimDown = k('q');
  if (touchMode) {
    if (touchState.thr) thr = 1;
    if (touchState.brk) lever = 1;
    steerT += (touchState.right ? 1 : 0) - (touchState.left ? 1 : 0);
    if (touchState.tup) trimUp = true;
    if (touchState.tdn) trimDown = true;
    lx += steerT * 0.8;   // touch: lean into turns automatically
  }
  // gamepad
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = (i) => (Math.abs(gp.axes[i] || 0) > 0.12 ? gp.axes[i] : 0);
    const bt = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
    thr = Math.max(thr, bt(7)); lever = Math.max(lever, bt(6));
    steerT += ax(0); lx += ax(2); lz += -ax(3);
    if (Math.abs(ax(0)) > 0) padSteer = true;
    if (bt(0) > 0.5) stand = 1;
    if (bt(5) > 0.5) trimUp = true;
    if (bt(4) > 0.5) trimDown = true;
    padEdge(gp, 3, () => { ski.cycleTrimRange(); buildTrimScale(); refreshStatic(); toast(ski.trimRange.label, 'cyan'); });
    padEdge(gp, 2, () => { ski.input.pop = 1; });
    padEdge(gp, 8, () => { camMode = (camMode + 1) % CAMS.length; toast(CAMS[camMode] + ' camera', 'cyan'); });
    padEdge(gp, 1, () => reboard());
    padEdge(gp, 9, () => setPaused(!paused));
    break;
  }
  // keyboard steering is digital, so ease it in like a real pair of bars, and (assist on)
  // limit the bar angle at speed the way a rider would. Analog sticks get the raw range.
  let target = clamp(steerT, -1, 1);
  if (settings.steerAssist && !padSteer) {
    const mph = (ski.stats.speed || 0) * MPH;
    target *= 1 - 0.35 * clamp((mph - 35) / 35, 0, 1);
  }
  input.steer += (target - input.steer) * Math.min(1, dt * (Math.abs(target) > Math.abs(input.steer) ? 7 : 10));
  input.throttle = thr; input.lever = lever;
  input.leanX += (clamp(lx, -1, 1) - input.leanX) * Math.min(1, dt * 8);
  input.leanZ += (clamp(lz, -1, 1) - input.leanZ) * Math.min(1, dt * 8);
  input.stand = stand;
  const si = ski.input;
  si.throttle = input.throttle; si.lever = input.lever; si.steer = input.steer;
  si.leanX = input.leanX; si.leanZ = input.leanZ; si.stand = input.stand;
  si.trimUp = trimUp ? 1 : 0; si.trimDown = trimDown ? 1 : 0;
}
const padPrev = {};
function padEdge(gp, i, fn) {
  const p = !!(gp.buttons[i] && gp.buttons[i].pressed);
  if (p && !padPrev[i]) fn();
  padPrev[i] = p;
}

// ---------------- ride lifecycle ----------------
function resetSki() {
  ski.reset(0, 0, 0);
  ski.speedLimiterOn = settings.limiter === 'on';
  if (settings.trim && ski.craft.trimRanges.includes(settings.trim)) ski.trimRangeKey = settings.trim;
  thrownRider.active = false;
  $('thrown').hidden = true;
  buildTrimScale(); refreshStatic();
}
function reboard() {
  if (ski.riderOn) return;
  ski.reboard();
  thrownRider.active = false;
  $('thrown').hidden = true;
  toast('Back on. Engine restarted in neutral', 'cyan');
}
function onEject(reason) {
  tricks.crash();
  model.detachRider(scene);
  const rp = model.riderGroup.position;
  Object.assign(thrownRider, { active: true, x: rp.x, y: rp.y, z: rp.z, vx: ski.vel.x * 0.9, vy: ski.vel.y + 2.5, vz: ski.vel.z * 0.9, inWater: false });
  thrownRider.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
  $('thrownWhy').textContent = reason;
  $('thrown').hidden = false;
}
function updateThrownRider(dt) {
  if (!thrownRider.active) return;
  const r = thrownRider, g = model.riderGroup;
  const surf = ocean.baseHeight(r.x, r.z);
  if (!r.inWater) {
    r.vy -= 9.81 * dt;
    r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    g.rotation.x += r.spin.x * dt; g.rotation.y += r.spin.y * dt; g.rotation.z += r.spin.z * dt;
    if (r.y < surf + 0.3) {
      r.inWater = true;
      spray.burst(r.x, surf, r.z, 140, 2 + Math.hypot(r.vx, r.vz) * 0.25, 3);
      audio.thump(3);
    }
  } else {
    const damp = Math.exp(-dt * 2.5);
    r.vx *= damp; r.vz *= damp;
    r.x += r.vx * dt; r.z += r.vz * dt;
    r.y += ((surf - 0.75) - r.y) * Math.min(1, dt * 4);
    // the life jacket rights you, head up
    g.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, g.rotation.y, 0)), Math.min(1, dt * 2));
    if (Math.hypot(r.vx, r.vz) > 1.5 && Math.random() < 0.5) spray.emit(r.x, surf, r.z, r.vx * 0.3, 1 + Math.random(), r.vz * 0.3, 0.2, 0.8, 3);
  }
  // position the rider group so its body frame stays near the float point
  g.position.set(r.x, r.y, r.z);
}

function setPaused(p) {
  paused = p;
  $('menu').hidden = !p;
  $('hud').hidden = p;
  if (!p) canvas.focus?.();
}
function startRide() {
  settings.cond = $('optCond').value; ocean.setConditions(settings.cond); store.set('cond', settings.cond);
  settings.limiter = $('optLimiter').value; store.set('limiter', settings.limiter);
  ski.speedLimiterOn = settings.limiter === 'on';
  settings.units = $('optUnits').value; unitsMph = settings.units === 'mph'; store.set('units', settings.units);
  settings.trim = $('optTrim').value;
  settings.steerAssist = $('optAssist').value === 'on'; store.set('assist', $('optAssist').value);
  if ($('optQuality').value !== settings.quality) applyQuality($('optQuality').value);
  if (ski.craft.trimRanges.includes(settings.trim)) ski.trimRangeKey = settings.trim;
  buildTrimScale(); refreshStatic();
  if (settings.sound === 'on') audio.start();
  setPaused(false);
}
function toggleSound() {
  if (audio.enabled) { audio.stop(); settings.sound = 'off'; } else { audio.start(); settings.sound = 'on'; }
  store.set('sound', settings.sound);
  $('soundBtn').textContent = settings.sound === 'on' ? 'Sound on' : 'Sound off';
}

// ---------------- menu ----------------
function buildMenu() {
  const wrap = $('crafts');
  wrap.innerHTML = '';
  for (const c of Object.values(CRAFTS)) {
    const b = document.createElement('button');
    b.className = 'craft'; b.type = 'button';
    b.setAttribute('aria-pressed', String(c.id === settings.craft));
    const hp = Math.round(c.powerKW * 1.341);
    b.innerHTML = `<span class="h">${c.hullName}</span><span class="n">${c.name}</span><span class="d">${c.blurb}</span>
      <span class="specs"><span>${hp} hp</span><span>${c.massBase} kg</span><span>${c.length} m</span><span>VTS ${TRIM_RANGES[c.trimRanges[0]].min} to +${TRIM_RANGES[c.trimRanges[0]].max}&deg;</span></span>`;
    b.addEventListener('click', () => { cycleCraft(c.id); buildMenu(); });
    wrap.appendChild(b);
  }
  const sel = $('optTrim');
  sel.innerHTML = '';
  for (const k of ski.craft.trimRanges) {
    const r = TRIM_RANGES[k];
    const o = document.createElement('option');
    o.value = k; o.textContent = `${r.label} (${r.min} to +${r.max}°)`;
    sel.appendChild(o);
  }
  sel.value = ski.trimRangeKey;
  $('optCond').value = settings.cond;
  $('optLimiter').value = settings.limiter;
  $('optUnits').value = settings.units;
  $('optAssist').value = settings.steerAssist ? 'on' : 'off';
  $('optQuality').value = settings.quality;
  $('soundBtn').textContent = settings.sound === 'on' ? 'Sound on' : 'Sound off';
}
const KEYS = [
  ['W', 'Throttle (Shift = half)'], ['S', 'iBR brake / reverse'], ['A / D', 'Steer'],
  ['← →', 'Lean body left / right'], ['↑ ↓', 'Weight forward / back'], ['Space', 'Stand up (hold)'],
  ['E / Q', 'VTS trim up / down'], ['E E / Q Q', 'Full up / neutral'], ['T', 'Trim range (MAX mod)'],
  ['M', 'Riding mode'], ['L', 'Launch control'], ['K', 'Speed limiter'],
  ['F', 'Pop (bunny hop)'], ['C', 'Camera'], ['G', 'Physics overlay'], ['R', 'Climb back on'],
  ['Shift R', 'Reset to start'], ['V', 'Water conditions'], ['1 2 3', 'Change ski'],
  ['U', 'mph / km/h'], ['N', 'Sound'], ['P', 'Menu'],
];
function buildKeys(el) { el.innerHTML = KEYS.map(([k, d]) => `<div><span>${d}</span><span class="k">${k}</span></div>`).join(''); }
buildKeys($('menuKeys')); buildKeys($('helpKeys'));
$('startBtn').addEventListener('click', startRide);
$('soundBtn').addEventListener('click', toggleSound);

// ---------------- HUD ----------------
const rpmBar = $('rpmBar');
for (let i = 0; i < 34; i++) rpmBar.appendChild(document.createElement('i'));
const rpmCells = [...rpmBar.children];
function buildTrimScale() {
  const el = $('trimScale');
  const r = ski.trimRange;
  const lo = Math.min(-10, r.min), hi = Math.max(30, r.max);
  const y = (d) => ((hi - d) / (hi - lo)) * 100;
  let html = `<div class="zone ${ski.trimRangeKey === 'max' ? 'max' : ''}" style="top:${y(r.max)}%;height:${y(r.min) - y(r.max)}%"></div>`;
  for (let d = lo; d <= hi; d += 5) html += `<div class="tick ${d === 0 ? 'zero' : ''}" style="top:${y(d)}%"></div>`;
  for (const d of [r.max, 0, r.min]) html += `<div class="lbl" style="top:${y(d)}%">${d > 0 ? '+' : ''}${d}</div>`;
  html += `<div class="needle" id="trimNeedle"></div>`;
  el.innerHTML = html;
  el._y = y;
}
function refreshStatic() {
  $('hName').textContent = ski.craft.name;
  $('hSub').textContent = ski.craft.hullName;
  $('hMode').textContent = RIDING_MODES[ski.mode].label;
  const rk = ski.trimRangeKey;
  $('hRange').textContent = ski.trimRange.label;
  $('hRange').className = 'chip ' + (rk === 'max' ? 'warn' : 'jet');
  $('hCond').textContent = CONDITIONS[settings.cond].label;
  $('hLimiter').textContent = ski.speedLimiterOn ? 'Limiter on' : 'Derestricted';
  $('hLimiter').className = 'chip ' + (ski.speedLimiterOn ? '' : 'warn');
  $('hLaunch').hidden = !ski.launchArmed;
  $('hLaunch').className = 'chip ok';
}
const toastEl = $('toasts');
function toast(text, kind = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.textContent = text;
  toastEl.appendChild(d);
  setTimeout(() => d.remove(), 2700);
  while (toastEl.children.length > 4) toastEl.firstChild.remove();
}

const feats = { top: 0, slide: 0, air: 0, tail: 0 };
let slideTimer = 0, slideMax = 0, hudTimer = 0;
spray.onLanding = (air, vy) => {
  if (air > feats.air) feats.air = air;
  audio.thump(vy);
};

function updateHUD(dt) {
  const st = ski.stats;
  const spd = (st.fwdSpeed || 0) * (unitsMph ? MPH : KMH);
  $('spd').textContent = Math.max(0, Math.round(Math.abs(spd)));
  $('spdUnit').textContent = unitsMph ? 'mph' : 'km/h';
  const rpmFrac = ski.rpm / ski.craft.rpmLimit;
  const lit = Math.round(rpmFrac * 34);
  rpmCells.forEach((c, i) => { c.className = i < lit ? 'on' + (i > 30 ? ' red' : i > 26 ? ' hi' : '') : ''; });
  $('thrB').style.width = (ski.throttle * 100).toFixed(0) + '%';
  $('brkB').style.width = (ski.lever * 100).toFixed(0) + '%';
  $('fuelB').style.width = (ski.fuelL / ski.craft.fuelCapacityL * 100).toFixed(0) + '%';
  for (const g of ['F', 'N', 'R']) $('g' + g).className = ski.gear === g ? 'on' : '';
  const ts = $('trimScale');
  const nd = $('trimNeedle');
  if (nd && ts._y) { nd.style.top = ts._y(ski.trim) + '%'; nd.className = 'needle' + (ski.trim > 9.5 ? ' max' : ''); }
  // lean pad
  const dot = $('leanDot');
  dot.style.left = (50 + (-ski.rider.x / 0.35) * 40) + '%';
  dot.style.top = (50 - ((ski.rider.z - ski.riderSeat.z) / (0.36 * ski.L / 3.3 + 0.2)) * 40) + '%';
  dot.className = 'dot' + (ski.input.stand ? ' stand' : '');
  // slip
  const slip = st.slip || 0;
  const moving = (st.speed || 0) > 3;
  const slipShown = moving ? slip : 0;
  const fill = $('slipFill');
  const w = Math.min(50, Math.abs(slipShown) / 90 * 50);
  fill.style.width = w + '%';
  fill.style.left = slipShown >= 0 ? '50%' : (50 - w) + '%';
  $('slipBar').className = 'slipbar' + (Math.abs(slipShown) > 15 ? ' slide' : '');

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.08;
    $('rpmNum').textContent = Math.round(ski.rpm / 10) * 10;
    $('trimNum').innerHTML = (ski.trim > 0 ? '+' : '') + ski.trim.toFixed(1) + '&deg;';
    $('slipNum').innerHTML = Math.round(Math.abs(slipShown)) + '&deg;';
    $('gLat').textContent = (st.gLat || 0).toFixed(2);
    $('rollNum').innerHTML = Math.round(st.roll || 0) + '&deg;';
    $('pitchNum').innerHTML = Math.round(st.pitch || 0) + '&deg;';
    const pump = $('pump');
    pump.textContent = ski.engineOn ? (ski.limiterCut && st.pumpState !== 'HOOKED' ? 'REV LIMIT' : st.pumpState) : 'ENGINE OFF';
    pump.className = 'chip ' + (!ski.engineOn ? 'bad' : st.pumpState === 'HOOKED' ? 'ok' : st.pumpState === 'AIR' ? 'bad' : 'warn');
    $('tailNum').textContent = spray.roosterHeight.toFixed(1) + ' m';
    $('jetNum').textContent = Math.round(ski.jetSpeed || 0) + ' m/s';
    $('thrustNum').textContent = Math.round(Math.max(0, ski.thrust)) + ' N';
    const unit = unitsMph ? MPH : KMH;
    $('fScore').textContent = tricks.score.toLocaleString();
    $('fCombo').textContent = tricks.combo > 1 ? 'x' + Math.min(5, tricks.combo) : '';
    $('fTop').textContent = Math.round(feats.top * unit) + (unitsMph ? ' mph' : ' km/h');
    $('fSlide').innerHTML = Math.round(feats.slide) + '&deg;';
    $('fAir').textContent = feats.air.toFixed(1) + ' s';
    $('fTail').textContent = feats.tail.toFixed(1) + ' m';
  }
  // records + slide callouts
  if ((st.fwdSpeed || 0) > feats.top) feats.top = st.fwdSpeed;
  if (spray.roosterHeight > feats.tail) feats.tail = spray.roosterHeight;
  if (moving && st.wetPts > 0 && ski.riderOn) feats.slide = Math.max(feats.slide, Math.abs(slip) > 20 ? Math.abs(slip) : 0);
}

// ---------------- camera ----------------
const camPos = new THREE.Vector3(0, 3, -8);
const camLook = new THREE.Vector3();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let camFov = 62;
function updateCamera(dt) {
  const p = new THREE.Vector3(ski.pos.x, ski.pos.y, ski.pos.z);
  const head = ski.stats.heading || 0;
  const fwd = new THREE.Vector3(Math.sin(head), 0, Math.cos(head));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(-1);
  const speed = ski.stats.speed || 0;
  let desired, look, follow = 6;
  const yawOff = drag ? orbitYaw : (orbitYaw *= Math.exp(-dt * 1.5));
  const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOff);
  model.rb.head.visible = CAMS[camMode] !== 'Helmet' || !ski.riderOn;
  switch (CAMS[camMode]) {
    case 'Chase':
      desired = p.clone().add(rot(fwd.clone().multiplyScalar(-6.2 - speed * 0.04))).add(new THREE.Vector3(0, 2.1 + speed * 0.01, 0));
      look = p.clone().add(fwd.clone().multiplyScalar(3)).add(new THREE.Vector3(0, 0.6, 0));
      break;
    case 'Far chase':
      desired = p.clone().add(rot(fwd.clone().multiplyScalar(-12))).add(new THREE.Vector3(0, 4.2, 0));
      look = p.clone().add(fwd.clone().multiplyScalar(4));
      follow = 4;
      break;
    case 'Helmet': {
      if (ski.riderOn) {
        model.group.updateMatrixWorld();
        const hp = model.rb.head.getWorldPosition(new THREE.Vector3());
        const q = new THREE.Quaternion(ski.q.x, ski.q.y, ski.q.z, ski.q.w);
        const f3 = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        camPos.copy(hp).add(new THREE.Vector3(0, 0.08, 0)).addScaledVector(f3, 0.12);
        camLook.copy(camPos).addScaledVector(f3, 10).add(new THREE.Vector3(0, -1.2, 0));
        camera.position.copy(camPos);
        camera.up.set(0, 1, 0).lerp(new THREE.Vector3(0, 1, 0).applyQuaternion(q), 0.35).normalize();
        camera.lookAt(camLook);
        setFov(72, dt);
        return;
      }
      desired = p.clone().add(fwd.clone().multiplyScalar(-6)).add(new THREE.Vector3(0, 2, 0));
      look = p.clone();
      break;
    }
    case 'Rooster cam':
      desired = p.clone().add(rot(fwd.clone().multiplyScalar(-4.5))).add(right.clone().multiplyScalar(5.5)).add(new THREE.Vector3(0, 1.0, 0));
      look = p.clone().add(fwd.clone().multiplyScalar(-2.5)).add(new THREE.Vector3(0, 1.2, 0));
      follow = 8;
      break;
    case 'Orbit':
    default: {
      const ang = head + Math.PI + orbitYaw;
      desired = p.clone().add(new THREE.Vector3(Math.sin(ang) * Math.cos(orbitPitch), Math.sin(orbitPitch), Math.cos(ang) * Math.cos(orbitPitch)).multiplyScalar(orbitDist));
      look = p.clone().add(new THREE.Vector3(0, 0.5, 0));
      follow = 10;
    }
  }
  camera.up.set(0, 1, 0);
  const k = 1 - Math.exp(-dt * follow);
  camPos.lerp(desired, k);
  camLook.lerp(look, 1 - Math.exp(-dt * 12));
  const floor = ocean.height(camPos.x, camPos.z) + 0.45;
  if (camPos.y < floor) camPos.y = floor;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  setFov(60 + Math.min(14, speed * 0.35), dt);
}
function setFov(target, dt) {
  camFov += (target - camFov) * Math.min(1, dt * 2);
  camera.fov = camFov;
  camera.updateProjectionMatrix();
}

function updateOverlay() {
  if (!overlay.visible) return;
  const pos = [], col = [];
  const line = (a, b, c) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c[0], c[1], c[2], c[0], c[1], c[2]); };
  const q = new THREE.Quaternion(ski.q.x, ski.q.y, ski.q.z, ski.q.w);
  if (ski.nozzleWorld) {
    const d = ski.nozzleDirBody;
    const dw = new THREE.Vector3(d.x, d.y, d.z).applyQuaternion(q);
    const a = new THREE.Vector3(ski.nozzleWorld.x, ski.nozzleWorld.y, ski.nozzleWorld.z);
    line(a, a.clone().addScaledVector(dw, ski.thrust / 1500), [1, 0.5, 0.15]);
  }
  const cg = new THREE.Vector3(ski.pos.x, ski.pos.y, ski.pos.z);
  for (const ax of [[0.25, 0, 0], [0, 0.25, 0], [0, 0, 0.25]]) {
    const v = new THREE.Vector3(...ax).applyQuaternion(q);
    line(cg.clone().sub(v), cg.clone().add(v), [1, 0.82, 0.1]);
  }
  line(cg, cg.clone().add(new THREE.Vector3(ski.vel.x, ski.vel.y, ski.vel.z).multiplyScalar(0.15)), [0.3, 1, 0.5]);
  ovLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ovLines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const wp = [];
  const w = new THREE.Vector3();
  for (const p of ski.bottom) {
    w.set(p.pos.x, p.pos.y, p.pos.z).applyQuaternion(q).add(ski.origin);
    if (ocean.height(w.x, w.z) > w.y) wp.push(w.x, w.y, w.z);
  }
  ovPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
}

// ---------------- main loop ----------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  spray.uniforms.uScale.value = h * 0.5 / Math.tan(camera.fov * Math.PI / 360) * renderer.getPixelRatio();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let idleSpin = 0;
function stepGame(dt) {
  if (!paused) {
    readInput(dt);
    const why = ski.update(dt);
    if (why) onEject(why);
    world.update(dt, ski, spray);
    spray.emitFromSki(ski, dt);
    tricks.update(dt, ski, spray);
    updateThrownRider(dt);
    updateHUD(dt);
    updateCamera(dt);
    audio.update(ski, dt);
  } else {
    // menu backdrop: the ski idling on the water with a slow orbit
    ski.input.throttle = 0; ski.input.lever = 0;
    ski.update(dt);
    world.update(dt, ski, spray);
    idleSpin += dt * 0.12;
    const p = ski.pos;
    camera.position.set(p.x + Math.sin(idleSpin) * 7, ocean.height(p.x, p.z) + 1.6, p.z + Math.cos(idleSpin) * 7);
    camera.up.set(0, 1, 0);
    camera.lookAt(p.x, p.y + 0.4, p.z);
    camPos.copy(camera.position);
  }
  model.update(dt, unitsMph);
  spray.update(dt);
}
function render() {
  oceanView.update(camera, ski);
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = ocean.t;
  spray.uniforms.uScale.value = window.innerHeight * 0.5 / Math.tan(camera.fov * Math.PI / 360) * renderer.getPixelRatio();
  updateOverlay();
  sun.position.set(ski.pos.x + sunDir.x * 40, ski.pos.y + sunDir.y * 40, ski.pos.z + sunDir.z * 40);
  sun.target.position.set(ski.pos.x, ski.pos.y, ski.pos.z);
  if (composer) composer.render(); else renderer.render(scene, camera);
}
let autoRun = true;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (autoRun) { stepGame(dt); render(); }
  requestAnimationFrame(frame);
}

// Scripted control for tests and screenshots: run the game in fixed steps.
// script(t) returns { keys: [...] } or sets inputs directly through the ski.
function advance(seconds, script) {
  autoRun = false;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    if (script) {
      const want = script(t, ski) || [];
      keys.clear();
      for (const k of want) keys.add(k);
    }
    stepGame(dt);
  }
  render();
}

// expose for testing / tinkering in the console
window.rooster = { get ski() { return ski; }, ocean, spray, settings, setPaused, startRide, toast, camera, advance, resume: () => { autoRun = true; last = performance.now(); }, setCam: (i) => { camMode = i; }, cycleCraft, resetSki, tricks, world, applyQuality, setOverlay: (v) => { overlay.visible = v; }, keys };

applyQuality(settings.quality);
buildMenu();
buildTrimScale();
refreshStatic();
setPaused(true);
requestAnimationFrame(frame);
