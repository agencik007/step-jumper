// Gra: maszyna stanów (tytuł / gra / pauza / koniec / ranking / opcje) i wszystko, co widać i słychać wokół symulacji.
// Reguły rozgrywki są w src/sim – tutaj tylko podajemy im wejście i reagujemy na zdarzenia.
import {
  AXIS_MAX, DEFAULT_TUNE, H, HURRY_EVERY, InputRecorder, MAX_HURRIES, LEFT, RIGHT, SIM_VERSION, SLOW_TIME, STEP, createState, encodeInputs, packInput, runReplay, score, stateHash, step,
  unpackAxis, unpackJump,
} from '../sim';
import { online } from '../net';
import { sfx } from './audio.js';
import { CHARS } from './characters.js';
import { NEON, PENCILS, STYLES, applyStyle, cycle, style, themeOf } from './gfx.js';
import { haptics } from './haptics.js';
import { LANGS, detectLang, lang, setLang, t } from './i18n.js';
import { input, isTouch, tilt, toggleTilt } from './input.js';
import { PERIODS, SETTINGS, UIBOX, inBox, slotX } from './layout.js';
import { nickOpen, openNick } from './nickform.js';
import { render } from './render.js';
import { clamp, loadJSON, mod, rand, saveJSON } from './util.js';

const STORE = 'stepjumper.best.v1', PREFS = 'stepjumper.prefs.v1';

// progi combo (w piętrach) – napisy w strings.js pod kluczami tier.<próg>
const TIERS = [200, 140, 100, 70, 50, 35, 25, 15, 7, 4];

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const BOARD_TTL = 30;                    // s – tyle samo serwer trzyma ranking w cache

export class Game {
  constructor() {
    this.best = loadJSON(STORE, { score: 0, floor: 0, combo: 0 });
    const prefs = loadJSON(PREFS, { char: 0, style: 0, tilt: false, sound: true, music: true, vibrate: true, lang: null });
    setLang(prefs.lang ?? detectLang());   // pierwsze uruchomienie: język przeglądarki
    this.charIdx = clamp(prefs.char | 0, 0, CHARS.length - 1);
    this.styleIdx = clamp(prefs.style | 0, 0, STYLES.length - 1);
    tilt.want = !!prefs.tilt;
    sfx.muted = !prefs.sound;
    sfx.musicOn = prefs.music !== false;
    haptics.on = !!prefs.vibrate;
    applyStyle(this.styleIdx);
    this.t = 0;
    this.snow = Array.from({ length: 34 }, () => ({ x: rand(LEFT, RIGHT), y: rand(0, H), r: rand(0.8, 2.2), s: rand(12, 34), ph: rand(0, 7) }));
    this.events = [];
    this.rec = new InputRecorder();
    this.tune = { ...DEFAULT_TUNE };     // strojenie lotu; zmienia je tylko panel suwaków w trybie DEV
    this.lastRun = null;                 // zapis ostatniego zakończonego biegu (ziarno + wejścia) – materiał dla rankingu
    this.online = online;
    this.ticket = null;                  // bilet rankingu trwającego biegu (null = bieg poza rankingiem)
    this.net = null;                     // los wyniku ostatniego biegu: wysyłanie / miejsce w rankingu / kolejka / poza rankingiem
    this.board = { kind: 'day', data: {}, at: {}, loading: false };
    this.settings = { sel: 0, confirmT: 0, note: '' };
    this.nickLater = false;              // bez sieci przy wyborze nicku: gramy, a o nick zapytamy przy następnym uruchomieniu
    this.reset();
    this.state = 'title';
  }

  pick(what, d, abs = false) {
    if (what === 'char') this.charIdx = abs ? d : mod(this.charIdx + d, CHARS.length);
    else { this.styleIdx = abs ? d : mod(this.styleIdx + d, STYLES.length); applyStyle(this.styleIdx); }
    this.savePrefs();
    sfx.pick();
  }
  savePrefs() { saveJSON(PREFS, { char: this.charIdx, style: this.styleIdx, tilt: tilt.want, sound: !sfx.muted, music: sfx.musicOn, vibrate: haptics.on, lang: lang() }); }
  cycleLang(d) { setLang(LANGS[mod(LANGS.indexOf(lang()) + d, LANGS.length)]); this.savePrefs(); sfx.pick(); }

  reset(seed = newSeed()) {
    this.sim = createState(seed, this.tune);
    this.rec.reset();
    this.retuned = false;                // suwak ruszony w trakcie biegu – takiego biegu nie da się odtworzyć z zapisu
    this.fx = { angle: 0, squash: 0, runPhase: 0 };   // stan czysto wizualny bohatera
    this.shake = 0; this.parts = []; this.msgs = [];
    this.acc = 0; this.trailT = 0; this.jumpLock = true; this.newBest = false; this.overT = 0;
  }

  get score() { return score(this.sim); }

  /** Suwaki fizyki lotu (tylko DEV) zmieniły wartość: nowe strojenie działa od razu, także w trwającym biegu. */
  retune(tune) {
    Object.assign(this.tune, tune);
    Object.assign(this.sim.tune, tune);
    if (this.sim.tick > 0) this.retuned = true;
  }

  get officialTune() { return this.tune.airAccel === DEFAULT_TUNE.airAccel && this.tune.airBrake === DEFAULT_TUNE.airBrake; }

  /** Nick jest wymagany przed pierwszą grą w rankingu – inaczej wyniki wiszą jako „Gracz AB12”. */
  get needsNick() { return online.ready && online.enabled && !online.nick && !this.nickLater; }

  start() {
    if (nickOpen()) return;
    if (this.state === 'title' && this.needsNick) { this.askNick(); return; }
    // wieża z biletu rankingu (ziarno od serwera); bez biletu – losowa wieża i bieg poza rankingiem
    this.ticket = this.officialTune ? online.takeTicket() : null;
    this.reset(this.ticket ? this.ticket.seed : newSeed()); this.state = 'play';
    sfx.music.reset();
    if (tilt.active) navigator.wakeLock?.request('screen').catch(() => {});   // ekran nie gaśnie w trakcie gry
  }
  toTitle() { this.reset(); this.state = 'title'; }

  // ── ranking ──
  openBoard() { sfx.pick(); this.state = 'board'; this.loadBoard(); }
  boardTab(d, abs = false) {
    const i = abs ? d : mod(PERIODS.indexOf(this.board.kind) + d, PERIODS.length);
    if (PERIODS[i] === this.board.kind) return;
    this.board.kind = PERIODS[i]; sfx.pick(); this.loadBoard();
  }
  async loadBoard(force = false) {
    const b = this.board, kind = b.kind;
    if (!force && b.at[kind] != null && this.t - b.at[kind] < BOARD_TTL) return;
    b.at[kind] = this.t; b.loading = true;
    const [top, me] = await Promise.all([online.leaderboard(kind, 10), online.around(kind)]);
    b.data[kind] = { top, me };
    if (b.kind === kind) b.loading = false;
  }
  /** Pierwsza gra: formularz nicku, a po zapisaniu od razu bieg. Anuluj = zostajemy na ekranie tytułowym. */
  askNick() {
    sfx.pick();
    openNick('', async (nick) => {
      const r = await online.setNick(nick);
      if (!r.ok && r.error === 'offline') { this.nickLater = true; return { ok: true }; }   // nie blokujemy gry bez sieci
      return r;
    }, (saved) => {
      this.board.at = {};
      if (saved && this.state === 'title') this.start();
    }, { required: true });
  }
  editNick() {
    if (!online.enabled) return;
    sfx.pick();
    openNick(online.nick, (nick) => online.setNick(nick), () => { this.board.at = {}; this.loadBoard(); });
  }

  // ── opcje ──
  openSettings() { sfx.pick(); this.state = 'settings'; this.settings.sel = 0; this.settings.note = ''; this.settings.confirmT = 0; }
  settingsMove(d) { this.settings.sel = mod(this.settings.sel + d, SETTINGS.length); sfx.pick(); }
  /** ← → w opcjach: zmienia język, gdy wybrany jest wiersz języka. */
  settingsSide(d) { if (SETTINGS[this.settings.sel] === 'lang') this.cycleLang(d); }
  activate(i) {
    const st = this.settings;
    st.sel = i;
    switch (SETTINGS[i]) {
      case 'lang': this.cycleLang(1); break;
      case 'sound': sfx.muted = !sfx.muted; this.savePrefs(); sfx.pick(); break;
      case 'music': sfx.musicOn = !sfx.musicOn; this.savePrefs(); sfx.pick(); break;
      case 'vibrate':
        if (!haptics.available) return;
        haptics.on = !haptics.on; this.savePrefs(); haptics.buzz(40); sfx.pick(); break;
      case 'online':
        sfx.pick();
        online.setEnabled(!online.enabled).then(() => { if (online.enabled) { online.refill(); online.flush(); } });
        this.board.at = {};
        break;
      case 'delete':
        if (this.t > st.confirmT) { st.confirmT = this.t + 4; st.note = ''; sfx.pick(); return; }   // pierwsze dotknięcie tylko pyta
        st.confirmT = 0; st.note = 'set.deleting';
        online.deleteData().then((ok) => {
          st.note = ok ? 'set.deleted' : 'set.deleteFail';   // klucz tekstu – tłumaczony przy rysowaniu
          this.board.at = {}; this.board.data = {};
        });
        break;
      case 'back': this.toTitle(); break;
    }
  }
  pause() { if (this.state === 'play') this.state = 'pause'; }
  togglePause() {
    if (this.state === 'play') this.state = 'pause';
    else if (this.state === 'pause') { this.state = 'play'; this.jumpLock = true; }
  }

  pointer(x, y) {
    if (this.state === 'title') {
      for (let i = 0; i < 5; i++) {
        if (Math.abs(x - slotX(i)) <= 34) {
          if (y >= UIBOX.chars.y && y <= UIBOX.chars.y + UIBOX.chars.h) return this.pick('char', i, true);
          if (y >= UIBOX.maps.y - 4 && y <= UIBOX.maps.y + UIBOX.maps.h + 4) return this.pick('style', i, true);
        }
      }
      if (inBox(x, y, UIBOX.play)) this.start();
      else if (inBox(x, y, UIBOX.rank)) this.openBoard();
      else if (inBox(x, y, UIBOX.opts)) this.openSettings();
      else if ((isTouch || tilt.active) && inBox(x, y, UIBOX.ctrl)) toggleTilt();
    } else if (this.state === 'board') {
      for (let i = 0; i < PERIODS.length; i++) if (inBox(x, y, UIBOX.tab(i))) return this.boardTab(i, true);
      if (inBox(x, y, UIBOX.nick)) this.editNick();
      else if (inBox(x, y, UIBOX.back)) { sfx.pick(); this.toTitle(); }
    } else if (this.state === 'settings') {
      for (let i = 0; i < SETTINGS.length; i++) if (inBox(x, y, UIBOX.row(i))) return this.activate(i);
    } else if (this.state === 'pause') {
      if (inBox(x, y, UIBOX.pmenu)) { sfx.pick(); this.toTitle(); } else this.togglePause();
    } else if (this.state === 'over' && this.overT > 0.6) {
      if (inBox(x, y, UIBOX.menu)) this.toTitle(); else this.start();
    }
  }

  say(title, sub = '', color = 'gold', dur = 1.6) { this.msgs.push({ title, sub, color, dur, t: 0 }); if (this.msgs.length > 3) this.msgs.shift(); }

  // ── cząsteczki ──
  puff(x, y, n, { color = '#fff', sx = 120, sy = 80, up = 60, life = 0.4, size = 3, g = 300, star = false } = {}) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x, y, vx: rand(-sx, sx), vy: rand(-sy, sy) - up, life: life * rand(0.6, 1.2), max: life, size: size * rand(0.6, 1.3), color, g, star, rot: rand(0, 7) });
    }
  }
  dustColor(n) {
    return style.world === 'neon' ? cycle(NEON, n) : style.world === 'sketch' ? 'rgba(31,42,68,.55)' : themeOf(n).top;
  }

  gameOver() {
    this.state = 'over'; this.overT = 0; this.msgs = [];
    sfx.over();
    const b = this.best, s = this.sim;
    this.newBest = this.score > b.score && this.score > 0;
    b.score = Math.max(b.score, this.score);
    b.floor = Math.max(b.floor, s.maxFloor);
    b.combo = Math.max(b.combo, s.bestCombo);
    saveJSON(STORE, b);

    haptics.buzz(120);
    if (this.retuned) { this.lastRun = null; this.sendRun(null); return; }   // strojenie zmieniało się po drodze, więc zapis nie opisuje tego biegu
    const ticks = this.rec.ticks();
    // ranked: serwer liczy zawsze z DEFAULT_TUNE, więc bieg na zmienionym strojeniu (suwaki DEV) nie idzie do rankingu
    const ranked = s.tune.airAccel === DEFAULT_TUNE.airAccel && s.tune.airBrake === DEFAULT_TUNE.airBrake;
    this.lastRun = { simVersion: SIM_VERSION, seed: s.seed, tune: { ...s.tune }, ranked, ticks: ticks.length, score: this.score, inputs: encodeInputs(ticks) };
    if (import.meta.env.DEV) {                           // kontrola determinizmu: zapis odtworzony od zera musi dać ten sam stan
      const again = runReplay(s.seed, ticks, createState(s.seed, s.tune));
      if (stateHash(again) !== stateHash(s)) console.error('Symulacja nie jest deterministyczna: odtworzenie zapisu dało inny stan', { live: s, again });
    }
    this.sendRun(ranked ? ticks : null);
  }

  /** Wysyła zakończony bieg do rankingu (w tle); wynik ląduje w this.net i pokazuje go ekran końca gry. */
  sendRun(ticks) {
    const ticket = this.ticket;
    this.ticket = null;
    if (!ticks || !ticket) {
      this.net = { status: 'unranked', reason: !ticks ? 'tuned' : !online.enabled ? 'off' : online.outdated ? 'outdated' : 'offline' };
      return;
    }
    this.net = { status: 'sending', runId: ticket.runId };
    const control = tilt.active ? 'tilt' : isTouch ? 'touch' : 'keys';
    online.submit({ ticket, ticks: ticks.slice(), score: this.score, char: CHARS[this.charIdx].id, style: STYLES[this.styleIdx].id, control })
      .catch(() => ({ status: 'queued' }))
      .then((r) => {
        if (this.net?.runId === ticket.runId) this.net = { ...r, runId: ticket.runId };
        this.board.at = {};              // ranking się zmienił
      });
  }

  // ── reakcja na zdarzenia symulacji: dźwięk, cząsteczki, komunikaty ──
  onEvent(e) {
    const h = this.sim.hero, fx = this.fx;
    switch (e.type) {
      case 'jump':
        fx.squash = -0.6; fx.angle = 0;
        sfx.jump(e.power);
        break;
      case 'land':
        fx.squash = 0.9; fx.angle = 0;
        this.puff(h.x, h.y, 6, { color: this.dustColor(e.floor), sx: 110, sy: 20, up: 50, life: 0.35 });
        sfx.land();
        break;
      case 'bounce':
        sfx.bounce();
        this.puff(e.left ? LEFT : RIGHT, h.y - 24, 7, { color: this.dustColor(Math.max(0, h.from)), sx: 60, sy: 140, up: 0, life: 0.35, size: 2.5 });
        break;
      case 'combo': {
        const ti = TIERS.findIndex((min) => e.floors >= min);
        const label = ti >= 0 ? t(`tier.${TIERS[ti]}`) : t('msg.combo');
        this.say(label, t('msg.comboSub', { floors: e.floors, points: e.points }), 'gold', 1.8);
        sfx.combo(TIERS.length - 1 - ti);
        haptics.buzz(30);
        break;
      }
      case 'boost':
        this.say(t('msg.boost'), t('msg.boostSub'), 'gold', 1.8);
        this.shake = 0.35; sfx.boost(); haptics.buzz(80);
        this.puff(h.x, h.y - 20, 18, { color: '#ffb52e', sx: 160, sy: 120, up: 0, life: 0.5, size: 4, g: 200, star: true });
        break;
      case 'boostEnd':
        sfx.boostEnd();
        break;
      case 'slow':
        this.say(t('msg.slow'), t('msg.slowSub', { s: SLOW_TIME }), 'mint', 1.8);
        sfx.slow(); haptics.buzz(50);
        this.puff(h.x, h.y - 24, 14, { color: '#7ec8ff', sx: 120, sy: 120, up: 20, life: 0.6, size: 3.5, g: 60, star: true });
        break;
      case 'slowEnd':
        sfx.slowEnd();
        break;
      case 'hurry':
        this.say(t('msg.hurry'), '', 'warn', 1.5);
        this.msgs[this.msgs.length - 1].hurry = true;
        this.shake = 0.6; sfx.hurry(); haptics.buzz(60);
        break;
      case 'over':
        this.gameOver();
        break;
    }
  }

  // ── jeden krok fizyki + efekty, które idą z nim w parze ──
  tick() {
    const s = this.sim, h = s.hero, fx = this.fx, dt = STEP;

    // wejście: po starcie i po pauzie skok działa dopiero po puszczeniu przycisku
    if (this.jumpLock && !input.jump) this.jumpLock = false;
    const wantJump = input.jump && !this.jumpLock;
    // klawisze/przyciski dają pełne ±1; przechył daje wartość płynną, czyli słabsze lub mocniejsze przyspieszenie
    let axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (!axis && tilt.active) axis = tilt.axis;
    // symulacja dostaje dokładnie to, co trafia do zapisu biegu
    const packed = packInput(axis * AXIS_MAX, wantJump);
    this.rec.push(packed);

    const wasGrounded = h.onFloor >= 0;
    this.events.length = 0;
    step(s, unpackAxis(packed), unpackJump(packed), this.events);
    for (const e of this.events) this.onEvent(e);

    if (wasGrounded) fx.runPhase += Math.abs(h.vx) * dt * 0.085;
    if (s.rising) {                                      // wyrzut: płomień spod nóg
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.012;
        const col = ['#ffe066', '#ffb52e', '#ff5a3c'][Math.floor(Math.random() * 3)];
        this.puff(h.x, h.y + 4, 1, { color: col, sx: 30, sy: 20, up: -260, life: 0.35, size: 5, g: 0 });
      }
    } else if (h.onFloor < 0 && h.spin) {
      fx.angle += dt * 15;
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.03;
        const cols = style.world === 'sketch' ? PENCILS : ['#ffe066', '#7ef0e0', '#ff9ecb', '#ffffff'];
        this.puff(h.x, h.y - 24, 1, { color: cols[Math.floor(Math.random() * cols.length)], sx: 40, sy: 40, up: 0, life: 0.5, size: 5, g: 120, star: true });
      }
    }
    fx.squash += (0 - fx.squash) * Math.min(1, 12 * dt);

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.rot += dt * 6;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
  }

  frame(dt) {
    this.t += dt;
    const edge = input.takeEdge();
    const camBefore = this.sim.camY;
    if (this.state === 'title') { if (edge) this.start(); }
    else if (this.state === 'pause') { if (edge) this.togglePause(); }
    else if (this.state === 'over') { this.overT += dt; if (edge && this.overT > 0.6) this.start(); }
    else if (this.state === 'board') { if (edge) this.toTitle(); }
    else if (this.state === 'settings') { if (edge) this.activate(this.settings.sel); }
    else {
      this.acc += dt;
      while (this.acc >= STEP && this.state === 'play') { this.tick(); this.acc -= STEP; }
    }
    // efekty niezależne od fizyki
    if (this.state !== 'pause') {
      for (const m of this.msgs) m.t += dt;
      this.msgs = this.msgs.filter((m) => m.t < m.dur);
      this.shake = Math.max(0, this.shake - dt);
      const rise = clamp(camBefore - this.sim.camY, 0, 200);
      for (const s of this.snow) {
        s.y += s.s * dt + rise * 0.35; s.x += Math.sin(this.t * 1.3 + s.ph) * 8 * dt;
        if (s.y > H + 4) { s.y = -4; s.x = rand(LEFT, RIGHT); }
      }
    }
    sfx.song(this.state === 'play' ? this.musicParams() : null, dt);
    if (document.body.dataset.state !== this.state) this.showState();
    render(this);
  }

  /** Stan gry na <body>: CSS pokazuje przycisk pauzy tylko w biegu i w pauzie (wtedy z ikoną „graj”). */
  showState() {
    document.body.dataset.state = this.state;
    const btn = document.getElementById('pause');
    if (!btn) return;
    btn.dataset.i18nAria = this.state === 'pause' ? 'aria.resume' : 'aria.pause';
    btn.setAttribute('aria-label', t(btn.dataset.i18nAria));
    btn.title = t(btn.dataset.i18nAria);
  }

  /** Stan biegu dla muzyki: poziom tempa wieży, postęp do kolejnego przyspieszenia i jak blisko dołu jest bohater (0…1). */
  musicParams() {
    const s = this.sim;
    return {
      level: s.scrolling ? s.level : 0,
      progress: s.hurries < MAX_HURRIES ? s.clock / HURRY_EVERY : 1,
      danger: s.scrolling ? clamp((s.hero.y - s.camY - 320) / 180, 0, 1) : 0,
      slow: s.slow.t > 0,
    };
  }
}

