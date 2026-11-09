// Procedural jet ski + rider. Built from the same hull functions the physics uses,
// so what you see is what floats. Body frame: +z forward, +y up, +x LEFT.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Loft a closed, mirrored shell from half-sections (x >= 0).
// sections: [{ z, pts: [[x, y], ...], cols: [THREE.Color, ...] }], all with the same point count.
function loftMirrored(sections, { capStart = false, capEnd = false } = {}) {
  const n = sections[0].pts.length;
  const pos = [], col = [], idx = [];
  const sides = [1, -1];
  sides.forEach((side, si) => {
    const base = si * sections.length * n;
    for (const s of sections) {
      for (let j = 0; j < n; j++) {
        pos.push(side * s.pts[j][0], s.pts[j][1], s.z);
        const c = s.cols[j];
        col.push(c.r, c.g, c.b);
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
    let cx = 0, cy = 0;
    for (const p of s.pts) cy += p[1];
    cy /= n;
    const center = pos.length / 3;
    pos.push(cx, cy, s.z);
    const c0 = s.cols[0];
    col.push(c0.r * 0.8, c0.g * 0.8, c0.b * 0.8);
    for (let side = 0; side < 2; side++) {
      const base = side * sections.length * n + si * n;
      for (let j = 0; j < n - 1; j++) {
        const a = base + j, b = base + j + 1;
        const f = (side === 0) !== flip;
        if (f) idx.push(center, b, a); else idx.push(center, a, b);
      }
    }
  };
  if (capStart) addCap(0, false);
  if (capEnd) addCap(sections.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function boneBetween(mesh, a, b, baseLen) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(v3(0, 1, 0), d.multiplyScalar(1 / len));
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
  }

  build() {
    const ski = this.ski, c = ski.craft, L = ski.L, zs = ski.zStern;
    const colHull = new THREE.Color(c.color.hull);
    const colDeck = new THREE.Color(c.color.deck);
    const colAccent = new THREE.Color(c.color.accent);
    const colTrim = new THREE.Color(c.color.trim);
    const colMat = new THREE.Color(0x2a2d31);
    const sc = L / 3.32;

    const hb = (u) => {
      const b = c.beam / 2;
      if (u < 0.6) return b * (0.9 + 0.1 * Math.sin((u / 0.6) * Math.PI / 2));
      const r = (u - 0.6) / 0.4;
      return b * Math.max(0.03, Math.cos(r * Math.PI / 2) ** 0.85);
    };
    const yGun = (u) => 0.1 + (u > 0.68 ? (u - 0.68) * 0.42 : 0);
    // deck heights
    const ySide = (u) => {
      if (u < 0.11) return 0.25;                          // rear boarding platform
      if (u < 0.6) return 0.17;                           // footwells
      return yGun(u) + 0.06 + 0.12 * Math.sin(Math.min(1, (u - 0.6) / 0.2) * Math.PI / 2) * (1 - Math.max(0, (u - 0.85) / 0.15));
    };
    const yCenter = (u) => {
      if (u < 0.11) return 0.27;
      if (u < 0.58) return 0.32;                          // engine tunnel under the seat
      const r = (u - 0.58) / 0.42;
      return 0.32 + 0.26 * Math.sin(Math.min(1, r / 0.35) * Math.PI / 2) * (1 - Math.max(0, (r - 0.45) / 0.55)) ** 1.1;
    };

    // ---------- hull + deck shell ----------
    const sections = [];
    const N = 34;
    for (let i = 0; i <= N; i++) {
      const u = Math.min(0.995, (i / N) ** 1.0);
      const z = zs + u * L;
      const ky = ski.keelY(u);
      const hc = ski.halfChine(u);
      const tb = Math.tan(ski.deadriseAt(u));
      const yc = ky + hc * tb;
      const b = Math.max(hc + 0.02, hb(u));
      const yg = yGun(u);
      const deckEdgeY = Math.max(yg + 0.04, u > 0.6 ? ySide(u) - 0.02 : yg + 0.04);
      const stripe = u > 0.18 && u < 0.85;
      const pts = [
        [0, ky], [hc * 0.35, ky + hc * 0.35 * tb], [hc * 0.7, ky + hc * 0.7 * tb], [hc, yc],
        [hc + 0.035, yc + 0.004], [hc + 0.04, yc + 0.03],
        [hc + (b - hc) * 0.75, (yc + yg) * 0.5 + 0.01],
        [b, yg - 0.035], [b + 0.01, yg], [b - 0.03, deckEdgeY],
        [Math.max(0.02, b * 0.62), ySide(u)], [Math.max(0.01, b * 0.3), (ySide(u) + yCenter(u)) * 0.5 + 0.03], [0, yCenter(u)],
      ];
      const cols = [colHull, colHull, colHull, colHull, colHull, colHull,
        stripe ? colDeck : colHull, colAccent, colAccent, colDeck,
        u > 0.11 && u < 0.6 ? colMat : colDeck, colDeck, colDeck];
      sections.push({ z, pts, cols });
    }
    const hullGeo = loftMirrored(sections, { capStart: true, capEnd: true });
    const hullMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.18 });
    this.hull = new THREE.Mesh(hullGeo, hullMat);
    this.group.add(this.hull);

    // ---------- seat (narrow Ergolock style on the RXP) ----------
    const seatSecs = [];
    const seatW = c.shape === 'rxp' ? 0.17 : c.shape === 'spark' ? 0.19 : 0.21;
    const colSeat = new THREE.Color(c.color.seat);
    const colSeatSide = new THREE.Color(c.color.seat).multiplyScalar(1.6);
    for (let i = 0; i <= 14; i++) {
      const u = 0.13 + i / 14 * 0.47;
      const r = (u - 0.13) / 0.47;
      const w = seatW * (1.05 - 0.25 * Math.sin(r * Math.PI) * (c.shape === 'rxp' ? 1 : 0.4)) * (r > 0.9 ? 1 - (r - 0.9) * 4 : 1);
      const top = 0.6 + 0.05 * r + (r < 0.15 ? -0.08 * (1 - r / 0.15) : 0) + (c.shape === 'rxp' && r > 0.15 && r < 0.3 ? 0.05 : 0);
      const pts = [[0, 0.3], [w, 0.31], [w * 1.05, top - 0.09], [w * 0.92, top - 0.02], [w * 0.55, top], [0, top + 0.008]];
      seatSecs.push({ z: zs + u * L, pts, cols: [colSeatSide, colSeatSide, colSeatSide, colSeat, colSeat, colSeat] });
    }
    const seatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.group.add(new THREE.Mesh(loftMirrored(seatSecs, { capStart: true, capEnd: true }), seatMat));

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.2 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.3, metalness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: colTrim, roughness: 0.45, metalness: 0.3 });

    // ---------- sponsons ----------
    const yS = ski.chineY(0.08);
    for (const s of [1, -1]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.5 * sc), darkMat);
      sp.position.set(s * (ski.halfChine(0.08) + 0.05), yS - c.sponsonDrop + 0.02, zs + 0.34 * sc);
      sp.rotation.z = s * 0.25;
      this.group.add(sp);
    }

    // ---------- pump, nozzle (VTS + steering), reverse bucket (iBR), ride plate, intake grate ----------
    const ys = ski.keelY(0.0);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.26, 20), metalMat);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, ys + 0.1, zs + 0.02);
    this.group.add(pump);
    const ride = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.42), metalMat);
    ride.position.set(0, ys - 0.005, zs + 0.12);
    this.group.add(ride);
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.4), darkMat);
    grate.position.copy(ski.intakePos).add(v3(0, -0.005, 0));
    this.group.add(grate);

    this.nozzle = new THREE.Group();
    this.nozzle.position.set(0, ys + 0.1, zs - 0.1);
    this.nozzle.rotation.order = 'YXZ';
    const nozMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.17, 20, 1, true), metalMat);
    nozMesh.material = metalMat.clone(); nozMesh.material.side = THREE.DoubleSide;
    nozMesh.rotation.x = Math.PI / 2;
    nozMesh.position.z = -0.085;
    this.nozzle.add(nozMesh);
    const nozRing = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 8, 20), darkMat);
    nozRing.position.z = -0.17;
    this.nozzle.add(nozRing);
    this.group.add(this.nozzle);

    this.bucket = new THREE.Group();
    this.bucket.position.set(0, ys + 0.24, zs - 0.12);
    const bucketGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.22, 18, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
    const bucketMesh = new THREE.Mesh(bucketGeo, new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
    bucketMesh.rotation.z = Math.PI / 2;
    bucketMesh.position.set(0, -0.02, -0.16);
    this.bucket.add(bucketMesh);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.2), darkMat);
    arm.position.set(0, 0, -0.06);
    this.bucket.add(arm);
    this.group.add(this.bucket);

    // ---------- handlebars ----------
    const uBar = 0.61;
    const barZ = zs + uBar * L;
    this.bars = new THREE.Group();
    this.bars.position.set(0, 0.6, barZ);
    this.bars.rotation.x = -0.42;          // steering column raked back
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 12), darkMat);
    col.position.y = 0.13;
    this.bars.add(col);
    this.barCross = new THREE.Group();
    this.barCross.position.y = 0.27;
    const barW = c.shape === 'spark' ? 0.64 : 0.74;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, barW, 10), metalMat);
    bar.rotation.z = Math.PI / 2;
    this.barCross.add(bar);
    for (const s of [1, -1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.13, 10), darkMat);
      grip.rotation.z = Math.PI / 2;
      grip.position.x = s * (barW / 2 - 0.06);
      this.barCross.add(grip);
    }
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), trimMat);
    pad.position.set(0, 0.02, 0);
    this.barCross.add(pad);
    this.bars.add(this.barCross);
    this.barW = barW;
    this.group.add(this.bars);

    // gauge display + mirrors on the console
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.03), new THREE.MeshStandardMaterial({ color: 0x0c1418, emissive: 0x0f6f78, emissiveIntensity: 0.6, roughness: 0.2 }));
    dash.position.set(0, yCenterAt(0.665) + 0.05, zs + 0.665 * L);
    dash.rotation.x = -0.6;
    this.group.add(dash);
    function yCenterAt(u) { return yCenter(u); }
    for (const s of [1, -1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.02), darkMat);
      mirror.position.set(s * 0.34, yCenter(0.68) + 0.0, zs + 0.69 * L);
      this.group.add(mirror);
    }
    // small windscreen visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.01), new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, transmission: 0.3, transparent: true, opacity: 0.6 }));
    visor.position.set(0, yCenter(0.7) + 0.06, zs + 0.7 * L);
    visor.rotation.x = -0.9;
    this.group.add(visor);
    // rear grab handle and tow hook
    const grab = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 16, Math.PI), darkMat);
    grab.position.set(0, 0.6, zs + 0.13 * L);
    grab.rotation.y = Math.PI / 2;
    this.group.add(grab);

    // ---------- rider ----------
    this.buildRider();
  }

  buildRider() {
    const r = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 0.75 });
    const vest = new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.6 });
    const helmetMat = new THREE.MeshPhysicalMaterial({ color: 0xf3f4f6, roughness: 0.25, clearcoat: 1 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.1, metalness: 0.6 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.7 });
    const cap = (rad, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(rad, 1, 4, 10), mat);
    this.rb = {
      torso: cap(0.13, suit), vest: cap(0.155, vest), pelvis: new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), suit),
      head: new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), helmetMat),
      visor: new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 8, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.34, Math.PI * 0.26), visorMat),
      uArmL: cap(0.045, suit), uArmR: cap(0.045, suit), fArmL: cap(0.04, suit), fArmR: cap(0.04, suit),
      thighL: cap(0.07, suit), thighR: cap(0.07, suit), shinL: cap(0.055, suit), shinR: cap(0.055, suit),
      handL: new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glove), handR: new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glove),
      footL: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), glove), footR: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), glove),
    };
    for (const m of Object.values(this.rb)) r.add(m);
    this.rb.head.add(this.rb.visor);
    this.rb.visor.position.set(0, 0, 0);
    this.riderGroup = r;
    this.group.add(r);
    this.riderAttached = true;
  }

  // pose the rider from the physics state (all in the ski body frame)
  poseRider() {
    const ski = this.ski, inp = ski.input, b = this.rb;
    const cg = ski.rider;
    const stand = Math.min(1, Math.max(0, (cg.y - ski.riderSeat.y) / 0.33));
    const pelvis = v3(cg.x, cg.y - 0.1 - 0.02 * stand, cg.z - 0.04);
    // torso leans toward the bars; more when leaning forward or standing
    const leanF = (0.32 + 0.35 * Math.max(-0.6, inp.leanZ || 0) + 0.25 * stand);
    const side = -(inp.leanX || 0) * 0.35;
    const up = v3(Math.sin(side) * 0.6, Math.cos(leanF), Math.sin(leanF)).normalize();
    const shoulders = pelvis.clone().addScaledVector(up, 0.5);
    const headPos = shoulders.clone().addScaledVector(up, 0.2).add(v3(0, 0.02, 0.03));
    boneBetween(b.torso, pelvis, shoulders, 1.26);
    boneBetween(b.vest, pelvis.clone().addScaledVector(up, 0.12), shoulders.clone().addScaledVector(up, -0.06), 1.31);
    b.pelvis.position.copy(pelvis);
    b.head.position.copy(headPos);
    b.head.rotation.set(-leanF * 0.6 + 0.3, 0, side * 0.5);

    // hands on the grips (grips follow steering)
    this.bars.updateMatrix(); this.barCross.updateMatrix();
    const gripL = v3(this.barW / 2 - 0.06, 0, 0).applyMatrix4(this.barCross.matrix).applyMatrix4(this.bars.matrix);
    const gripR = v3(-(this.barW / 2 - 0.06), 0, 0).applyMatrix4(this.barCross.matrix).applyMatrix4(this.bars.matrix);
    const right = v3(-1, 0, 0);
    const shL = shoulders.clone().addScaledVector(right, -0.19), shR = shoulders.clone().addScaledVector(right, 0.19);
    const elbowPole = v3(0, -1, -0.3);
    const eL = solveIK(shL, gripL, 0.3, 0.3, elbowPole.clone().add(v3(0.6, 0, 0)));
    const eR = solveIK(shR, gripR, 0.3, 0.3, elbowPole.clone().add(v3(-0.6, 0, 0)));
    boneBetween(b.uArmL, shL, eL, 1.09); boneBetween(b.fArmL, eL, gripL, 1.08);
    boneBetween(b.uArmR, shR, eR, 1.09); boneBetween(b.fArmR, eR, gripR, 1.08);
    b.handL.position.copy(gripL); b.handR.position.copy(gripR);

    // feet in the footwells, knees forward and out
    const fw = ski.footwell;
    const footL = v3(fw.x, fw.y + 0.03, fw.z - 0.1 * stand), footR = v3(-fw.x, fw.y + 0.03, fw.z - 0.1 * stand);
    const hipL = pelvis.clone().add(v3(0.1, 0, 0)), hipR = pelvis.clone().add(v3(-0.1, 0, 0));
    const kL = solveIK(hipL, footL, 0.45, 0.45, v3(0.5, 0.3, 1));
    const kR = solveIK(hipR, footR, 0.45, 0.45, v3(-0.5, 0.3, 1));
    boneBetween(b.thighL, hipL, kL, 1.14); boneBetween(b.shinL, kL, footL, 1.11);
    boneBetween(b.thighR, hipR, kR, 1.14); boneBetween(b.shinR, kR, footR, 1.11);
    b.footL.position.copy(footL).add(v3(0, -0.02, 0.06)); b.footR.position.copy(footR).add(v3(0, -0.02, 0.06));
  }

  update() {
    const ski = this.ski;
    this.group.position.set(ski.origin.x, ski.origin.y, ski.origin.z);
    this.group.quaternion.set(ski.q.x, ski.q.y, ski.q.z, ski.q.w);
    // nozzle: steering yaw and VTS trim
    this.nozzle.rotation.y = ski.steer * 21 * Math.PI / 180;
    this.nozzle.rotation.x = ski.trim * Math.PI / 180;
    // reverse bucket swings down over the nozzle
    this.bucket.rotation.x = -0.25 + ski.bucket * 1.25;
    this.bucket.rotation.y = this.nozzle.rotation.y * 0.5;
    // handlebars turn about the raked column
    this.barCross.rotation.y = -ski.steer * 0.42;
    if (ski.riderOn) {
      if (!this.riderAttached) { this.group.add(this.riderGroup); this.riderGroup.position.set(0, 0, 0); this.riderGroup.quaternion.identity(); this.riderAttached = true; }
      this.poseRider();
    }
  }

  // called when the rider is thrown: hand the rider group over to the world
  detachRider(scene) {
    if (!this.riderAttached) return;
    this.group.updateMatrixWorld();
    const m = this.riderGroup.matrixWorld.clone();
    scene.add(this.riderGroup);
    m.decompose(this.riderGroup.position, this.riderGroup.quaternion, this.riderGroup.scale);
    this.riderAttached = false;
  }
}
