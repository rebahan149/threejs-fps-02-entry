// audio.js — every sound is synthesised with WebAudio: no audio files, nothing
// to load, nothing fetched. Gunshots are filtered noise bursts with a body
// thump, the charge beeps on a square osc, the explosion is a sub sine under
// noise. Sounds start only after the player's first click (browser policy);
// bots' shots are placed by distance and direction from the listener.

let ctx = null;
let master = null;
let noiseBuf = null;
let listener = { x: 0, z: 0, yaw: 0 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { ctx = null; return; }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function setListener(x, z, yaw) { listener.x = x; listener.z = z; listener.yaw = yaw; }

// A positioned output: gain by distance, pan by bearing. Returns null off-screen far.
function place(x, z, baseGain, maxDist) {
  if (!ctx) return null;
  const dx = x - listener.x, dz = z - listener.z;
  const dist = Math.hypot(dx, dz);
  if (dist > maxDist) return null;
  const gain = ctx.createGain();
  gain.gain.value = baseGain * (1 - dist / maxDist) * (1 - dist / maxDist);
  let node = gain;
  if (ctx.createStereoPanner) {
    const pan = ctx.createStereoPanner();
    const bearing = Math.atan2(dx, dz) - listener.yaw;
    pan.pan.value = Math.max(-0.9, Math.min(0.9, Math.sin(bearing)));
    gain.connect(pan); node = pan;
  }
  node.connect(master);
  return gain;
}

function noise(out, at, dur, filterType, freq, gainVal, sweepTo) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(at); src.stop(at + dur + 0.05);
}

function tone(out, at, dur, type, freq, gainVal, sweepTo) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, at);
  if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g); g.connect(out);
  o.start(at); o.stop(at + dur + 0.05);
}

const SHOT_SHAPE = {
  pistol: { crack: 2400, body: 300, dur: 0.14, gain: 0.5 },
  smg: { crack: 2600, body: 340, dur: 0.11, gain: 0.45 },
  shotgun: { crack: 1500, body: 200, dur: 0.3, gain: 0.8 },
  rifle: { crack: 2100, body: 260, dur: 0.2, gain: 0.65 },
  dmr: { crack: 1700, body: 200, dur: 0.34, gain: 0.85 },
};

export function sfxShot(kind, x, z, own) {
  if (!ctx) return;
  const out = own ? master : place(x, z, 0.9, 90);
  if (!out) return;
  const s = SHOT_SHAPE[kind] || SHOT_SHAPE.rifle;
  const t = ctx.currentTime;
  noise(out, t, s.dur, 'bandpass', s.crack, s.gain, 300);
  noise(out, t, s.dur * 0.7, 'lowpass', s.body, s.gain * 0.9, 90);
  tone(out, t, 0.05, 'square', 120, s.gain * 0.25, 55);
}

export function sfxDryFire() { if (ctx) tone(master, ctx.currentTime, 0.05, 'square', 900, 0.12, 500); }
export function sfxReload(step) {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(master, t, 0.04, 'square', step === 0 ? 500 : 750, 0.15, 300);
  noise(master, t, 0.05, 'highpass', 2000, 0.1);
}
export function sfxHit(kill) {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(master, t, 0.06, 'sine', kill ? 1320 : 990, 0.22, kill ? 660 : 880);
}
export function sfxHurt() { if (ctx) noise(master, ctx.currentTime, 0.12, 'lowpass', 400, 0.3, 120); }
export function sfxStep(run) {
  if (!ctx) return;
  noise(master, ctx.currentTime, 0.07, 'lowpass', run ? 500 : 380, run ? 0.10 : 0.05, 140);
}
export function sfxThrow() { if (ctx) noise(master, ctx.currentTime, 0.15, 'bandpass', 700, 0.12, 1400); }
export function sfxFlashPop(x, z) {
  const out = place(x, z, 0.8, 60); if (!out) return;
  noise(out, ctx.currentTime, 0.25, 'highpass', 3000, 0.5, 5000);
}
export function sfxSmokePop(x, z) {
  const out = place(x, z, 0.6, 50); if (!out) return;
  noise(out, ctx.currentTime, 0.5, 'lowpass', 900, 0.35, 200);
}
export function sfxBeep(final) {
  if (!ctx) return;
  tone(master, ctx.currentTime, final ? 0.3 : 0.07, 'square', final ? 1560 : 1180, 0.16);
}
export function sfxExplosion(x, z) {
  const out = place(x, z, 1.4, 160) || master;
  if (!ctx) return;
  const t = ctx.currentTime;
  noise(out, t, 1.1, 'lowpass', 900, 1.0, 60);
  tone(out, t, 0.9, 'sine', 68, 0.9, 30);
}
export function sfxPlant() { if (ctx) { const t = ctx.currentTime; tone(master, t, 0.06, 'square', 880, 0.14); tone(master, t + 0.1, 0.06, 'square', 1174, 0.14); } }
export function sfxRadio() { if (ctx) { const t = ctx.currentTime; tone(master, t, 0.03, 'square', 1900, 0.06); tone(master, t + 0.05, 0.03, 'square', 1500, 0.06); } }
export function sfxBuy() { if (ctx) tone(master, ctx.currentTime, 0.07, 'sine', 740, 0.15, 990); }
export function sfxRoundWin(won) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const seq = won ? [523, 659, 784] : [392, 330, 262];
  seq.forEach((f, i) => tone(master, t + i * 0.11, 0.16, 'triangle', f, 0.18));
}
