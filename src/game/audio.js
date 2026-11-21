// Dźwięk: Web Audio, w całości syntezowany – gra nie ma żadnych plików audio.
import { Music } from './music.js';
import { clamp } from './util.js';

export const VOL_STEPS = 10;                 // głośność efektów i muzyki: 0 (cisza) … 10 (100%)
/** Krok suwaka → wzmocnienie; kwadrat, bo ucho słyszy głośność mniej więcej logarytmicznie (50% ≈ −12 dB). */
const gainOf = (v) => (v / VOL_STEPS) ** 2;

class Sfx {
  ctx = null; out = null; fxOut = null; musicOut = null; muted = false;
  fxVol = VOL_STEPS; musicVol = VOL_STEPS;     // OPCJE → DŹWIĘK: osobne suwaki efektów i muzyki
  music = new Music();                         // muzyka biegu (src/game/music.js)
  get musicOn() { return this.musicVol > 0; }
  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.2;
        this.out.connect(this.ctx.destination);
        this.fxOut = this.ctx.createGain(); this.fxOut.connect(this.out);
        this.musicOut = this.ctx.createGain(); this.musicOut.connect(this.out);
        this.applyVolume();
        this.music.attach(this.ctx, this.musicOut);
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  /** Głośności z suwaków na wzmacniacze (wywoływane po każdej zmianie). */
  applyVolume() {
    if (!this.ctx) return;
    this.fxOut.gain.value = gainOf(this.fxVol);
    this.musicOut.gain.value = gainOf(this.musicVol);
  }
  tone(f0, f1, dur, { type = 'square', vol = 0.5, at = 0 } = {}) {
    if (!this.ctx || this.muted || !this.fxVol) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.fxOut);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, { vol = 0.4, freq = 900 } = {}) {
    if (!this.ctx || this.muted || !this.fxVol) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.fxOut);
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
}

export const sfx = new Sfx();
