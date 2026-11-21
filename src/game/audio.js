// Dźwięk: Web Audio, w całości syntezowany – gra nie ma żadnych plików audio.
import { Music } from './music.js';
import { clamp } from './util.js';

class Sfx {
  ctx = null; out = null; muted = false;
  music = new Music(); musicOn = true;   // muzyka biegu (src/game/music.js) – osobny przełącznik w OPCJACH
  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.2;
        this.out.connect(this.ctx.destination);
        this.music.attach(this.ctx, this.out);
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  tone(f0, f1, dur, { type = 'square', vol = 0.5, at = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, { vol = 0.4, freq = 900 } = {}) {
    if (!this.ctx || this.muted) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.out);
    src.start();
  }
  /** Co klatkę z pętli gry: params biegu albo null (cisza – menu, pauza, koniec gry, dźwięk wyłączony). */
  song(params, dt) { this.music.update(this.muted || !this.musicOn ? null : params, dt); }

  jump(p)  { this.tone(240 + p * 240, 500 + p * 800, 0.14 + p * 0.12, { vol: 0.3 }); }
  land()   { this.noise(0.07, { vol: 0.4, freq: 700 }); }
  bounce() { this.tone(190, 85, 0.1, { type: 'triangle', vol: 0.7 }); }
  pick()   { this.tone(660, 880, 0.07, { type: 'triangle', vol: 0.5 }); }
  combo(tier) {
    const scale = [523, 659, 784, 1047, 1319, 1568, 2093];
    const n = clamp(3 + tier, 3, 7);
    for (let i = 0; i < n; i++) this.tone(scale[i], scale[i], 0.13, { type: 'triangle', vol: 0.55, at: i * 0.07 });
  }
  boost()  { this.tone(180, 1400, 0.9, { type: 'sawtooth', vol: 0.3 }); this.noise(0.8, { vol: 0.35, freq: 1800 }); }
  boostEnd() { this.tone(900, 600, 0.15, { type: 'triangle', vol: 0.4 }); }
  slow()   { for (let i = 0; i < 3; i++) this.tone(880 - i * 220, 660 - i * 200, 0.22, { type: 'sine', vol: 0.6, at: i * 0.12 }); }
  slowEnd() { this.tone(440, 880, 0.18, { type: 'triangle', vol: 0.45 }); }
  hurry()  { for (let i = 0; i < 4; i++) this.tone(1320, 1320, 0.1, { type: 'sine', vol: 0.7, at: i * 0.15 }); }
  over()   { this.tone(420, 70, 0.7, { type: 'sawtooth', vol: 0.35 }); }
  /** Nagroda najlepszej trójki: po combo syntezowany głos „WOW!” (im wyższe miejsce, tym niższy, pełniejszy głos) i błysk dzwoneczków. */
  wow(tier = 1, big = false) {
    if (!this.ctx || this.muted) return;
    voiceWow(this.ctx, this.out, this.ctx.currentTime, [0, 150, 175, 205][tier] ?? 175, big ? 1 : 0.8);
    const bells = [1568, 2093, 2637, 3136];
    for (let i = 0; i < (big ? 4 : 3); i++) this.tone(bells[i], bells[i], 0.25, { type: 'sine', vol: 0.22, at: 0.5 + i * 0.06 });
  }
}

export const sfx = new Sfx();

/**
 * Głos „wow” (/waʊ/): piłokształtne źródło z wibratem przepuszczone przez trzy formanty samogłosek,
 * które przesuwają się od „u” przez „a” z powrotem do „u”. Funkcja osobno od Sfx, żeby dało się ją wyrenderować offline.
 */
export function voiceWow(ac, dest, t0, base, vol = 1) {
  const dur = 0.78;
  const src = ac.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(base * 0.8, t0);
  src.frequency.linearRampToValueAtTime(base * 1.3, t0 + 0.22);
  src.frequency.linearRampToValueAtTime(base * 1.15, t0 + 0.45);
  src.frequency.linearRampToValueAtTime(base * 0.75, t0 + dur);
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = 5.5; depth.gain.value = base * 0.025;
  lfo.connect(depth).connect(src.frequency);

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(vol, t0 + 0.06);
  env.gain.setValueAtTime(vol, t0 + 0.5);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  env.connect(dest);
  // formanty [u → a → u] i ich głośność
  const F = [[320, 780, 320, 1.0], [760, 1150, 680, 0.55], [2250, 2450, 2200, 0.18]];
  for (const [u, a, u2, g] of F) {
    const bp = ac.createBiquadFilter(), gain = ac.createGain();
    bp.type = 'bandpass'; bp.Q.value = 7;
    bp.frequency.setValueAtTime(u, t0);
    bp.frequency.linearRampToValueAtTime(a, t0 + 0.2);
    bp.frequency.setValueAtTime(a, t0 + 0.4);
    bp.frequency.linearRampToValueAtTime(u2, t0 + dur);
    gain.gain.value = g * 2.8;
    src.connect(bp).connect(gain).connect(env);
  }
  src.start(t0); lfo.start(t0);
  src.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
}
