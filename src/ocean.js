// Ocean surface + sky rendering. The vertex shader evaluates exactly the same
// sine waves and wake rings as waves.js, so the hull sits on what you see.
// The fragment shader adds detail the physics does not need: fine ripples,
// light through backlit crests, sun glints, lacy foam and horizon haze.
import * as THREE from 'three';
import { MAX_WAVES, WAKE_N, WAKE_LIFE, WAKE_SPEED } from './waves.js';

const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
vec3 skyColor(vec3 d) {
  float h = max(d.y, -0.02);
  vec3 zenith = vec3(0.09, 0.26, 0.62);
  vec3 mid = vec3(0.32, 0.56, 0.86);
  vec3 horizon = vec3(0.66, 0.79, 0.9);
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  c = mix(c, zenith, smoothstep(0.15, 0.9, h));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.82, 0.55) * (pow(s, 5.0) * 0.22 + pow(s, 48.0) * 0.55);
  c += vec3(1.0, 0.96, 0.88) * smoothstep(0.99955, 0.99975, s) * 12.0;
  return c;
}`;

const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// value noise with analytic derivatives (x = value, yz = gradient)
vec3 noised(vec2 x){
  vec2 i = floor(x), f = fract(x);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  float a = hash12(i), b = hash12(i+vec2(1,0)), c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y, du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));
}
float fbm(vec2 p){ float v=0.0, a=0.5; mat2 m = mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*noised(p).x; p=m*p; a*=0.5; } return v; }
vec2 fbmGrad(vec2 p){ vec2 g=vec2(0.0); float a=0.5; mat2 m = mat2(1.6,1.2,-1.2,1.6); mat2 acc = mat2(1.0);
  for(int i=0;i<4;i++){ vec3 n = noised(p); g += a * (acc * n.yz); p = m*p; acc = acc * 2.0; a*=0.5; } return g; }
`;

export function createSky(scene, sunDir) {
  const geo = new THREE.SphereGeometry(4000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSunDir: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `${SKY_GLSL}
      ${NOISE_GLSL}
      uniform float uTime; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        if (d.y > 0.0) {
          // two cloud decks, lit from the sun side
          vec2 uv = d.xz / (d.y + 0.08);
          float c1 = fbm(uv * 1.2 + vec2(uTime * 0.006, uTime * 0.002));
          float c2 = fbm(uv * 3.1 + vec2(-uTime * 0.01, 0.0) + 7.0);
          float cov = smoothstep(0.5, 0.82, c1 * 0.75 + c2 * 0.35);
          float lit = clamp(0.55 + 0.6 * dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
          vec3 cloud = mix(vec3(0.72, 0.77, 0.84), vec3(1.0, 0.98, 0.94), lit);
          c = mix(c, cloud, cov * 0.85 * smoothstep(0.0, 0.18, d.y));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

// Polar grid: dense near the camera, sparse to the horizon.
function makeGrid(quality) {
  const step = quality === 'low' ? 0.3 : quality === 'ultra' ? 0.11 : 0.15;
  const seg = quality === 'low' ? 180 : quality === 'ultra' ? 384 : 300;
  const rings = [];
  let r = 0;
  while (r < 2600) { rings.push(r); r += r < 26 ? step : r * (quality === 'low' ? 0.06 : 0.038); }
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
  constructor(scene, ocean, sunDir, quality = 'high') {
    this.ocean = ocean;
    const waveA = []; const waveB = []; const wake = [];
    for (let i = 0; i < MAX_WAVES; i++) { waveA.push(new THREE.Vector4()); waveB.push(new THREE.Vector4()); }
    for (let i = 0; i < WAKE_N; i++) wake.push(new THREE.Vector4(0, 0, -1e6, 0));
    this.uniforms = {
      uTime: { value: 0 }, uWaveA: { value: waveA }, uWaveB: { value: waveB }, uWaveCount: { value: 0 },
      uWake: { value: wake }, uSunDir: { value: sunDir }, uCam: { value: new THREE.Vector3() },
      uShadow: { value: new THREE.Vector4(0, 0, 0, 0) }, uShadowDir: { value: new THREE.Vector2(0, 1) },
      uFogColor: { value: new THREE.Color(0.6, 0.73, 0.85) }, uDetail: { value: quality === 'low' ? 0.6 : 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        #define MAXW ${MAX_WAVES}
        #define WAKEN ${WAKE_N}
        uniform float uTime; uniform vec4 uWaveA[MAXW]; uniform vec4 uWaveB[MAXW]; uniform int uWaveCount;
        uniform vec4 uWake[WAKEN];
        varying vec3 vWorld; varying vec3 vNormal; varying float vFoam; varying float vH; varying float vTrail;
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
          float foam = 0.0, trail = 0.0;
          for (int i = 0; i < WAKEN; i++) {
            vec4 W = uWake[i];
            float age = uTime - W.z;
            if (age < 0.0 || age > ${WAKE_LIFE.toFixed(1)}) continue;
            vec2 d = wp.xz - W.xy;
            float R = 0.5 + ${WAKE_SPEED.toFixed(2)} * age;
            float width = 0.45 + 0.22 * age;
            float dist = length(d);
            float s = dist - R;
            float core = smoothstep(1.4, 0.15, dist) * exp(-age * 0.3);
            trail += W.w * 3.2 * core;
            if (abs(s + 0.75 * width) > 4.5 * width) continue;
            float amp = W.w * exp(-age / 3.2) / (1.0 + 0.3 * age);
            float u = s / width, v = (s + 1.5 * width) / width;
            float e1 = exp(-u*u), e2 = exp(-v*v);
            h += amp * (e1 - 0.55 * e2);
            float dhds = amp * (-2.0*u*e1 + 1.1*v*e2) / width;
            vec2 rd = d / max(dist, 1e-3);
            dx += dhds * rd.x; dz += dhds * rd.y;
            foam += amp * e1 * 1.6 * exp(-age * 0.45);
          }
          wp.y += h;
          vWorld = wp.xyz;
          vH = h;
          vNormal = normalize(vec3(-dx, 1.0, -dz));
          vFoam = foam + max(0.0, crest - 0.28) * 1.4;
          vTrail = trail;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        ${SKY_GLSL}
        ${NOISE_GLSL}
        uniform vec3 uCam; uniform float uTime; uniform vec4 uShadow; uniform vec2 uShadowDir; uniform vec3 uFogColor; uniform float uDetail;
        varying vec3 vWorld; varying vec3 vNormal; varying float vFoam; varying float vH; varying float vTrail;
        void main(){
          vec3 V = uCam - vWorld; float dist = length(V); V /= dist;
          vec2 p = vWorld.xz;
          float t = uTime;
          // fine detail: two scrolling noise layers, faded with distance to stop shimmer
          float fade = exp(-dist * 0.018) * uDetail;
          vec2 g = fbmGrad(p * 0.85 + vec2(t * 0.55, t * 0.18)) * 0.55 + fbmGrad(p * 2.6 + vec2(-t * 0.35, t * 0.7)) * 0.28;
          g += vec2(sin(p.x * 0.9 + t * 1.4 + p.y * 0.3), cos(p.y * 1.1 - t * 1.2)) * 0.05;
          vec3 N = normalize(vNormal + vec3(-g.x, 0.0, -g.y) * 0.2 * fade);
          float NdV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          vec3 refl = skyColor(R) * 0.72;
          // water body with height-based scattering
          vec3 deep = vec3(0.004, 0.035, 0.075);
          vec3 mid = vec3(0.012, 0.15, 0.2);
          vec3 body = mix(deep, mid, clamp(0.35 + vH * 1.6, 0.0, 1.0));
          // sunlight passing through backlit crests
          float back = pow(clamp(dot(normalize(-V + N * 0.55), uSunDir), 0.0, 1.0), 4.0);
          body += vec3(0.04, 0.38, 0.34) * back * clamp(vH * 2.4 + 0.25, 0.0, 1.0) * 0.6;
          vec3 col = mix(body, refl, F);
          // sun glints: very sharp core for bloom, broader sheen
          vec3 H = normalize(V + uSunDir);
          float ndh = max(dot(N, H), 0.0);
          col += vec3(1.0, 0.9, 0.72) * (pow(ndh, 1400.0) * 40.0 + pow(ndh, 220.0) * 1.8) * (0.35 + 0.65 * fade);
          // foam: lacy, cover grows with intensity
          float lace = fbm(p * 1.7 + vec2(t * 0.05, -t * 0.03)) * 0.65 + fbm(p * 5.0 - t * 0.12) * 0.35;
          float fa = clamp(vFoam, 0.0, 1.6) + clamp(vTrail, 0.0, 1.8) * 0.75;
          float foam = smoothstep(1.05 - fa * 0.62, 1.25 - fa * 0.62, lace + 0.25) * clamp(fa * 1.4, 0.0, 1.0);
          float foamLit = 0.82 + 0.18 * max(dot(N, uSunDir), 0.0);
          col = mix(col, vec3(0.92, 0.96, 0.98) * foamLit, foam * 0.94);
          // soft shadow of the ski
          vec2 sd = vWorld.xz - uShadow.xy;
          vec2 dirF = uShadowDir; vec2 dirL = vec2(dirF.y, -dirF.x);
          float along = dot(sd, dirF), across = dot(sd, dirL);
          float sh = exp(-pow(along / 1.6, 2.0) - pow(across / 0.6, 2.0));
          col *= 1.0 - sh * uShadow.w;
          // aerial perspective
          float fog = 1.0 - exp(-dist * 0.00085);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quality = quality;
    this.mesh = new THREE.Mesh(makeGrid(quality), this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.mesh.geometry.dispose();
    this.mesh.geometry = makeGrid(q);
    this.uniforms.uDetail.value = q === 'low' ? 0.6 : 1;
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
    const snap = 0.3;
    this.mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
    if (ski) {
      const hgt = ski.pos.y - oc.height(ski.pos.x, ski.pos.z);
      u.uShadow.value.set(ski.pos.x, ski.pos.z, 0, Math.max(0, 0.4 - hgt * 0.12));
      const f = ski.stats.heading || 0;
      u.uShadowDir.value.set(Math.sin(f), Math.cos(f));
    }
  }
}
