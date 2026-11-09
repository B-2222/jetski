// Ocean surface + sky rendering. The vertex shader evaluates exactly the same
// sine waves and wake rings as waves.js, so the hull sits on what you see.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAX_WAVES, WAKE_N, WAKE_LIFE, WAKE_SPEED } from './waves.js';

const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
vec3 skyColor(vec3 d) {
  float h = max(d.y, -0.05);
  vec3 zenith = vec3(0.16, 0.38, 0.72);
  vec3 horizon = vec3(0.62, 0.78, 0.92);
  vec3 c = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.86, 0.62) * (pow(s, 6.0) * 0.25 + pow(s, 64.0) * 0.5);
  c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, s) * 6.0;
  return c;
}`;

export function createSky(scene, sunDir) {
  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSunDir: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `${SKY_GLSL}
      uniform float uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
          float cl = smoothstep(0.52, 0.85, fbm(uv));
          c = mix(c, vec3(1.0, 0.99, 0.97), cl * 0.75 * smoothstep(0.0, 0.25, d.y));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

// Polar grid: dense near the camera, sparse to the horizon.
function makeGrid() {
  const rings = [];
  let r = 0;
  while (r < 2600) { rings.push(r); r += r < 30 ? 0.22 : r * 0.045; }
  const seg = 200;
  const pos = [];
  for (const rr of rings) for (let j = 0; j < seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
  }
  const idx = [];
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class OceanView {
  constructor(scene, ocean, sunDir) {
    this.ocean = ocean;
    const waveA = []; const waveB = []; const wake = [];
    for (let i = 0; i < MAX_WAVES; i++) { waveA.push(new THREE.Vector4()); waveB.push(new THREE.Vector4()); }
    for (let i = 0; i < WAKE_N; i++) wake.push(new THREE.Vector4(0, 0, -1e6, 0));
    this.uniforms = {
      uTime: { value: 0 }, uWaveA: { value: waveA }, uWaveB: { value: waveB }, uWaveCount: { value: 0 },
      uWake: { value: wake }, uSunDir: { value: sunDir }, uCam: { value: new THREE.Vector3() },
      uShadow: { value: new THREE.Vector4(0, 0, 0, 0) }, uShadowDir: { value: new THREE.Vector2(0, 1) },
      uFogColor: { value: new THREE.Color(0.6, 0.74, 0.86) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        #define MAXW ${MAX_WAVES}
        #define WAKEN ${WAKE_N}
        uniform float uTime; uniform vec4 uWaveA[MAXW]; uniform vec4 uWaveB[MAXW]; uniform int uWaveCount;
        uniform vec4 uWake[WAKEN];
        varying vec3 vWorld; varying vec3 vNormal; varying float vFoam; varying float vWake;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = 0.0, dx = 0.0, dz = 0.0, crest = 0.0;
          for (int i = 0; i < MAXW; i++) {
            if (i >= uWaveCount) break;
            vec4 A = uWaveA[i]; vec4 B = uWaveB[i];
            float ph = A.z * (A.x * wp.x + A.y * wp.z) - A.w * uTime + B.y;
            float s = sin(ph), c = cos(ph);
            h += B.x * s;
            dx += B.x * A.z * A.x * c; dz += B.x * A.z * A.y * c;
            crest += max(0.0, s) * B.x * A.z;
          }
          float foam = 0.0, wk = 0.0;
          for (int i = 0; i < WAKEN; i++) {
            vec4 W = uWake[i];
            float age = uTime - W.z;
            if (age < 0.0 || age > ${WAKE_LIFE.toFixed(1)}) continue;
            vec2 d = wp.xz - W.xy;
            float R = 0.5 + ${WAKE_SPEED.toFixed(2)} * age;
            float width = 0.45 + 0.22 * age;
            float dist = length(d);
            float s = dist - R;
            if (abs(s + 0.75 * width) > 4.5 * width) continue;
            float amp = W.w * exp(-age / 3.2) / (1.0 + 0.3 * age);
            float u = s / width, v = (s + 1.5 * width) / width;
            float e1 = exp(-u*u), e2 = exp(-v*v);
            h += amp * (e1 - 0.55 * e2);
            float dhds = amp * (-2.0*u*e1 + 1.1*v*e2) / width;
            vec2 rd = d / max(dist, 1e-3);
            dx += dhds * rd.x; dz += dhds * rd.y;
            wk += amp * e1;
            // churned water right behind the hull, fading with age
            foam += W.w * 3.0 * exp(-age * 0.35) * smoothstep(1.3, 0.2, dist) + amp * e1 * 1.4 * exp(-age*0.5);
          }
          wp.y += h;
          vWorld = wp.xyz;
          vNormal = normalize(vec3(-dx, 1.0, -dz));
          vFoam = foam + max(0.0, crest - 0.3) * 1.2;
          vWake = wk;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        ${SKY_GLSL}
        uniform vec3 uCam; uniform float uTime; uniform vec4 uShadow; uniform vec2 uShadowDir; uniform vec3 uFogColor;
        varying vec3 vWorld; varying vec3 vNormal; varying float vFoam; varying float vWake;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 V = uCam - vWorld; float dist = length(V); V /= dist;
          // fine ripples, fading with distance
          float fade = exp(-dist * 0.02);
          vec2 p = vWorld.xz;
          float t = uTime;
          vec3 rip = vec3(
            sin(p.x * 3.1 + t * 2.3) * 0.5 + sin(p.x * 5.7 - p.y * 2.1 + t * 3.1) * 0.35 + sin(p.y * 7.3 + p.x * 1.3 - t * 2.7) * 0.2,
            0.0,
            sin(p.y * 3.4 - t * 2.1) * 0.5 + sin(p.y * 6.1 + p.x * 2.4 + t * 2.9) * 0.35 + sin(p.x * 8.1 - p.y * 1.7 + t * 3.3) * 0.2);
          vec3 N = normalize(vNormal + rip * 0.16 * fade);
          float fres = 0.02 + 0.9 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          vec3 refl = skyColor(R) * 0.62;
          vec3 deep = vec3(0.008, 0.06, 0.12);
          vec3 shallow = vec3(0.02, 0.24, 0.3);
          float up = clamp(N.y * 0.5 + 0.5 + (vWorld.y) * 0.25, 0.0, 1.0);
          vec3 body = mix(deep, shallow, pow(up, 6.0) * 0.6 + max(0.0, vWorld.y) * 0.4);
          float sun = max(dot(R, uSunDir), 0.0);
          vec3 spec = vec3(1.0, 0.92, 0.78) * (pow(sun, 900.0) * 18.0 + pow(sun, 120.0) * 1.4);
          vec3 col = mix(body, refl, fres) + spec * (0.4 + 0.6 * fade);
          // foam from wake and crests
          float fn = noise(p * 2.2 + t * 0.3) * 0.6 + noise(p * 6.0 - t * 0.5) * 0.4;
          float foam = clamp(vFoam * (0.6 + fn) - 0.15, 0.0, 1.0);
          col = mix(col, vec3(0.93, 0.97, 1.0), foam * 0.9);
          // soft shadow of the ski
          vec2 sd = vWorld.xz - uShadow.xy;
          vec2 dirF = uShadowDir; vec2 dirL = vec2(dirF.y, -dirF.x);
          float along = dot(sd, dirF), across = dot(sd, dirL);
          float sh = exp(-pow(along / 1.7, 2.0) - pow(across / 0.65, 2.0));
          col *= 1.0 - sh * uShadow.w;
          // haze to the horizon
          float fog = 1.0 - exp(-dist * 0.0011);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(makeGrid(), mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(camera, ski) {
    const oc = this.ocean, u = this.uniforms;
    u.uTime.value = oc.t;
    u.uWaveCount.value = oc.waveCount;
    for (let i = 0; i < MAX_WAVES; i++) {
      const o = i * 6, d = oc.waveData;
      u.uWaveA.value[i].set(d[o], d[o + 1], d[o + 2], d[o + 3]);
      u.uWaveB.value[i].set(d[o + 4], d[o + 5], 0, 0);
    }
    for (let i = 0; i < WAKE_N; i++) {
      const o = i * 4, w = oc.wake;
      u.uWake.value[i].set(w[o], w[o + 1], w[o + 2], w[o + 3]);
    }
    u.uCam.value.copy(camera.position);
    const snap = 0.22;
    this.mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
    if (ski) {
      const hgt = ski.pos.y - oc.height(ski.pos.x, ski.pos.z);
      u.uShadow.value.set(ski.pos.x, ski.pos.z, 0, Math.max(0, 0.35 - hgt * 0.12));
      const f = ski.stats.heading || 0;
      u.uShadowDir.value.set(Math.sin(f), Math.cos(f));
    }
  }
}
