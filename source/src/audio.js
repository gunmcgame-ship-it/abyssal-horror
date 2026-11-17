// ============================================================================
// audio: placeholder night wind until milestone 4 rewrites this file (no sample files)
// ============================================================================
// A fixed Web Audio graph, built on the first click / key / touch and driven by a 10 Hz timer, not the frame loop.
// Milestone 1 keeps only a low wind made from the old rumble and wash layers; the underwater voices are switched off.
let AC, OUT, muted = false;
const SFX = {}; // sound events for the game: filled in when the sound graph is built (first click)
const VOL = 0.78, UNDERWATER = false; // master level: about -18.5 LUFS, peaks near -5.5 dBFS
function mkSound(ac) {
  const sr = ac.sampleRate;
  // node of class C with options o, connected to every node / param in `to`; sources start at once
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  // seamless brown noise loop (the end cross-fades into the start)
  const nb = noise(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  // reverb impulse: 5 s of noise that fades out and gets darker
  const ir = noise(5, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.5) * (1 - i / n); } });

  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  const src = (playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // rumble
  const rum = G(0.34, out); src(1, BQ('lowpass', 150, 0.7, rum)); lfo(0.07, 0.11, rum.gain); lfo(0.113, 0.08, rum.gain);
  // surface wash + water rush: the same noise played at another speed, so the loops never line up
  const wash = G(0.25, out), wave = G(1, wash), rush = G(0, out), rushF = BQ('bandpass', 300, 0.9, rush);
  src(0.63, BQ('bandpass', 420, 0.5, wave), rushF); lfo(0.09, 0.3, wave.gain); lfo(0.151, 0.25, wave.gain);
  // drone: stacked fifths on D, each note a pair of slightly detuned sines that slowly beat
  const pad = G(1, out, G(1.5, wet));
  if (UNDERWATER) [73.42, 110, 164.81, 246.94, 369.99].forEach((f, i) => { const g = G(0.022 - i * 0.003, pad); N(OscillatorNode, { frequency: f }, g); N(OscillatorNode, { frequency: f + rr(0.03, 0.11) }, g); });
  // pooled voices: oscillator -> envelope -> pan -> dry + reverb
  const pool = (n, send, type) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, out, G(send, wet)), g = G(0, p); return { p, g, o: N(OscillatorNode, { type }, g) }; });
  const bub = pool(4, 0.12), chime = pool(3, 1.2), whale = pool(2, 2, 'triangle');
  // one note: pitch glides f0 -> f1 over dur, level rises to vol in att then dies away
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.7, 0.7), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 5);
  };
  // ---- milestone 2 stand-ins (milestone 4 rebuilds them): crickets, footsteps, the radio, a clatter at camp
  // where you are and which way you face, for the sounds placed in the world
  const L = ac.listener, set = (p, v) => p ? p.setTargetAtTime(v, ac.currentTime, 0.03) : 0;
  SFX.listen = (x, y, z, yaw) => {
    if (L.positionX) { set(L.positionX, x); set(L.positionY, y); set(L.positionZ, z); set(L.forwardX, sin(yaw)); set(L.forwardY, 0); set(L.forwardZ, -cos(yaw)); set(L.upX, 0); set(L.upY, 1); set(L.upZ, 0); }
    else { L.setPosition(x, y, z); L.setOrientation(sin(yaw), 0, -cos(yaw), 0, 1, 0); }
  };
  const at = (x, y, z, ref, ...to) => N(PannerNode, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1, positionX: x, positionY: y, positionZ: z }, ...to);
  const white = noise(2, (d, n) => { for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1; });
  // crickets: four, each a loop of chirps (three quick pulses of a ~4.5 kHz tone), slightly different pitch and pace
  const cri = G(0, out, G(0.4, wet));
  for (let c = 0; c < 4; c++) {
    const f = rr(4200, 5100), per = rr(0.42, 0.7), len = per * 4, b = new AudioBuffer({ length: sr * len | 0, numberOfChannels: 1, sampleRate: sr }), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const t = i / sr, tc = t % per, k = floor(tc / 0.034), tp = tc - k * 0.034; d[i] = k < 3 && tp < 0.022 ? sin(PI * tp / 0.022) * sin(TAU * f * t) : 0; }
    N(AudioBufferSourceNode, { buffer: b, loop: true }, N(StereoPannerNode, { pan: rr(-0.9, 0.9) }, G(rr(0.02, 0.05), cri)));
  }
  cri.gain.setTargetAtTime(1, ac.currentTime, 2);
  SFX.cricketsStop = () => cri.gain.setTargetAtTime(0, ac.currentTime, 0.5);
  // footsteps: sand is a soft low crunch, rock a short hard scuff
  const steps = G(0.9, out);
  SFX.step = (rock, a) => {
    const t = ac.currentTime + 0.01, v = 0.35 + 0.65 * a;
    const s = N(AudioBufferSourceNode, { buffer: white, playbackRate: rr(0.85, 1.15) }); s.stop(t + 0.4);
    const g = G(0, steps), fl = BQ(rock ? 'bandpass' : 'lowpass', rock ? rr(1800, 2600) : rr(600, 900), rock ? 1.2 : 0.7, g); s.connect(fl);
    const pk = (rock ? 0.22 : 0.3) * v;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.008);
    if (rock) g.gain.setTargetAtTime(0, t + 0.01, 0.025);
    else { g.gain.setTargetAtTime(pk * 0.35, t + 0.01, 0.03); g.gain.linearRampToValueAtTime(pk * 0.6, t + 0.09); g.gain.setTargetAtTime(0, t + 0.1, 0.05); } // heel, then toe
  };
  // the radio on the camp table: a click, static, and a slow crooner-ish tune that warbles and fades in and out
  const RX = CAMP[0] + 3.3, RY = CAMP[1] + 0.86, RZ = CAMP[2] - 0.5;
  const radio = G(0, at(RX, RY, RZ, 2.5, out, G(0.6, wet)));
  const stat = G(0.5, radio); N(AudioBufferSourceNode, { buffer: white, loop: true }, BQ('bandpass', 1800, 0.6, stat)); lfo(0.17, 0.25, stat.gain); lfo(0.043, 0.2, stat.gain);
  const mus = G(0, radio), tone = BQ('bandpass', 900, 0.5, mus);
  const voice = N(OscillatorNode, { type: 'triangle' }, G(0.5, tone)), voice2 = N(OscillatorNode, { type: 'sine' }, G(0.3, tone));
  N(OscillatorNode, { frequency: 0.6 }, G(9, voice.detune, voice2.detune)); // the warble
  const TUNE = [[67, 1], [64, 0.5], [62, 0.5], [60, 1.5], [62, 0.5], [64, 1], [67, 1], [69, 2], [67, 1], [64, 0.5], [62, 0.5], [64, 1], [60, 3]];
  let rOn = false, rNote = 0, rT = 0;
  SFX.radioOn = () => {
    const t = ac.currentTime; rOn = true; rT = t + 1.5;
    const ck = N(AudioBufferSourceNode, { buffer: white }), cg = G(0, at(RX, RY, RZ, 2.5, out)); ck.connect(BQ('highpass', 2500, 0.7, cg)); ck.stop(t + 0.1);
    cg.gain.setValueAtTime(0.6, t); cg.gain.setTargetAtTime(0, t + 0.004, 0.01);
    radio.gain.setTargetAtTime(0.5, t + 0.05, 0.3);
  };
  const tuneStep = (now) => {
    if (!rOn) return;
    while (rT < now + 0.3) {
      const [m, d] = TUNE[rNote], fq = 440 * pow(2, (m - 69) / 12); // slow: 80 beats a minute
      voice.frequency.setValueAtTime(fq, rT); voice2.frequency.setValueAtTime(fq * 2, rT);
      rT += d * 0.75; rNote = (rNote + 1) % TUNE.length;
    }
    // the station drifts: the music swells out of the static and sinks back
    mus.gain.setTargetAtTime(0.18 * (0.5 + 0.5 * sin(now * 0.11)) * (0.6 + 0.4 * sin(now * 0.37 + 1)), now, 0.5);
  };
  // the clatter: something knocked over by the fire, an enamel pot bouncing and rolling on stones
  SFX.clatter = () => {
    const t0 = ac.currentTime + 0.02, o = at(CAMP[0] + 0.6, CAMP[1] + 0.2, CAMP[2] + 0.2, 3, out, G(1.2, wet));
    for (let k = 0, t = t0; k < 6; k++) {
      const v = 0.5 * pow(0.62, k), s = N(AudioBufferSourceNode, { buffer: white, playbackRate: rr(0.8, 1.2) }); s.stop(t + 0.3);
      const g = G(0, o); s.connect(BQ('bandpass', rr(1400, 3200), 1.4, g)); g.gain.setValueAtTime(v, t); g.gain.setTargetAtTime(0, t + 0.003, 0.03);
      for (const fp of [1130, 2710, 4380]) { const os = N(OscillatorNode, { frequency: fp * rr(0.97, 1.03) }), og = G(0, o); os.connect(og); os.stop(t + 1); og.gain.setValueAtTime(v * 0.12, t); og.gain.setTargetAtTime(0, t + 0.002, 0.12); }
      t += rr(0.07, 0.16) * (1 + k * 0.25);
    }
  };
  const NOTES = [0, 2, 5, 7, 9, 12, 14, 17, 19]; // D major pentatonic, in semitones above A4
  let lt = ac.currentTime, tB = lt + 1.5, tC = lt + 5, tW = lt + 12, lx = F[CX], ly = F[CY], lz = F[CZ];
  out.gain.setTargetAtTime(VOL, lt, 1);
  return () => {
    const now = ac.currentTime, t = now + 0.05, dt = now - lt;
    tuneStep(now);
    if (dt <= 0) return;
    let v = hypot(F[CX] - lx, F[CY] - ly, F[CZ] - lz) / dt; if (v > 60) v = 0; // ignore jumps to a viewpoint
    lt = now; lx = F[CX]; ly = F[CY]; lz = F[CZ];
    rush.gain.setTargetAtTime(UNDERWATER ? 0.5 * pow(min(v / 26, 1), 1.2) : 0, t, 0.3); rushF.frequency.setTargetAtTime(220 + v * 14, t, 0.3);
    const s = clamp(1 + ly / 30, 0, 1); wash.gain.setTargetAtTime(0.25 + 0.55 * s * s, t, 0.5);
    if (UNDERWATER && t > tB) { // a burst of 1-6 bubbles: short rising blips, smaller bubbles higher and shorter
      let tt = t;
      for (let n = 1 + rnd() * rnd() * 6 | 0; n--;) { const f = rr(380, 1300); play(bub, tt, f, f * rr(1.4, 2.2), 0.05 + 40 / f, rr(0.03, 0.08), 0.006); tt += rr(0.07, 0.2); }
      tB = tt + rr(0.5, 5);
    }
    if (UNDERWATER && t > tC) { const f = 440 * pow(2, NOTES[rnd() * 9 | 0] / 12); play(chime, t, f, f, 5, rr(0.02, 0.04), 0.03); tC = t + rr(2.5, 9); }
    if (UNDERWATER && t > tW) { // a phrase of 2-3 slow glides
      let tt = t;
      for (let n = 2 + rnd() * 2 | 0; n--;) { const f = rr(170, 380), d = rr(1.6, 3.2); play(whale, tt, f, f * rr(0.6, 1.7), d, 0.08, d * 0.4); tt += d * 0.8; }
      tW = tt + rr(20, 50);
    }
  };
}
// called on every click / key / touch: builds the graph once and resumes it when the browser allows
function sound() {
  if (!AC) { AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const mute = () => { muted = !muted; OUT.gain.setTargetAtTime(muted ? 0 : VOL, AC.currentTime, 0.08); };
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
