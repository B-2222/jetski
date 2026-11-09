// Procedural jet ski + rider. Built from the same hull functions the physics uses,
// so what you see is what floats. Body frame: +z forward, +y up, +x LEFT.
import * as THREE from 'three';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Loft a closed, mirrored shell from half-sections (x >= 0), with UVs:
// u runs along the length (section.u), v runs around the section (0 keel .. 1 centreline top).
function loftMirrored(sections, { capStart = false, capEnd = false, colors = false } = {}) {
  const n = sections[0].pts.length;
  const pos = [], uv = [], col = [], idx = [];
  [1, -1].forEach((side, si) => {
    const base = si * sections.length * n;
    for (const s of sections) {
      for (let j = 0; j < n; j++) {
        pos.push(side * s.pts[j][0], s.pts[j][1], s.z);
        uv.push(s.u, j / (n - 1));
        if (colors) { const c = s.cols[j]; col.push(c.r, c.g, c.b); }
      }
    }
    for (let i = 0; i < sections.length - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j, b = base + (i + 1) * n + j, c = base + (i + 1) * n + j + 1, d = base + i * n + j + 1;
        if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
      }
    }
  });
  const addCap = (si, flip) => {
    const s = sections[si];
    let cy = 0;
    for (const p of s.pts) cy += p[1];
    cy /= n;
    const center = pos.length / 3;
    pos.push(0, cy, s.z); uv.push(s.u, 0.02);
    if (colors) { const c0 = s.cols[0]; col.push(c0.r * 0.8, c0.g * 0.8, c0.b * 0.8); }
    for (let side = 0; side < 2; side++) {
      const base = side * sections.length * n + si * n;
      for (let j = 0; j < n - 1; j++) {
        const a = base + j, b = base + j + 1;
        if ((side === 0) !== flip) idx.push(center, b, a); else idx.push(center, a, b);
      }
    }
  };
  if (capStart) addCap(0, false);
  if (capEnd) addCap(sections.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const hex = (c) => '#' + new THREE.Color(c).getHexString();

// Paint scheme on a canvas. u (x) = stern..bow, v (y) = keel..deck centreline.
function liveryTexture(c, profileN) {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const y = (j) => (1 - j / (profileN - 1)) * H;      // profile index -> canvas row (flipY)
  const hull = hex(c.color.hull), deck = hex(c.color.deck), acc = hex(c.color.accent), trim = hex(c.color.trim);
  g.fillStyle = deck; g.fillRect(0, 0, W, H);
  // lower hull (keel to just above the chine)
  g.fillStyle = hull; g.fillRect(0, y(6.4), W, H - y(6.4));
  // waterline pinstripe
  g.fillStyle = trim; g.fillRect(0, y(6.6), W, 5);
  // rub rail
  g.fillStyle = acc; g.fillRect(0, y(10.6), W, y(8.6) - y(10.6));
  const band = (y0, y1) => [y(y1), y(y0) - y(y1)];
  if (c.shape === 'rxp') {
    // aggressive dark slashes along the side
    g.fillStyle = acc;
    for (let i = 0; i < 7; i++) {
      const x0 = W * (0.18 + i * 0.075);
      g.beginPath();
      g.moveTo(x0, y(6.6)); g.lineTo(x0 + 70, y(6.6)); g.lineTo(x0 + 150, y(8.6)); g.lineTo(x0 + 80, y(8.6)); g.fill();
    }
    g.fillStyle = trim;
    g.beginPath(); g.moveTo(W * 0.72, y(6.6)); g.lineTo(W * 0.97, y(6.6)); g.lineTo(W * 0.99, y(8.6)); g.lineTo(W * 0.8, y(8.6)); g.fill();
    // deck flash
    g.fillStyle = acc; const [by, bh] = band(11.2, 12.4); g.fillRect(W * 0.62, by, W * 0.3, bh);
  } else if (c.shape === 'gti') {
    g.strokeStyle = '#f4f6f8'; g.lineWidth = 26;
    g.beginPath(); g.moveTo(W * 0.15, y(6.9)); g.bezierCurveTo(W * 0.4, y(8.8), W * 0.6, y(6.7), W * 0.95, y(8.2)); g.stroke();
    g.strokeStyle = trim; g.lineWidth = 8;
    g.beginPath(); g.moveTo(W * 0.2, y(7.3)); g.bezierCurveTo(W * 0.45, y(9.0), W * 0.62, y(7.0), W * 0.95, y(8.6)); g.stroke();
  } else {
    g.fillStyle = acc;
    for (let i = 0; i < 9; i++) {
      const x0 = W * (0.12 + i * 0.09);
      g.beginPath(); g.moveTo(x0, y(6.6)); g.lineTo(x0 + 46, y(8.6)); g.lineTo(x0 + 92, y(6.6)); g.fill();
    }
  }
  // fine flake / gelcoat noise so the paint is not flat
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 6;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// grip pattern for mats and seat stitching (used as bump + colour)
function patternTexture(kind, base) {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  if (kind === 'mat') {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = 0; x < S; x += 16) for (let y = 0; y < S; y += 16) { g.beginPath(); g.moveTo(x + 8, y + 2); g.lineTo(x + 14, y + 8); g.lineTo(x + 8, y + 14); g.lineTo(x + 2, y + 8); g.fill(); }
  } else {
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2; g.setLineDash([5, 4]);
    for (let i = -S; i < S * 2; i += 36) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); g.beginPath(); g.moveTo(i + S, 0); g.lineTo(i, S); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function orientBetween(mesh, a, b, baseLen, fwdHint) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  if (len < 1e-5) return;
  const Y = d.multiplyScalar(1 / len);
  if (fwdHint) {
    const Z = fwdHint.clone().addScaledVector(Y, -fwdHint.dot(Y)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  } else mesh.quaternion.setFromUnitVectors(v3(0, 1, 0), Y);
  mesh.scale.set(1, Math.max(0.05, len / baseLen), 1);
}

// two-bone IK: returns the middle joint position
function solveIK(root, target, l1, l2, pole) {
  const d = new THREE.Vector3().subVectors(target, root);
  let dist = d.length();
  const maxReach = (l1 + l2) * 0.999;
  if (dist > maxReach) { d.multiplyScalar(maxReach / dist); dist = maxReach; }
  const dir = d.clone().normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const poleDir = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return root.clone().addScaledVector(dir, a).addScaledVector(poleDir, h);
}

export class SkiModel {
  constructor(ski) {
    this.ski = ski;
    this.group = new THREE.Group();
    this.build();
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  build() {
    const ski = this.ski, c = ski.craft, L = ski.L, zs = ski.zStern;
    const sc = L / 3.32;

    const hb = (u) => {
      const b = c.beam / 2;
      if (u < 0.6) return b * (0.9 + 0.1 * Math.sin((u / 0.6) * Math.PI / 2));
      const r = (u - 0.6) / 0.4;
      return b * Math.max(0.03, Math.cos(r * Math.PI / 2) ** 0.85);
    };
    const yGun = (u) => 0.1 + (u > 0.68 ? (u - 0.68) * 0.42 : 0);
    const ySide = (u) => {
      if (u < 0.11) return 0.25;
      if (u < 0.6) return 0.17;
      return yGun(u) + 0.06 + 0.12 * Math.sin(Math.min(1, (u - 0.6) / 0.2) * Math.PI / 2) * (1 - Math.max(0, (u - 0.85) / 0.15));
    };
    const yCenter = (u) => {
      if (u < 0.11) return 0.27;
      if (u < 0.58) return 0.32;
      const r = (u - 0.58) / 0.42;
      return 0.32 + 0.26 * Math.sin(Math.min(1, r / 0.35) * Math.PI / 2) * (1 - Math.max(0, (r - 0.45) / 0.55)) ** 1.1;
    };
    this.yCenter = yCenter;

    // ---------- hull + deck shell ----------
    const sections = [];
    const N = 64;
    const PN = 16;
    for (let i = 0; i <= N; i++) {
      const u = Math.min(0.996, 0.5 - 0.5 * Math.cos((i / N) * Math.PI));
      const z = zs + u * L;
      const ky = ski.keelY(u);
      const hc = ski.halfChine(u);
      const tb = Math.tan(ski.deadriseAt(u));
      const yc = ky + hc * tb;
      const b = Math.max(hc + 0.02, hb(u));
      const yg = yGun(u);
      const deckEdgeY = Math.max(yg + 0.04, u > 0.6 ? ySide(u) - 0.02 : yg + 0.04);
      const pts = [
        [0, ky], [hc * 0.25, ky + hc * 0.25 * tb], [hc * 0.5, ky + hc * 0.5 * tb], [hc * 0.75, ky + hc * 0.75 * tb], [hc, yc],
        [hc + 0.035, yc + 0.004], [hc + 0.04, yc + 0.03],
        [hc + (b - hc) * 0.5, yc + (yg - yc) * 0.42], [hc + (b - hc) * 0.86, yc + (yg - yc) * 0.8],
        [b, yg - 0.035], [b + 0.012, yg], [b - 0.03, deckEdgeY],
        [Math.max(0.02, b * 0.8), Math.max(ySide(u), deckEdgeY) + 0.01], [Math.max(0.02, b * 0.6), ySide(u)],
        [Math.max(0.01, b * 0.3), (ySide(u) + yCenter(u)) * 0.5 + 0.03], [0, yCenter(u)],
      ];
      sections.push({ z, u, pts });
    }
    const hullGeo = loftMirrored(sections, { capStart: true, capEnd: true });
    const livery = liveryTexture(c, PN);
    const hullMat = new THREE.MeshPhysicalMaterial({ map: livery, roughness: 0.3, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.07 });
    this.hull = new THREE.Mesh(hullGeo, hullMat);
    this.group.add(this.hull);

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.55, metalness: 0.25 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xb4bbc2, roughness: 0.22, metalness: 0.95 });
    const trimMat = new THREE.MeshPhysicalMaterial({ color: c.color.trim, roughness: 0.35, metalness: 0.4, clearcoat: 0.6 });

    // ---------- footwell mats and rear deck mat ----------
    const matTex = patternTexture('mat', '#2a2e33');
    matTex.repeat.set(3, 8);
    const matMat = new THREE.MeshStandardMaterial({ map: matTex, bumpMap: matTex, bumpScale: 0.6, roughness: 0.95 });
    for (const s of [1, -1]) {
      const zA = zs + 0.14 * L, zB = zs + 0.58 * L;
      const w = hb(0.35) * 0.52;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, zB - zA), matMat);
      m.position.set(s * (hb(0.35) * 0.62), 0.177, (zA + zB) / 2);
      this.group.add(m);
    }
    const rear = new THREE.Mesh(new THREE.BoxGeometry(hb(0.05) * 1.5, 0.012, 0.11 * L), matMat);
    rear.position.set(0, 0.258, zs + 0.06 * L);
    this.group.add(rear);

    // ---------- seat ----------
    const seatSecs = [];
    const seatW = c.shape === 'rxp' ? 0.17 : c.shape === 'spark' ? 0.19 : 0.21;
    for (let i = 0; i <= 24; i++) {
      const u = 0.13 + i / 24 * 0.47;
      const r = (u - 0.13) / 0.47;
      const w = seatW * (1.05 - 0.25 * Math.sin(r * Math.PI) * (c.shape === 'rxp' ? 1 : 0.4)) * (r > 0.9 ? 1 - (r - 0.9) * 4 : 1);
      const top = 0.6 + 0.05 * r + (r < 0.15 ? -0.08 * (1 - r / 0.15) : 0) + (c.shape === 'rxp' && r > 0.15 && r < 0.3 ? 0.05 * Math.sin((r - 0.15) / 0.15 * Math.PI) : 0);
      const pts = [[0, 0.3], [w, 0.31], [w * 1.05, top - 0.09], [w * 1.02, top - 0.04], [w * 0.88, top - 0.012], [w * 0.55, top], [0, top + 0.008]];
      seatSecs.push({ z: zs + u * L, u: r, pts });
    }
    const seatTex = patternTexture('seat', hex(c.color.seat));
    seatTex.repeat.set(6, 2);
    const seatMat = new THREE.MeshStandardMaterial({ map: seatTex, bumpMap: seatTex, bumpScale: 0.4, roughness: 0.82 });
    this.group.add(new THREE.Mesh(loftMirrored(seatSecs, { capStart: true, capEnd: true }), seatMat));
    // seat side panels in the accent colour
    const bolster = new THREE.MeshStandardMaterial({ color: c.color.trim, roughness: 0.6 });
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.35 * L), bolster);
      p.position.set(s * seatW * 1.02, 0.5, zs + 0.37 * L);
      this.group.add(p);
    }

    // ---------- sponsons ----------
    const yS = ski.chineY(0.08);
    for (const s of [1, -1]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.5 * sc), darkMat);
      sp.position.set(s * (ski.halfChine(0.08) + 0.05), yS - c.sponsonDrop + 0.02, zs + 0.34 * sc);
      sp.rotation.z = s * 0.25;
      this.group.add(sp);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.006, 0.12), darkMat);
      fin.position.set(s * (ski.halfChine(0.08) + 0.08), yS - c.sponsonDrop - 0.01, zs + 0.18 * sc);
      this.group.add(fin);
    }

    // ---------- shark-gill vents (RXP-X) / side vents ----------
    if (c.shape === 'rxp') {
      for (const s of [1, -1]) for (let i = 0; i < 3; i++) {
        const u = 0.7 + i * 0.035;
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06 - i * 0.008, 0.07), darkMat);
        g.position.set(s * (hb(u) * 0.93), yGun(u) - 0.05, zs + u * L);
        g.rotation.set(0.5, s * 0.25, 0);
        this.group.add(g);
      }
    }

    // ---------- pump, nozzle (VTS + steering), reverse bucket (iBR), ride plate, intake grate ----------
    const ys = ski.keelY(0.0);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.26, 28), metalMat);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, ys + 0.1, zs + 0.02);
    this.group.add(pump);
    const ride = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.42), metalMat);
    ride.position.set(0, ys - 0.005, zs + 0.12);
    this.group.add(ride);
    const grate = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.4), metalMat);
      bar.position.x = (i - 2.5) * 0.04;
      grate.add(bar);
    }
    grate.position.copy(ski.intakePos).add(v3(0, -0.008, 0));
    this.group.add(grate);

    this.nozzle = new THREE.Group();
    this.nozzle.position.set(0, ys + 0.1, zs - 0.1);
    this.nozzle.rotation.order = 'YXZ';
    const nozMat = metalMat.clone(); nozMat.side = THREE.DoubleSide;
    const nozMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.17, 28, 1, true), nozMat);
    nozMesh.rotation.x = Math.PI / 2;
    nozMesh.position.z = -0.085;
    this.nozzle.add(nozMesh);
    const nozRing = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 10, 28), darkMat);
    nozRing.position.z = -0.17;
    this.nozzle.add(nozRing);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.058, 24), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1 }));
    throat.position.z = -0.03; throat.rotation.y = Math.PI;
    this.nozzle.add(throat);
    this.group.add(this.nozzle);

    this.bucket = new THREE.Group();
    this.bucket.position.set(0, ys + 0.24, zs - 0.12);
    const bucketGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.22, 24, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
    const bucketMesh = new THREE.Mesh(bucketGeo, new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }));
    bucketMesh.rotation.z = Math.PI / 2;
    bucketMesh.position.set(0, -0.02, -0.16);
    this.bucket.add(bucketMesh);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.2), darkMat);
    arm.position.set(0, 0, -0.06);
    this.bucket.add(arm);
    this.group.add(this.bucket);

    // reboarding step and tow eye
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.08), darkMat);
    step.position.set(0, ys + 0.2, zs - 0.05);
    this.group.add(step);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 8, 16), metalMat);
    eye.position.set(0, 0.32, zs + 0.03);
    this.group.add(eye);

    // ---------- handlebars ----------
    const uBar = 0.61;
    const barZ = zs + uBar * L;
    this.bars = new THREE.Group();
    this.bars.position.set(0, 0.6, barZ);
    this.bars.rotation.x = -0.42;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 16), darkMat);
    col.position.y = 0.13;
    this.bars.add(col);
    this.barCross = new THREE.Group();
    this.barCross.position.y = 0.27;
    const barW = c.shape === 'spark' ? 0.64 : 0.74;
    const barCurve = new THREE.CatmullRomCurve3([v3(-barW / 2, 0.03, -0.02), v3(-barW / 4, 0, 0), v3(barW / 4, 0, 0), v3(barW / 2, 0.03, -0.02)]);
    this.barCross.add(new THREE.Mesh(new THREE.TubeGeometry(barCurve, 20, 0.014, 10, false), metalMat));
    for (const s of [1, -1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.13, 14), rubber);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * (barW / 2 - 0.06), 0.025, -0.015);
      this.barCross.add(grip);
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), darkMat);
      end.position.set(s * (barW / 2 + 0.005), 0.03, -0.02);
      this.barCross.add(end);
      // throttle trigger (right) and iBR lever (left)
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.03), trimMat);
      lever.position.set(s * (barW / 2 - 0.08), 0.0, 0.05);
      lever.rotation.y = s * 0.25;
      this.barCross.add(lever);
      if (s < 0) this.throttleLever = lever; else this.brakeLever = lever;
    }
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.07), new THREE.MeshStandardMaterial({ color: c.color.accent, roughness: 0.7 }));
    pad.position.set(0, 0.025, 0);
    this.barCross.add(pad);
    this.bars.add(this.barCross);
    this.barW = barW;
    this.group.add(this.bars);

    // dash display with live readout
    this.dashCanvas = document.createElement('canvas'); this.dashCanvas.width = 256; this.dashCanvas.height = 112;
    this.dashTex = new THREE.CanvasTexture(this.dashCanvas); this.dashTex.colorSpace = THREE.SRGBColorSpace;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.088), new THREE.MeshStandardMaterial({ map: this.dashTex, emissive: 0xffffff, emissiveMap: this.dashTex, emissiveIntensity: 0.9, roughness: 0.15 }));
    dash.position.set(0, yCenter(0.665) + 0.055, zs + 0.665 * L);
    dash.rotation.set(-0.6, Math.PI, 0);
    this.group.add(dash);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.1, 0.02), darkMat);
    bezel.position.copy(dash.position).add(v3(0, -0.006, 0.008));
    bezel.rotation.x = -0.6;
    this.group.add(bezel);
    this.dashT = 0;
    for (const s of [1, -1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), darkMat);
      stalk.position.set(s * 0.29, yCenter(0.68) + 0.0, zs + 0.69 * L);
      stalk.rotation.z = s * 1.1;
      this.group.add(stalk);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.065, 0.025), darkMat);
      mirror.position.set(s * 0.36, yCenter(0.68) + 0.03, zs + 0.69 * L);
      this.group.add(mirror);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.05), metalMat);
      glass.position.set(s * 0.36, yCenter(0.68) + 0.03, zs + 0.69 * L - 0.014);
      glass.rotation.y = Math.PI;
      this.group.add(glass);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.01), new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, transparent: true, opacity: 0.55 }));
    visor.position.set(0, yCenter(0.7) + 0.06, zs + 0.7 * L);
    visor.rotation.x = -0.9;
    this.group.add(visor);
    const grab = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, 10, 20, Math.PI), darkMat);
    grab.position.set(0, 0.6, zs + 0.13 * L);
    grab.rotation.y = Math.PI / 2;
    this.group.add(grab);

    this.buildRider();
  }

  buildRider() {
    const r = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x1d2630, roughness: 0.72 });
    const vestMat = new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.55 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
    const helmetMat = new THREE.MeshPhysicalMaterial({ color: 0xf3f4f6, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 });
    const helmetAcc = new THREE.MeshPhysicalMaterial({ color: this.ski.craft.color.deck, roughness: 0.25, clearcoat: 1 });
    const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.7, clearcoat: 1 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.7 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
    const cap = (rad, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(rad, 1, 6, 14), mat);
    const sph = (rad, mat) => new THREE.Mesh(new THREE.SphereGeometry(rad, 18, 14), mat);
    // torso and vest as lathed shapes (pelvis at y=0, shoulders at y=0.5)
    const torsoProfile = [[0.001, -0.02], [0.13, 0.0], [0.14, 0.12], [0.15, 0.26], [0.165, 0.38], [0.155, 0.46], [0.1, 0.51], [0.001, 0.52]].map(([x, y]) => new THREE.Vector2(x, y));
    const torsoGeo = new THREE.LatheGeometry(torsoProfile, 24);
    torsoGeo.scale(1, 1, 0.72);
    const vestProfile = [[0.15, 0.09], [0.158, 0.2], [0.17, 0.32], [0.183, 0.4], [0.175, 0.46], [0.13, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
    const vestGeo = new THREE.LatheGeometry(vestProfile, 24);
    vestGeo.scale(1, 1, 0.78);
    const torso = new THREE.Mesh(torsoGeo, suit);
    const vest = new THREE.Mesh(vestGeo, vestMat);
    const straps = new THREE.Group();
    for (const y of [0.17, 0.3]) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(0.165 + y * 0.04, 0.012, 6, 24), strap);
      s.rotation.x = Math.PI / 2; s.scale.set(1, 0.78, 1); s.position.y = y;
      straps.add(s);
    }
    const body = new THREE.Group();
    body.add(torso, vest, straps);
    // helmet: shell, accent stripe, visor, chin bar, peak
    const head = new THREE.Group();
    const shell = sph(0.145, helmetMat); shell.scale.set(1, 1.05, 1.12);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.146, 0.018, 8, 28, Math.PI), helmetAcc);
    stripe.rotation.y = Math.PI / 2; stripe.scale.set(1.12, 1.05, 1);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.149, 20, 10, -Math.PI * 0.36, Math.PI * 0.72, Math.PI * 0.4, Math.PI * 0.2), visorMat);
    visor.scale.set(1, 1.05, 1.12);
    const chin = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 10, 20, Math.PI * 0.8), helmetMat);
    chin.rotation.set(Math.PI / 2, 0, Math.PI * 0.1 + Math.PI / 2); chin.position.set(0, -0.07, 0.03);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.1), helmetAcc);
    peak.position.set(0, 0.12, 0.13); peak.rotation.x = 0.25;
    head.add(shell, stripe, visor, chin, peak);
    this.rb = {
      body, head, pelvis: sph(0.15, suit), neck: cap(0.05, suit),
      shL: sph(0.07, vestMat), shR: sph(0.07, vestMat),
      uArmL: cap(0.05, suit), uArmR: cap(0.05, suit), fArmL: cap(0.045, suit), fArmR: cap(0.045, suit),
      elL: sph(0.05, suit), elR: sph(0.05, suit),
      thighL: cap(0.078, suit), thighR: cap(0.078, suit), shinL: cap(0.06, suit), shinR: cap(0.06, suit),
      knL: sph(0.068, suit), knR: sph(0.068, suit),
      handL: sph(0.048, glove), handR: sph(0.048, glove),
      footL: new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 4, 10), boot), footR: new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 4, 10), boot),
    };
    this.rb.footL.rotation.x = Math.PI / 2; this.rb.footR.rotation.x = Math.PI / 2;
    for (const m of Object.values(this.rb)) r.add(m);
    this.riderGroup = r;
    this.group.add(r);
    this.riderAttached = true;
  }

  poseRider() {
    const ski = this.ski, inp = ski.input, b = this.rb;
    const cg = ski.rider;
    const stand = Math.min(1.3, Math.max(-0.4, (cg.y - ski.riderSeat.y) / 0.33));
    const pelvis = v3(cg.x, cg.y - 0.1 - 0.02 * Math.max(0, stand), cg.z - 0.04);
    const leanF = 0.32 + 0.35 * Math.max(-0.6, inp.leanZ || 0) + 0.25 * Math.max(0, Math.min(1, stand));
    const side = -(inp.leanX || 0) * 0.35;
    const up = v3(Math.sin(side) * 0.6, Math.cos(leanF), Math.sin(leanF)).normalize();
    const shoulders = pelvis.clone().addScaledVector(up, 0.5);
    const fwdHint = v3(0, -up.z, up.y);
    orientBetween(b.body, pelvis, shoulders, 0.5, fwdHint);
    b.body.position.copy(pelvis);
    b.body.scale.set(1, 1, 1);
    b.pelvis.position.copy(pelvis); b.pelvis.scale.set(1, 0.8, 0.85);
    const neckTop = shoulders.clone().addScaledVector(up, 0.12);
    orientBetween(b.neck, shoulders, neckTop, 1.1);
    b.head.position.copy(neckTop).addScaledVector(up, 0.11).add(v3(0, 0, 0.02));
    b.head.rotation.set(-leanF * 0.6 + 0.3, 0, side * 0.5);

    this.bars.updateMatrix(); this.barCross.updateMatrix();
    const gripL = v3(this.barW / 2 - 0.06, 0.025, -0.015).applyMatrix4(this.barCross.matrix).applyMatrix4(this.bars.matrix);
    const gripR = v3(-(this.barW / 2 - 0.06), 0.025, -0.015).applyMatrix4(this.barCross.matrix).applyMatrix4(this.bars.matrix);
    const right = v3(-1, 0, 0);
    const shL = shoulders.clone().addScaledVector(right, -0.19).addScaledVector(up, -0.04), shR = shoulders.clone().addScaledVector(right, 0.19).addScaledVector(up, -0.04);
    b.shL.position.copy(shL); b.shR.position.copy(shR);
    const elbowPole = v3(0, -1, -0.3);
    const eL = solveIK(shL, gripL, 0.3, 0.3, elbowPole.clone().add(v3(0.7, 0, 0)));
    const eR = solveIK(shR, gripR, 0.3, 0.3, elbowPole.clone().add(v3(-0.7, 0, 0)));
    orientBetween(b.uArmL, shL, eL, 1.1); orientBetween(b.fArmL, eL, gripL, 1.09);
    orientBetween(b.uArmR, shR, eR, 1.1); orientBetween(b.fArmR, eR, gripR, 1.09);
    b.elL.position.copy(eL); b.elR.position.copy(eR);
    b.handL.position.copy(gripL); b.handR.position.copy(gripR);

    const fw = ski.footwell;
    const st = Math.max(0, Math.min(1, stand));
    const footL = v3(fw.x, fw.y + 0.03, fw.z - 0.1 * st), footR = v3(-fw.x, fw.y + 0.03, fw.z - 0.1 * st);
    const hipL = pelvis.clone().add(v3(0.1, 0, 0)), hipR = pelvis.clone().add(v3(-0.1, 0, 0));
    const kL = solveIK(hipL, footL, 0.45, 0.45, v3(0.5, 0.3, 1));
    const kR = solveIK(hipR, footR, 0.45, 0.45, v3(-0.5, 0.3, 1));
    orientBetween(b.thighL, hipL, kL, 1.156); orientBetween(b.shinL, kL, footL, 1.12);
    orientBetween(b.thighR, hipR, kR, 1.156); orientBetween(b.shinR, kR, footR, 1.12);
    b.knL.position.copy(kL); b.knR.position.copy(kR);
    b.footL.position.copy(footL).add(v3(0, -0.01, 0.07)); b.footR.position.copy(footR).add(v3(0, -0.01, 0.07));
  }

  updateDash(dt, unitsMph) {
    this.dashT -= dt;
    if (this.dashT > 0) return;
    this.dashT = 0.15;
    const g = this.dashCanvas.getContext('2d'), ski = this.ski;
    g.fillStyle = '#04090b'; g.fillRect(0, 0, 256, 112);
    g.fillStyle = '#45e3ff'; g.font = 'bold 58px sans-serif'; g.textAlign = 'right';
    g.fillText(String(Math.round(Math.max(0, ski.stats.fwdSpeed || 0) * (unitsMph ? 2.237 : 3.6))), 150, 66);
    g.font = 'bold 18px sans-serif'; g.fillStyle = '#8fb0b8'; g.textAlign = 'left';
    g.fillText(unitsMph ? 'MPH' : 'KM/H', 158, 64);
    g.fillText(ski.gear + '  ' + (ski.trim >= 0 ? '+' : '') + ski.trim.toFixed(0) + '°', 160, 34);
    const rf = Math.min(1, ski.rpm / ski.craft.rpmLimit);
    g.fillStyle = rf > 0.92 ? '#ff4d4d' : '#ffd21a';
    g.fillRect(14, 86, 228 * rf, 12);
    g.strokeStyle = '#30454b'; g.strokeRect(14, 86, 228, 12);
    this.dashTex.needsUpdate = true;
  }

  update(dt = 0, unitsMph = true) {
    const ski = this.ski;
    this.group.position.set(ski.origin.x, ski.origin.y, ski.origin.z);
    this.group.quaternion.set(ski.q.x, ski.q.y, ski.q.z, ski.q.w);
    this.nozzle.rotation.y = ski.steer * (ski.craft.steerAngle || 21) * Math.PI / 180;
    this.nozzle.rotation.x = ski.trim * Math.PI / 180;
    this.bucket.rotation.x = -0.25 + ski.bucket * 1.25;
    this.bucket.rotation.y = this.nozzle.rotation.y * 0.5;
    this.barCross.rotation.y = -ski.steer * 0.42;
    if (this.throttleLever) this.throttleLever.rotation.x = ski.throttle * 0.4;
    if (this.brakeLever) this.brakeLever.rotation.x = ski.lever * 0.4;
    if (dt) this.updateDash(dt, unitsMph);
    if (ski.riderOn) {
      if (!this.riderAttached) { this.group.add(this.riderGroup); this.riderGroup.position.set(0, 0, 0); this.riderGroup.quaternion.identity(); this.riderAttached = true; }
      this.poseRider();
    }
  }

  detachRider(scene) {
    if (!this.riderAttached) return;
    this.group.updateMatrixWorld();
    const m = this.riderGroup.matrixWorld.clone();
    scene.add(this.riderGroup);
    m.decompose(this.riderGroup.position, this.riderGroup.quaternion, this.riderGroup.scale);
    this.riderAttached = false;
  }
}
