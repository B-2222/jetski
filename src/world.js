// Scenery: home island with beach, palms, rocks and a dock; distant islands and a lighthouse;
// anchored boats; buoys; and a wake boat that drives a big circle and leaves a wake to jump.
import * as THREE from 'three';

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
function noise2(x, z, s) { return Math.sin(x * 0.07 + s) * Math.cos(z * 0.06 - s * 1.3) + 0.5 * Math.sin(x * 0.17 + z * 0.13 + s * 2.1) + 0.25 * Math.sin(x * 0.41 - z * 0.37 + s); }

export class World {
  constructor(scene, ocean) {
    this.scene = scene; this.ocean = ocean;
    this.islands = [];
    this.buoys = [];
    this.boats = [];
    this.buildHomeIsland(150, 70, 95);
    this.buildDistant();
    this.buildBuoys();
    this.buildAnchored();
    this.buildWakeBoat();
  }

  // terrain height of an island at (x,z), or -10 if open water
  groundHeight(x, z) {
    let h = -10;
    for (const is of this.islands) {
      const dx = x - is.x, dz = z - is.z;
      const d = Math.hypot(dx, dz);
      if (d > is.r * 1.25) continue;
      h = Math.max(h, is.height(dx, dz));
    }
    return h;
  }

  makeIsland(cx, cz, R, peak, seed, detail = 96) {
    // add rings so the beach slope has vertices
    const g2 = new THREE.PlaneGeometry(R * 2.5, R * 2.5, detail, detail);
    g2.rotateX(-Math.PI / 2);
    const height = (dx, dz) => {
      const d = Math.hypot(dx, dz) / R;
      const edge = 1 + 0.12 * noise2(dx, dz, seed);
      const t = d / edge;
      if (t > 1.15) return -6;
      const beach = 1 - Math.min(1, Math.max(0, (t - 0.78) / 0.32));
      const hill = Math.max(0, 1 - t / 0.78);
      return -2.2 + beach * 3.4 + peak * hill * hill * (0.75 + 0.25 * noise2(dx * 2, dz * 2, seed + 4));
    };
    const p = g2.attributes.position;
    const col = [];
    const sand = new THREE.Color(0xe3cf9b), wetSand = new THREE.Color(0xb7a073), grass = new THREE.Color(0x4f7d3a), jungle = new THREE.Color(0x2f5a2b), rock = new THREE.Color(0x7c7568);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = height(x, z);
      p.setY(i, y);
      let c;
      if (y < 0.15) c = wetSand; else if (y < 1.4) c = sand; else if (y < peak * 0.55) c = grass.clone().lerp(jungle, Math.min(1, (y - 1.4) / 6)); else c = jungle.clone().lerp(rock, Math.min(1, (y - peak * 0.55) / (peak * 0.3)));
      const n = 0.92 + 0.08 * Math.sin(x * 1.3) * Math.cos(z * 1.7);
      col.push(c.r * n, c.g * n, c.b * n);
    }
    g2.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g2.computeVertexNormals();
    const mesh = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const is = { x: cx, z: cz, r: R, height, mesh };
    this.islands.push(is);
    return is;
  }

  buildHomeIsland(cx, cz, R) {
    const is = this.makeIsland(cx, cz, R, 22, 3.1, 110);
    const r = rng(42);
    // palms: curved trunks + fronds
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 7, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5b3a, roughness: 1 });
    const frondGeo = new THREE.ConeGeometry(0.5, 3.6, 4, 1, true);
    frondGeo.translate(0, -1.8, 0); frondGeo.rotateX(Math.PI / 2 + 0.5); frondGeo.scale(1, 0.25, 1);
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f7f2f, roughness: 0.85, side: THREE.DoubleSide });
    const nPalm = 70;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nPalm * 3);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, nPalm * 7);
    let ti = 0, fi = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    for (let k = 0; k < nPalm; k++) {
      const a = r() * Math.PI * 2, d = R * (0.45 + 0.42 * Math.sqrt(r()));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y0 = is.height(x, z);
      if (y0 < 1) continue;
      const h = 6 + r() * 5, lean = (r() - 0.5) * 0.5, dir = r() * Math.PI * 2;
      let px = cx + x, py = y0, pz = cz + z;
      for (let sgm = 0; sgm < 3; sgm++) {
        const tilt = lean * (sgm + 1) * 0.6;
        const len = h / 3;
        q.setFromEuler(new THREE.Euler(Math.cos(dir) * tilt, 0, Math.sin(dir) * tilt));
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        pos.set(px, py, pz).addScaledVector(up, len / 2);
        s.set(1 - sgm * 0.15, len, 1 - sgm * 0.15);
        trunks.setMatrixAt(ti++, m.compose(pos, q, s));
        px += up.x * len; py += up.y * len; pz += up.z * len;
      }
      for (let f = 0; f < 7; f++) {
        q.setFromEuler(new THREE.Euler(-0.1 - r() * 0.4, (f / 7) * Math.PI * 2 + r() * 0.3, 0, 'YXZ'));
        fronds.setMatrixAt(fi++, m.compose(pos.set(px, py, pz), q, s.set(1, 1, 0.9 + r() * 0.3)));
      }
    }
    trunks.count = ti; fronds.count = fi;
    trunks.castShadow = fronds.castShadow = true;
    this.scene.add(trunks, fronds);
    // shoreline rocks
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d6a62, roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 40);
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, d = R * (0.98 + r() * 0.14);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const sz = 0.6 + r() * 1.8;
      rocks.setMatrixAt(k, m.compose(pos.set(cx + x, is.height(x, z) - sz * 0.3, cz + z), q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), s.set(sz, sz * 0.7, sz * 1.2)));
    }
    this.scene.add(rocks);
    // dock: planks out from the beach toward the start
    const ang = Math.atan2(-cz, -cx);
    const dockLen = 34;
    const dock = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, dockLen), wood);
    deck.position.set(0, 1.1, dockLen / 2);
    dock.add(deck);
    for (let k = 0; k <= 8; k++) for (const sx of [-1.4, 1.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.2, 8), wood);
      post.position.set(sx, -0.3, k * dockLen / 8);
      dock.add(post);
    }
    const edgeD = R * 0.9;
    dock.position.set(cx + Math.cos(ang) * edgeD, 0, cz + Math.sin(ang) * edgeD);
    dock.rotation.y = Math.PI / 2 - ang;
    dock.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(dock);
    this.dock = { x: dock.position.x, z: dock.position.z, ang, len: dockLen };
    // beach hut
    const hut = new THREE.Group();
    const hutBody = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), new THREE.MeshStandardMaterial({ color: 0xd9c9a6, roughness: 0.9 }));
    hutBody.position.y = 1.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x8b6b3a, roughness: 1 }));
    roof.position.y = 4.1; roof.rotation.y = Math.PI / 4;
    hut.add(hutBody, roof);
    const hx = Math.cos(ang) * R * 0.66, hz = Math.sin(ang) * R * 0.66;
    hut.position.set(cx + hx, is.height(hx, hz), cz + hz);
    hut.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(hut);
  }

  buildDistant() {
    const r = rng(99);
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = 900 + r() * 1200;
      this.makeIsland(Math.cos(a) * d, Math.sin(a) * d, 90 + r() * 200, 25 + r() * 70, i * 1.7, 40);
    }
    // lighthouse on a rocky islet
    const lx = -320, lz = 520;
    const isl = this.makeIsland(lx, lz, 40, 8, 9.9, 48);
    const lh = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.2 - k * 0.18, 2.4 - k * 0.18, 4, 20), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xc8322b : 0xf4f4f0, roughness: 0.6 }));
      seg.position.y = 2 + k * 4;
      lh.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 1.5 }));
    lamp.position.y = 25;
    lh.add(lamp);
    lh.position.set(lx, isl.height(0, 0), lz);
    this.scene.add(lh);
  }

  buildBuoys() {
    const orange = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.45 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.45 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.45 });
    const mk = (x, z, mat, big) => {
      const g = new THREE.Group();
      const r = big ? 0.5 : 0.35;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, r * 2.2, 24), mat);
      body.position.y = r * 0.6;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.83, r * 0.86, r * 0.35, 24), white);
      band.position.y = r * 0.9;
      const top = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      top.position.y = r * 1.7;
      g.add(body, band, top);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(g);
      this.buoys.push({ g, x, z, vx: 0, vz: 0, r });
    };
    for (let i = 0; i < 14; i++) mk((i % 2 ? 1 : -1) * 11, 70 + i * 42, i % 2 ? orange : yellow, false);
    const r = rng(7);
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, d = 120 + r() * 700;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (this.groundHeight(x, z) > -3) continue;
      mk(x, z, r() > 0.5 ? orange : yellow, true);
    }
  }

  boatMesh(hullColor, stripe, tower) {
    const g = new THREE.Group();
    const L = 7, B = 2.5;
    const geo = new THREE.BoxGeometry(B, 1.1, L, 6, 3, 14);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const u = z / L + 0.5;                       // 0 stern .. 1 bow
      const taper = u > 0.55 ? Math.cos((u - 0.55) / 0.45 * Math.PI / 2) ** 0.7 : 1;
      x *= Math.max(0.04, taper);
      if (y < 0) y -= (1 - Math.abs(x) / (B / 2)) * 0.35 - (u > 0.7 ? (u - 0.7) * 1.2 : 0);
      p.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    const hull = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: hullColor, roughness: 0.3, clearcoat: 1 }));
    g.add(hull);
    const band = new THREE.Mesh(new THREE.BoxGeometry(B * 1.01, 0.18, L * 0.7), new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.5 }));
    band.position.set(0, 0.25, -0.6);
    g.add(band);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(B * 0.85, 0.1, L * 0.55), new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 0.8 }));
    deck.position.set(0, 0.56, -0.8);
    g.add(deck);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(B * 0.85, 0.5, 0.06), new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, transparent: true, opacity: 0.6 }));
    screen.position.set(0, 0.85, 0.9); screen.rotation.x = -0.5;
    g.add(screen);
    if (tower) {
      const tubeMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.3, metalness: 0.8 });
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.1, 0.6, 0), new THREE.Vector3(-0.9, 2.3, -0.4), new THREE.Vector3(0.9, 2.3, -0.4), new THREE.Vector3(1.1, 0.6, 0)]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.06, 8, false), tubeMat));
      const drv = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 10), new THREE.MeshStandardMaterial({ color: 0x2a5d8f, roughness: 0.7 }));
      drv.position.set(0.5, 1.05, 0.3);
      g.add(drv);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  buildAnchored() {
    const d = this.dock;
    const spots = [[-9, 14], [9, 26]];
    for (const [side, along] of spots) {
      const g = this.boatMesh(side < 0 ? 0xf2f2f0 : 0x1f4e79, 0x2a2e33, false);
      const ax = d.x + Math.cos(d.ang) * along + Math.sin(d.ang) * side, az = d.z + Math.sin(d.ang) * along - Math.cos(d.ang) * side;
      this.scene.add(g);
      this.boats.push({ g, x: ax, z: az, yaw: d.ang + 0.3 * side / 9, anchored: true });
    }
  }

  buildWakeBoat() {
    const g = this.boatMesh(0x23272c, 0xff6a1a, true);
    this.scene.add(g);
    this.wakeBoat = { g, cx: -40, cz: 300, R: 150, ang: 0, speed: 10.5, ringT: 0, x: 0, z: 0, yaw: 0 };
  }

  update(dt, ski, spray) {
    const oc = this.ocean;
    // buoys float, bob and get pushed by the ski
    for (const b of this.buoys) {
      const dx = b.x - ski.pos.x, dz = b.z - ski.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.6) {
        const d = Math.sqrt(d2) || 1;
        const push = (1.26 - d) * 6;
        b.vx += dx / d * push + ski.vel.x * 0.3; b.vz += dz / d * push + ski.vel.z * 0.3;
        if (d < 1) spray.burst(b.x, oc.baseHeight(b.x, b.z), b.z, 20, 2, 2, 0.15);
      }
      b.vx *= Math.exp(-dt * 1.2); b.vz *= Math.exp(-dt * 1.2);
      b.x += b.vx * dt; b.z += b.vz * dt;
      const h = oc.height(b.x, b.z);
      const hx = oc.height(b.x + 0.5, b.z) - h, hz = oc.height(b.x, b.z + 0.5) - h;
      b.g.position.set(b.x, h - b.r * 0.3, b.z);
      b.g.rotation.set(hz * 1.2, 0, -hx * 1.2);
    }
    // anchored boats bob
    for (const b of this.boats) {
      const h = oc.height(b.x, b.z);
      const hx = oc.height(b.x + 2, b.z) - h, hz = oc.height(b.x, b.z + 2) - h;
      b.g.position.set(b.x, h - 0.15, b.z);
      b.g.rotation.set(hz * 0.4, b.yaw, -hx * 0.4, 'YXZ');
    }
    // wake boat: drives a circle, banks a little, lays down a wakeboard-sized wake
    const w = this.wakeBoat;
    w.ang += (w.speed / w.R) * dt;
    w.x = w.cx + Math.cos(w.ang) * w.R; w.z = w.cz + Math.sin(w.ang) * w.R;
    w.yaw = Math.atan2(-Math.sin(w.ang), Math.cos(w.ang)) + Math.PI / 2;
    const fx = -Math.sin(w.ang), fz = Math.cos(w.ang);
    w.yaw = Math.atan2(fx, fz);
    const h = oc.height(w.x, w.z);
    w.g.position.set(w.x, h + 0.05, w.z);
    w.g.rotation.set(-0.1, w.yaw, -0.08, 'YXZ');
    w.ringT -= dt;
    if (w.ringT <= 0) {
      w.ringT = 0.22;
      oc.addWake(w.x - fx * 2.8, w.z - fz * 2.8, 0.42, true);
    }
    // rooster of spray from the boat's transom
    if (Math.random() < dt * 30 * spray.density) {
      spray.emit(w.x - fx * 3.6 + (Math.random() - 0.5), h + 0.1, w.z - fz * 3.6 + (Math.random() - 0.5), -fx * 2, 1 + Math.random() * 1.5, -fz * 2, 0.5, 1.4, 4);
    }
    // the ski bounces off the boat hull
    const bx = ski.pos.x - w.x, bz = ski.pos.z - w.z;
    const along = bx * fx + bz * fz, across = bx * fz - bz * fx;
    if (Math.abs(along) < 4 && Math.abs(across) < 1.8 && ski.pos.y < h + 1.2) {
      const nx = fz * Math.sign(across), nz = -fx * Math.sign(across);
      const vn = ski.vel.x * nx + ski.vel.z * nz;
      if (vn < 0) { ski.vel.x -= 1.6 * vn * nx; ski.vel.z -= 1.6 * vn * nz; }
      ski.pos.x += nx * 0.05; ski.pos.z += nz * 0.05;
    }
    // running aground on an island
    const gh = this.groundHeight(ski.pos.x, ski.pos.z);
    if (gh > ski.pos.y - 0.35) {
      const lift = gh - (ski.pos.y - 0.35);
      ski.pos.y += lift;
      if (ski.vel.y < 0) ski.vel.y = 0;
      const k = Math.exp(-dt * 5);
      ski.vel.x *= k; ski.vel.z *= k;
      this.aground = true;
    } else this.aground = false;
  }
}
