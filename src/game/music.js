// Muzyka w trakcie biegu: sekwencer Web Audio, w całości syntezowany (bez plików).
// Tempo i liczba warstw rosną razem z tempem wieży (s.level), a gdy bohater zjeżdża ku dolnej krawędzi,
// dochodzi tykanie i jaśniejsze brzmienie – im bliżej przegranej, tym więcej nerwów.
import { clamp } from './util.js';

const LOOKAHEAD = 0.18;                 // s – tyle do przodu planujemy nuty (pętla klatek wywołuje update ~60×/s)
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// a-moll, harmonicznie: Am | F | Dm | E – dominanta E-dur daje napięcie, które „ciągnie” do kolejnego taktu
const BARS = [
  { bass: 45, chord: [69, 72, 76] },
  { bass: 41, chord: [65, 69, 72] },
  { bass: 38, chord: [62, 65, 69] },
  { bass: 40, chord: [64, 68, 71] },
];
const ARP = [0, 1, 2, 3, 2, 1, 0, 2, 0, 1, 2, 3, 2, 3, 1, 2];   // indeksy w [c0, c1, c2, c0+12]

/** Docelowe tempo (BPM) dla stanu biegu: spokojnie przed startem wieży, potem szybciej z każdym poziomem i w jego trakcie. */
export function musicBpm(level, progress = 0) {
  if (level <= 0) return 108;
  return 124 + (level - 1) * 12 + clamp(progress, 0, 1) * 10;
}

export class Music {
  ctx = null; bus = null; noiseBuf = null;
  playing = false; step = 0; next = 0; bpm = 108;
  level = 0; target = 108; danger = 0;

  /** Podpina muzykę pod wyjście efektów (wywoływane, gdy AudioContext już istnieje). */
  attach(ctx, out) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0;
    this.bus.connect(out);
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Nowy bieg: od początku frazy i od spokojnego tempa. */
  reset() { this.step = 0; this.bpm = musicBpm(0); }

  /**
   * Co klatkę: params = { level, progress, danger, slow } gra muzykę, null ją wycisza (slow – spowolnienie wieży: wolniejsze tempo).
   * dt – czas klatki, żeby tempo dojeżdżało do docelowego płynnie, a nie skokami.
   */
  update(params, dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (!params) {
      if (this.playing) {
        this.playing = false;
        this.bus.gain.cancelScheduledValues(now);
        this.bus.gain.setTargetAtTime(0, now, 0.08);
      }
      return;
    }
    if (!this.playing) {
      this.playing = true;
      this.next = now + 0.06;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(0.6, now, 0.05);
    }
    this.level = params.level;
    this.danger = params.danger;
    this.target = musicBpm(params.level, params.progress) * (params.slow ? 0.75 : 1);
    // przyspieszanie ~6 BPM/s – słychać, że gra się rozpędza; zwalnianie (nowy bieg) od razu
    this.bpm = this.target < this.bpm ? this.target : Math.min(this.target, this.bpm + 6 * dt);
    if (this.next < now) this.next = now + 0.02;      // karta wróciła z tła – nie nadrabiamy zaległych nut
    while (this.next < now + LOOKAHEAD) {
      this.playStep(this.step, this.next);
      this.next += 60 / this.bpm / 4;                  // szesnastka
      this.step = (this.step + 1) % 64;                // 4 takty po 16
    }
  }

  // ── jedna szesnastka: które warstwy grają, zależy od poziomu ──
  playStep(i, t) {
    const L = this.level, s = i % 16, bar = BARS[Math.floor(i / 16)], d = this.danger;
    const sixteenth = 60 / this.bpm / 4;

    // pad: długi akord na cały takt, przykrywa tło
    if (s === 0) for (const m of bar.chord) this.pad(mtof(m - 12), t, sixteenth * 16, L);

    // stopa
    if (s % 8 === 0 || (L >= 1 && s % 4 === 0) || (L >= 5 && s === 14)) this.kick(t);
    // werbel i przejście na koniec frazy
    if (L >= 2 && (s === 4 || s === 12)) this.snare(t, 0.32);
    if (L >= 4 && i >= 60) this.snare(t, 0.12 + (i - 60) * 0.06);
    // hi-hat: na „i” od poziomu 1, szesnastki od 3 (albo gdy robi się groźnie)
    if (L >= 1 && s % 4 === 2) this.hat(t, 0.16, 0.05);
    else if ((L >= 3 || d > 0.55) && s % 2 === 1) this.hat(t, 0.07, 0.03);
    // talerz na początku każdej frazy od poziomu 5
    if (L >= 5 && i === 0) this.hat(t, 0.18, 0.6);

    // bas: ćwierćnuty → ósemki → szesnastki
    const every = L >= 5 ? 1 : L >= 1 ? 2 : 4;
    if (s % every === 0) {
      const oct = (s === 6 || s === 14) && L >= 1 ? 12 : 0;
      this.bass(mtof(bar.bass + oct), t, sixteenth * every * 0.9, L);
    }

    // arpeggio: ósemki od poziomu 2, szesnastki od 3, dublowane oktawę wyżej od 4
    if (L >= 2 && (L >= 3 || s % 2 === 0)) {
      const c = bar.chord, m = [c[0], c[1], c[2], c[0] + 12][ARP[s]];
      this.lead(mtof(m), t, sixteenth * 0.9, 0.09 + d * 0.05);
      if (L >= 4) this.lead(mtof(m + 12), t, sixteenth * 0.7, 0.045);
    }

    // bohater blisko dołu ekranu: wysokie tykanie co szesnastkę – jak zegar bomby
    if (d > 0.35) this.blip(s % 4 === 0 ? 2093 : 1568, t, 0.04 + d * 0.05);
  }

  // ── instrumenty ──
  env(t, vol, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.bus);
    return g;
  }
  osc(type, f, t, dur, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  noise(t, dur, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.connect(dest); src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  pad(f, t, dur, L) {
    const g = this.env(t, 0.05, dur * 0.3, dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + L * 180 + this.danger * 900;
    lp.connect(g);
    this.osc('sawtooth', f, t, dur, lp, -8);
    this.osc('sawtooth', f, t, dur, lp, 8);
  }
  bass(f, t, dur, L) {
    const g = this.env(t, 0.32, 0.005, dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    const top = 900 + L * 260 + this.danger * 1400;
    lp.frequency.setValueAtTime(top, t); lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    lp.connect(g);
    this.osc('sawtooth', f, t, dur, lp);
    this.osc('square', f / 2, t, dur, lp);
  }
  lead(f, t, dur, vol) {
    const g = this.env(t, vol, 0.004, dur);
    this.osc('square', f, t, dur, g);
  }
  blip(f, t, vol) {
    const g = this.env(t, vol, 0.002, 0.04);
    this.osc('triangle', f, t, 0.04, g);
  }
  kick(t) {
    const g = this.env(t, 0.9, 0.002, 0.28);
    const o = this.osc('sine', 150, t, 0.28, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }
  snare(t, vol) {
    const g = this.env(t, vol, 0.002, 0.16);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    bp.connect(g);
    this.noise(t, 0.16, bp);
    this.osc('triangle', 210, t, 0.08, this.env(t, vol * 0.6, 0.002, 0.08));
  }
  hat(t, vol, dur) {
    const g = this.env(t, vol, 0.001, dur);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    hp.connect(g);
    this.noise(t, dur, hp);
  }
}
