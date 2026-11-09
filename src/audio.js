// Synthesised sound: 3-cylinder four-stroke (firing frequency = rpm/60 * 1.5),
// supercharger whine, jet pump hiss, hull slap / water rush, landing thumps.
export class SkiAudio {
  constructor() { this.ctx = null; this.enabled = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); this.enabled = true; return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.enabled = true;
    const master = this.master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // engine: saw + square at firing frequency, sub octave, through distortion and a lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 2.2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = ctx.createOscillator(); this.o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const g3 = ctx.createGain(); g3.gain.value = 0.35;
    this.o1.connect(g1).connect(shaper); this.o2.connect(g2).connect(shaper); this.o3.connect(g3).connect(shaper);
    // uneven 3-cylinder burble: amplitude wobble at crank frequency
    this.lfo = ctx.createOscillator(); this.lfo.type = 'triangle';
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 0.25;
    const amp = ctx.createGain(); amp.gain.value = 0.75;
    this.lfo.connect(this.lfoGain).connect(amp.gain);
    shaper.connect(amp).connect(this.engFilter).connect(this.engGain).connect(master);

    // supercharger whine
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(master);

    // noise sources
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = () => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n; };
    // water rush
    this.rushF = ctx.createBiquadFilter(); this.rushF.type = 'bandpass'; this.rushF.frequency.value = 900; this.rushF.Q.value = 0.6;
    this.rushG = ctx.createGain(); this.rushG.gain.value = 0;
    noise().connect(this.rushF).connect(this.rushG).connect(master);
    // jet hiss
    this.jetF = ctx.createBiquadFilter(); this.jetF.type = 'highpass'; this.jetF.frequency.value = 2500;
    this.jetG = ctx.createGain(); this.jetG.gain.value = 0;
    noise().connect(this.jetF).connect(this.jetG).connect(master);
    // hull slap (low thumps)
    this.slapF = ctx.createBiquadFilter(); this.slapF.type = 'lowpass'; this.slapF.frequency.value = 180;
    this.slapG = ctx.createGain(); this.slapG.gain.value = 0;
    noise().connect(this.slapF).connect(this.slapG).connect(master);
    this.noiseBuf = buf;

    for (const o of [this.o1, this.o2, this.o3, this.lfo, this.whine]) o.start();
  }

  stop() { if (this.ctx) this.ctx.suspend(); this.enabled = false; }

  thump(strength) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1.2, 0.2 + strength * 0.15), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.6);
  }

  update(ski, dt) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, k = 0.05;
    const rpm = ski.rpm, c = ski.craft;
    const fire = Math.max(8, rpm / 60 * 1.5);
    const load = Math.min(1, ski.demand * 1.1 + 0.1);
    const running = ski.engineOn && rpm > 400;
    this.o1.frequency.setTargetAtTime(fire, t, k);
    this.o2.frequency.setTargetAtTime(fire * 2.003, t, k);
    this.o3.frequency.setTargetAtTime(fire * 0.5, t, k);
    this.lfo.frequency.setTargetAtTime(rpm / 60, t, k);
    const cut = ski.limiterCut ? 0.35 : 1;
    this.engGain.gain.setTargetAtTime(running ? (0.1 + 0.32 * load) * cut : 0, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(260 + rpm * 0.32 * (0.5 + load * 0.7), t, k);
    const sc = c.powerKW > 150 ? 1 : 0.25;
    this.whine.frequency.setTargetAtTime(500 + rpm * 0.42, t, k);
    this.whineGain.gain.setTargetAtTime(running ? sc * 0.05 * (rpm / c.rpmLimit) ** 2 * load : 0, t, k);
    const sp = ski.stats.speed || 0;
    const wet = Math.min(1, (ski.stats.wetPts || 0) / 30);
    this.rushG.gain.setTargetAtTime(Math.min(0.5, sp * 0.013) * wet, t, 0.08);
    this.rushF.frequency.setTargetAtTime(500 + sp * 30, t, 0.1);
    this.jetG.gain.setTargetAtTime(Math.min(0.12, Math.max(0, ski.thrust) / c.staticThrust * 0.1), t, 0.05);
    const slap = Math.min(0.6, Math.abs(ski.stats.gVert - 1) * 0.25) * wet;
    this.slapG.gain.setTargetAtTime(slap, t, 0.03);
  }
}
