// Gra: maszyna stanów (tytuł / gra / pauza / koniec / ranking / opcje) i wszystko, co widać i słychać wokół symulacji.
// Reguły rozgrywki są w src/sim – tutaj tylko podajemy im wejście i reagujemy na zdarzenia.
import {
  AXIS_MAX, DEFAULT_TUNE, H, HURRY_EVERY, HW, InputRecorder, MAX_HURRIES, LEFT, NARROW_MAX, RIGHT, SIM_VERSION, SLOW_TIME, STEP, createState, encodeInputs,
  narrowLevel, packInput, runReplay, score, stateHash, step, unpackAxis, unpackJump,
} from '../sim';
import { live, online } from '../net';
import { LIVE_COMBO, LIVE_FLOOR_EVERY } from '../net/live';
import { VOL_STEPS, sfx } from './audio.js';
import { access, fontSize, loadAccess } from './access.js';
import { CHARS } from './characters.js';
import { creatorOpen, openCreator } from './creator.js';
import { drinkAt, drinkSay } from './drinks.js';
import { bakeSkin, buildSkin, loadSkin, packBytes, previewPack, saveFromPack, sharePack } from './skins.js';
import { FONT, MEDALS, NEON, PENCILS, STYLES, applyStyle, ctx, cycle, style, themeOf } from './gfx.js';
import { KIND_NAMES, gpad } from './gamepad.js';
import { HAPTIC_LEVELS, haptics } from './haptics.js';
import { LANGS, detectLang, lang, setLang, t } from './i18n.js';
import {
  CONTROLS, DEAD_STEPS, JUMP_MODES, OPTS_DEFAULT, SENS_MAX, TILT_ZERO_MAX, binds, ctrl, hintMode, input, isTouch, loadBinds, opts, resetBinds, setBind, setControl, tilt, touchAxis,
} from './input.js';
import { ARROW_W, CHAR_W, LIST, LIST_BACK, LIVE_ROWS, NOTE_FONT, PERIODS, UIBOX, bindCell, charX, inBox, isTextPage, rowBox, sliderBar, sliderValueAt, slotX } from './layout.js';
import { nickOpen, openNick } from './nickform.js';
import { openRoom, roomOpen } from './roomform.js';
import { buildNews, buildPages, buildRules, selectable } from './options.js';
import { loadPads, mirrorPads, resetPads, savedPads } from './padlayout.js';
import { render } from './render.js';
import { announce, speakFrame, speakStatus } from './speech.js';
import { fmt } from './format.js';
import { keepAwake } from './wake.js';
import { power, setPowerMode } from './power.js';
import { reloadForUpdate, update } from './update.js';
import { clamp, loadJSON, mod, rand, reduceMotion, saveJSON } from './util.js';

const STORE = 'stepjumper.best.v1', PREFS = 'stepjumper.prefs.v1', WEEK = 'stepjumper.week.v1';

/** Tryb DEV: ?crown=1|2|3 w adresie zakłada koronę bez rankingu – do oglądania efektów nagrody. */
const DEV_CROWN = import.meta.env.DEV ? clamp(Number(new URLSearchParams(location.search).get('crown')) | 0, 0, 3) || null : null;
const REPLAY_SPEEDS = [1, 2, 4];

// progi combo (w piętrach) – napisy w strings.js pod kluczami tier.<próg>
const TIERS = [200, 140, 100, 70, 50, 35, 25, 15, 7, 4];

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const CHAR_ARM = 3;                      // s – „⬇ POSTAĆ”: tyle czeka na drugie dotknięcie (potwierdzenie)
const BOARD_TTL = 30;                    // s – tyle samo serwer trzyma ranking w cache
/** Numer miejsca własnej postaci na ekranie tytułowym (za pięcioma wbudowanymi). */
export const CUSTOM = CHARS.length;

export class Game {
  constructor() {
    this.best = loadJSON(STORE, { score: 0, floor: 0, combo: 0 });
    const prefs = loadJSON(PREFS, {
      char: 0, style: 0, control: null, tilt: false, tiltSens: SENS_MAX / 2, tiltZero: 0, sound: true, music: true, vibrate: 2, lefty: false, lang: null,
      power: 'auto', jumpMode: 'hold', stickDead: opts.stickDead, padDead: opts.padDead, pads: null, keys: null, padKeys: null, keyNames: null, custom: null,
    });
    setLang(prefs.lang ?? detectLang());   // pierwsze uruchomienie: język przeglądarki
    this.charIdx = clamp(prefs.char | 0, 0, CUSTOM);
    // własna postać z KREATORA (IndexedDB): do czasu wczytania rysujemy pierwszą wbudowaną
    this.custom = null;
    this.customId = typeof prefs.custom === 'string' ? prefs.custom : null;
    this.customHash = null;              // skrót paczki własnej postaci – idzie z biegiem do rankingu (serwer poprosi o paczkę, gdy bieg wejdzie do trójki)
    this.remote = new Map();             // postacie z najlepszej trójki pobrane do obejrzenia (powtórki, podium): skrót → { skin, wait }
    this.charLoad = null;                // „⬇ POSTAĆ” w rankingu: pobieranie w toku
    this.charArm = null;                 // „⬇ POSTAĆ” dotknięte raz: { hash, until } – drugie dotknięcie do until wczytuje
    this.leaveArm = 0;                   // OPUŚĆ POKÓJ dotknięte raz: do tej chwili (this.t) drugie dotknięcie wychodzi
    this.leaving = false;                // wyjście z pokoju w toku
    online.skinSource = packBytes;
    // serwer zamknął połączenie z pokojem, bo gracz wyszedł z niego na innym urządzeniu: odśwież pokój i ranking
    live.onLeft = () => { online.roomInfo().then(() => this.roomChanged()); };
    live.onEvent = (ev) => this.friendEvent(ev);
    this.feed = [];                      // komunikaty o znajomych z pokoju: { text, color, t, dur }, pokazywane po kolei
    this.feedOn = prefs.feed !== false;  // OPCJE → Komunikaty znajomych
    if (this.customId) this.loadCustom(this.customId);
    else if (this.charIdx === CUSTOM) this.charIdx = 0;
    this.styleIdx = clamp(prefs.style | 0, 0, STYLES.length - 1);
    tilt.sens = clamp(Math.round(Number(prefs.tiltSens)) || 0, 0, SENS_MAX);
    tilt.zero = clamp(Math.round(Number(prefs.tiltZero)) || 0, -TILT_ZERO_MAX, TILT_ZERO_MAX);
    opts.jump = JUMP_MODES.includes(prefs.jumpMode) ? prefs.jumpMode : 'hold';
    opts.stickDead = clamp(Math.round(Number(prefs.stickDead)) || 0, 0, DEAD_STEPS);
    opts.padDead = clamp(Math.round(Number(prefs.padDead)) || 0, 0, DEAD_STEPS);
    loadBinds(prefs.keys, prefs.padKeys, prefs.keyNames);
    loadPads(prefs.pads);
    loadAccess(prefs.access);
    setPowerMode(prefs.power);
    setControl(prefs.control ?? (prefs.tilt ? 'tilt' : 'buttons'));   // starsze zapisy znały tylko „przechył tak/nie”
    sfx.muted = !prefs.sound;
    // głośność efektów i muzyki 0…10; dawny przełącznik „muzyka wył.” to głośność 0
    const vol = (v, def) => (Number.isInteger(v) ? clamp(v, 0, VOL_STEPS) : def);
    sfx.fxVol = vol(prefs.fxVol, VOL_STEPS);
    sfx.musicVol = vol(prefs.musicVol, prefs.music === false ? 0 : VOL_STEPS);
    // wibracje: dawniej tak / nie, teraz siła 0…3
    haptics.level = prefs.vibrate === true ? 2 : prefs.vibrate === false ? 0 : clamp(Math.round(Number(prefs.vibrate)) || 0, 0, HAPTIC_LEVELS.length - 1);
    this.setLefty(!!prefs.lefty);
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
    this.board = { kind: 'week', scope: null, data: {}, at: {}, loading: false };   // scope: 'world' / 'room' (null = jeszcze nie wybrany)
    this.replay = null;                  // oglądana powtórka z rankingu (stan 'replay') albo jej wczytywanie
    this.recap = null;                   // wyniki zamkniętego tygodnia (stan 'recap')
    this.recapPending = false;           // podsumowanie czeka, aż gracz wróci na ekran tytułowy
    this.tier = null;                    // korona (1–3) bohatera w trwającym biegu albo w powtórce
    this.settings = { sel: 0, slot: 0, confirmT: 0, confirmK: null, note: '', page: 'main', from: 'title', scroll: 0, scrollTo: 0, capture: null };
    this.pages = buildPages(this);       // strony opcji (options.js)
    this.recapSel = 0;                   // wybrane miejsce na podium (pad, strzałki)
    this.nickLater = false;              // bez sieci przy wyborze nicku: gramy, a o nick zapytamy przy następnym uruchomieniu
    this.reset();
    this.state = 'title';
  }

  pick(what, d, abs = false) {
    if (what === 'char') this.charIdx = abs ? d : mod(this.charIdx + d, CUSTOM + (this.customId ? 1 : 0));
    else { this.styleIdx = abs ? d : mod(this.styleIdx + d, STYLES.length); applyStyle(this.styleIdx); }
    this.savePrefs();
    sfx.pick();
  }
  savePrefs() {
    saveJSON(PREFS, {
      char: this.charIdx, style: this.styleIdx, control: ctrl.mode, tiltSens: tilt.sens, tiltZero: tilt.zero, sound: !sfx.muted, fxVol: sfx.fxVol, musicVol: sfx.musicVol,
      vibrate: haptics.level, lefty: this.lefty, lang: lang(), jumpMode: opts.jump, stickDead: opts.stickDead, padDead: opts.padDead,
      pads: savedPads(), keys: binds.key, padKeys: binds.pad, keyNames: binds.names, access: { ...access }, power: power.mode, custom: this.customId, feed: this.feedOn,
    });
  }

  // ── własne postacie (KREATOR, creator.js) ──
  async loadCustom(id) {
    const skin = await loadSkin(id);
    if (this.customId !== id) return;                    // w międzyczasie wybrano inną
    if (skin) { this.custom = skin; this.refreshCustomHash(); return; }
    this.setCustom(null);                                // usunięta albo nie da się jej wczytać
  }
  /** Gra tą postacią (null = żadna własna; wybór wraca na pierwszą wbudowaną). */
  setCustom(skin) {
    this.custom = skin; this.customId = skin?.id ?? null;
    if (skin) this.charIdx = CUSTOM; else if (this.charIdx === CUSTOM) this.charIdx = 0;
    this.savePrefs();
    this.refreshCustomHash();
  }
  /** Paczka postaci na serwer (skins.js → sharePack): liczona w tle, raz na wersję postaci. */
  refreshCustomHash() {
    const id = this.customId;
    this.customHash = null;
    if (id) sharePack(id).then((h) => { if (this.customId === id) this.customHash = h; });
  }
  /** Postać z najlepszej trójki do obejrzenia: gotowa albo null (wtedy pobiera się w tle). */
  remoteSkin(hash) {
    if (!hash) return null;
    let r = this.remote.get(hash);
    if (!r) {
      r = { skin: null, wait: null };
      r.wait = online.skinPack(hash).then((b) => (b ? previewPack(b, hash) : null)).then((sk) => { r.skin = sk; if (!sk) this.remote.delete(hash); return sk; });
      this.remote.set(hash, r);
    }
    return r.skin;
  }
  /** Już pobrana postać z trójki (do rysowania – niczego nie pobiera). */
  remoteReady(hash) { return this.remote.get(hash)?.skin ?? null; }
  /**
   * „⬇ POSTAĆ” w rankingu: postać gracza z trójki trafia do KREATORA (własne postacie) i od razu jest wybrana na ekranie
   * tytułowym. Pierwsze dotknięcie tylko pyta („NA PEWNO?”), wczytuje dopiero drugie w ciągu CHAR_ARM s – przycisk leży
   * w wierszu rankingu i łatwo go trafić niechcący. Ta sama postać drugi raz się nie dubluje, a własna postać gracza
   * (jego bieg w trójce) wraca jako ona sama. Poprzednio wybrana postać zostaje w KREATORZE – komunikat o tym mówi.
   */
  async loadBoardChar(e) {
    if (!e?.skin || this.charLoad) return;
    sfx.pick();
    if (!this.charArmed(e.skin)) {
      this.charArm = { hash: e.skin, until: this.t + CHAR_ARM };
      announce(t('sr.charAsk', { nick: e.nick ?? t('board.player', { tag: e.tag }) }));   // na ekranie: przycisk „NA PEWNO?”
      return;
    }
    this.charArm = null;
    const prev = this.custom;
    this.charLoad = { hash: e.skin };
    try {
      const bytes = await online.skinPack(e.skin);
      if (!bytes) throw new Error('net');
      const rec = await saveFromPack(bytes, e.skin, e.nick ?? t('board.player', { tag: e.tag }));
      const sk = bakeSkin(await buildSkin(rec));
      if (!sk) throw new Error('bad');
      this.charLoad = null;
      this.setCustom(sk);
      if (this.state === 'board') this.toTitle();
      const kept = prev && prev.id !== rec.id ? prev.name : '';
      this.say(t('msg.charLoaded'), t(kept ? 'msg.charLoadedPrev' : 'msg.charLoadedSub', { name: rec.name, prev: kept }), 'mint', kept ? 3.6 : 2.4);
    } catch (err) {
      this.charLoad = null;
      this.say(t('msg.charFail'), err?.key ? t(err.key, err.vars) : t('msg.charFailSub'), 'warn', 2.8);
    }
  }
  /** „⬇ POSTAĆ” tej postaci czeka na potwierdzenie (drugie dotknięcie). */
  charArmed(hash) { return this.charArm?.hash === hash && this.t < this.charArm.until; }
  /** Wiersz rankingu z miejscem 1–3 i postacią do wczytania: wybrany (pad, strzałki) albo pierwszy taki. */
  boardLoadChar() {
    const rows = this.boardData?.top?.entries ?? [];
    const e = this.board.sel >= 0 ? rows.find((x) => x.rank === this.board.sel + 1) : rows.find((x) => x.rank <= 3 && x.skin);
    this.loadBoardChar(e);
  }
  openCreator() {
    if (this.state !== 'title' || nickOpen() || creatorOpen()) return;
    sfx.pick();
    openCreator(this);
  }
  /** Postać do narysowania: numer wbudowanej albo własna (do czasu wczytania – pierwsza wbudowana). */
  get heroChar() { return this.charIdx === CUSTOM ? (this.custom ?? 0) : this.charIdx; }
  /** Układ przycisków ekranowych: leworęczny = skok pod lewym kciukiem, ◀ ▶ pod prawym. Własny układ odbija się wtedy w poziomie. */
  setLefty(on, mirror = false) {
    if (mirror && on !== this.lefty) mirrorPads();
    this.lefty = on;
    if (typeof document !== 'undefined') document.body.classList.toggle('lefty', on);
  }
  /** Rodzaj podpowiedzi na ekranie: 'touch' | 'keys' | 'pad' (ostatnio używane wejście). */
  get hint() { return hintMode(); }
  cycleLang(d) { setLang(LANGS[mod(LANGS.indexOf(lang()) + d, LANGS.length)]); this.savePrefs(); sfx.pick(); }

  reset(seed = newSeed(), tune = this.tune) {
    this.sim = createState(seed, tune);
    this.rec.reset();
    this.retuned = false;                // suwak ruszony w trakcie biegu – takiego biegu nie da się odtworzyć z zapisu
    this.fx = { angle: 0, squash: 0, runPhase: 0 };   // stan czysto wizualny bohatera
    this.shake = 0; this.parts = []; this.msgs = [];
    this.liveMark = 0;                   // ostatnia setka pięter ogłoszona znajomym z pokoju
    this.acc = 0; this.trailT = 0; this.rubT = 0; this.jumpLock = true; this.newBest = false; this.overT = 0;
    this.jumpPrev = false; this.latch = false;   // skok „przełącznikiem”: włączony trwa do następnego wciśnięcia
    this.autoDir = 1;                    // tryb jednego przycisku: kierunek biegu
    this.narrow = 0;                     // najwyższy stopień zwężenia pięter, o którym gracz już wie
    this.drinks = { beer: 0, vodka: 0 }; // ile piw i wódek (boosterów) złapano w biegu – od tego zależy tekst (drinks.js)
  }

  get score() { return score(this.sim); }

  /** Moja korona na ten tydzień (miejsce 1–3 w zeszłym tygodniu) albo null. */
  get crown() { return DEV_CROWN ?? online.crown; }
  /** Postać na planszy: w powtórce ta, którą grał oglądany gracz. */
  get heroIdx() { return this.state === 'replay' && this.replay?.data ? this.replay.charIdx : this.heroChar; }

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
    if (nickOpen() || creatorOpen()) return;
    if (this.state === 'title' && this.needsNick) { this.askNick(); return; }
    // wieża z biletu rankingu (ziarno od serwera); bez biletu – losowa wieża i bieg poza rankingiem
    this.ticket = this.officialTune ? online.takeTicket() : null;
    this.reset(this.ticket ? this.ticket.seed : newSeed()); this.state = 'play';
    this.tier = this.crown;
    if (this.tier) this.say(t(`crown.${this.tier}`), t('crown.sub', { rank: this.tier }), 'gold', 2);
    sfx.music.reset();
  }
  toTitle() {
    this.reset(); this.state = 'title';
    if (this.recapPending) this.openRecap();
  }

  // ── ranking ──
  // ── pokój znajomych na żywo (src/net/live.ts) ──
  /** Połączenie na żywo tylko w pokoju, z włączonym rankingiem i z kartą na wierzchu. */
  syncLive() {
    if (online.enabled && online.room && !document.hidden) live.start(); else live.stop();
  }
  /** Stan dla znajomych w pokoju: menu albo bieg z piętrem i wynikiem (live.ts wysyła go oszczędnie). */
  /** Zdarzenie z biegu znajomego (live.ts) → komunikat na górze ekranu i dla czytnika ekranu. */
  friendEvent(ev) {
    if (!this.feedOn) return;
    const name = ev.nick ?? t('board.player', { tag: ev.tag });
    let key = 'feed.score', color = 'hint';
    if (ev.e === 'floor') key = 'feed.floor';
    else if (ev.e === 'combo') key = 'feed.combo';
    else if (live.myKey && ev.over.includes(live.myKey)) { key = 'feed.over'; color = 'warn'; }
    else if (ev.roomBest) { key = 'feed.roomBest'; color = 'gold'; }
    else if (ev.best) { key = 'feed.best'; color = 'gold'; }
    const text = t(key, { name, n: fmt(ev.n ?? 0), score: fmt(ev.score ?? 0) });
    this.feed.push({ text, color, t: 0, dur: 3.4 });
    if (this.feed.length > 4) this.feed.splice(1, 1);  // zaległe najstarsze przepadają (bieżący zostaje do końca)
    announce(text);
  }
  toggleFeed() { this.feedOn = !this.feedOn; if (!this.feedOn) this.feed = []; this.savePrefs(); sfx.pick(); }
  /** Własny bieg (tylko oficjalny, z biletem rankingu): setki pięter i duże combo idą do znajomych z pokoju. */
  liveFloor() {
    const mark = Math.floor(this.sim.maxFloor / LIVE_FLOOR_EVERY);
    if (mark <= this.liveMark) return;
    this.liveMark = mark;
    if (this.ticket) live.event('floor', mark * LIVE_FLOOR_EVERY);
  }
  liveStatus() {
    if (this.state === 'play' || this.state === 'pause') live.setStatus('play', this.sim.maxFloor, this.score);
    else live.setStatus('menu');
  }

  openBoard() {
    sfx.pick(); this.state = 'board'; this.board.sel = -1;
    this.board.scope ??= online.room ? 'room' : 'world';   // gracz w pokoju znajomych widzi najpierw ranking pokoju
    this.loadBoard();
    if (online.hasAccount) {                               // pokój mógł się zmienić na innym urządzeniu albo zniknąć
      const before = online.room?.name;
      online.roomInfo().then(() => { if (online.room?.name !== before) this.roomChanged(); });
    }
  }
  /** Ranking wszystkich ('world') albo mojego pokoju znajomych ('room'). */
  get boardScope() { return this.board.scope === 'room' && online.room ? 'room' : 'world'; }
  /** Klucz rankingu w board.data i board.at: okres, a dla pokoju 'room:<okres>'. */
  boardKey(kind = this.board.kind) { return this.boardScope === 'room' ? `room:${kind}` : kind; }
  get boardData() { return this.board.data[this.boardKey()]; }
  /** WSZYSCY / POKÓJ – tylko dla gracza w pokoju (poza pokojem ranking jest jeden). */
  boardScopeSet(scope) {
    if (!online.room || scope === this.boardScope) return;
    this.board.scope = scope; this.board.sel = -1; sfx.pick(); this.loadBoard();
  }
  boardScopeToggle() { this.boardScopeSet(this.boardScope === 'room' ? 'world' : 'room'); }

  // ── pokój znajomych w menu głównym: DOŁĄCZ / UTWÓRZ poza pokojem, OPUŚĆ POKÓJ w pokoju ──
  /** Panel pokoju na ekranie tytułowym jest widoczny (ranking online włączony). */
  get roomPanelOn() { return online.enabled && this.state === 'title'; }
  /** Okienko pokoju (roomform.js): kind 'join' – dołączenie nazwą i hasłem, 'create' – nowy pokój. */
  openRoomForm(kind) {
    if (!this.roomPanelOn || online.room || roomOpen() || nickOpen() || creatorOpen()) return;
    sfx.pick();
    openRoom(online, kind, () => this.roomChanged());
  }
  /** OPUŚĆ POKÓJ: pierwsze dotknięcie pyta (NA PEWNO?), drugie w ciągu kilku sekund wychodzi. */
  leaveRoom() {
    if (!this.roomPanelOn || !online.room || this.leaving) return;
    sfx.pick();
    if (this.t >= this.leaveArm) { this.leaveArm = this.t + CHAR_ARM; announce(t('room.leaveSure')); return; }
    this.leaveArm = 0; this.leaving = true;
    online.leaveRoom().then((ok) => {
      this.leaving = false;
      if (ok) this.roomChanged(); else this.say(t('room.err.offline'), '', 'warn', 2.4);
    });
  }
  get leaveArmed() { return this.t < this.leaveArm; }
  /**
   * Układ panelu pokoju na ekranie tytułowym (prawa kolumna) – wspólny dla rysowania i dotyku.
   * Poza pokojem: nagłówek i DOŁĄCZ / UTWÓRZ. W pokoju: nazwa, znajomi w grze (najwyżej LIVE_ROWS) i OPUŚĆ POKÓJ.
   */
  roomPanel() {
    const B = UIBOX.live, x = B.x + 6, w = B.w - 12;
    if (!online.room) return { ...B, h: 90, join: { x, y: B.y + 26, w, h: 26 }, create: { x, y: B.y + 58, w, h: 26 } };
    const others = live.players.filter((p) => !p.me), shown = live.connected ? others.slice(0, LIVE_ROWS) : [];
    const rows = Math.max(1, shown.length) + (others.length > shown.length ? 0.6 : 0);
    const top = B.y + 26 + rows * 30;
    return { ...B, h: top - B.y + 34, others, shown, leave: { x, y: top + 2, w, h: 26 } };
  }
  /** Wejście do pokoju, wyjście albo zniknięcie pokoju: stary ranking pokoju idzie do kosza. */
  roomChanged() {
    const b = this.board;
    for (const k of Object.keys(b.data)) if (k.startsWith('room:')) { delete b.data[k]; delete b.at[k]; }
    b.scope = online.room ? 'room' : 'world'; b.sel = -1;
    if (this.state === 'board') this.loadBoard(true);
    live.stop(); this.syncLive();                          // połączenie z nowym pokojem (albo żadnym)
  }
  boardTab(d, abs = false) {
    const i = abs ? d : mod(PERIODS.indexOf(this.board.kind) + d, PERIODS.length);
    if (PERIODS[i] === this.board.kind) return;
    this.board.kind = PERIODS[i]; this.board.sel = -1; sfx.pick(); this.loadBoard();
  }
  /** Strzałki / pad w rankingu: wybór wiersza 1–3 z powtórką (−1 = żaden). */
  boardMove(d) {
    const rows = (this.boardData?.top?.entries ?? []).filter((e) => e.rank <= 3 && (e.replay || e.skin)).map((e) => e.rank - 1);
    if (!rows.length) { this.board.sel = -1; return; }
    const opts2 = [-1, ...rows], i = opts2.indexOf(this.board.sel);
    this.board.sel = opts2[clamp((i < 0 ? 0 : i) + d, 0, opts2.length - 1)];
    sfx.pick();
  }
  /** Enter / A w rankingu: powtórka wybranego wiersza albo powrót do tytułu. */
  boardConfirm() {
    const e = this.boardData?.top?.entries.find((x) => x.rank === this.board.sel + 1);
    if (this.board.sel >= 0 && e?.replay) this.boardReplay(this.board.sel + 1);
    else if (this.board.sel >= 0 && e?.skin) this.loadBoardChar(e);
    else { sfx.pick(); this.toTitle(); }
  }
  async loadBoard(force = false) {
    const b = this.board, kind = b.kind, key = this.boardKey(kind);
    if (!force && b.at[key] != null && this.t - b.at[key] < BOARD_TTL) return;
    b.at[key] = this.t; b.loading = true;
    if (key.startsWith('room:')) {
      // ranking pokoju: wszyscy gracze pokoju naraz, na ekranie 10 najlepszych, a moje miejsce – jak w rankingu ogólnym
      const r = await online.roomBoard(kind);
      if (!online.room) { this.roomChanged(); return; }       // pokój zniknął (serwer mówi: poza pokojem)
      b.data[key] = r ? { top: { ...r.top, entries: r.top.entries.slice(0, 10) }, me: r.me } : { top: null, me: null };
    } else {
      const [top, me] = await Promise.all([online.leaderboard(kind, 10), online.around(kind)]);
      b.data[key] = { top, me };
    }
    if (this.boardKey() === key) b.loading = false;
  }
  /** Wiersz rankingu z miejscem 1–3 (dotknięcie, klawisz 1–3): powtórka biegu. */
  boardReplay(rank) {
    const e = this.boardData?.top?.entries.find((x) => x.rank === rank);
    if (e?.replay) this.openReplay(e, 'board');
  }

  // ── podsumowanie zamkniętego tygodnia ──
  /**
   * Przy starcie gry: wyniki zeszłego tygodnia (przy okazji odświeża koronę). Raz na tydzień, gdy gracz ma już konto,
   * pokazuje podsumowanie: podium, moje miejsce i powtórki najlepszej trójki.
   */
  async loadLastWeek() {
    const lw = await online.lastWeek(10);
    if (!lw) return;
    this.board.data.lastweek = lw; this.board.at.lastweek = this.t;
    const seen = loadJSON(WEEK, { seen: null }).seen;
    if (!online.hasAccount || !lw.top.entries.length || seen === lw.top.period) return;
    this.recap = lw;
    if (this.state === 'title' && !nickOpen()) this.openRecap(); else this.recapPending = true;
  }
  openRecap() {
    this.recapPending = false;
    if (!this.recap) return;
    saveJSON(WEEK, { seen: this.recap.top.period });
    this.state = 'recap'; this.recapSel = 0;
    for (const e of this.recap.top.entries) if (e.rank <= 3 && e.skin) this.remoteSkin(e.skin);   // własne postacie na podium
    sfx.combo(4);
  }
  closeRecap() { sfx.pick(); this.toTitle(); }
  /** Z podsumowania do pełnego rankingu zeszłego tygodnia. */
  recapBoard() { this.board.kind = 'lastweek'; this.board.scope = 'world'; this.openBoard(); }
  /** Strzałki / pad na podium: wybór miejsca (kolejność na ekranie: 2. – 1. – 3.). */
  recapMove(d) {
    const order = [1, 0, 2], i = order.indexOf(this.recapSel);
    this.recapSel = order[clamp(i + d, 0, 2)]; sfx.pick();
  }
  recapWatch() { this.recapReplay(this.recapSel + 1); }
  recapReplay(rank) {
    const e = this.recap?.top.entries.find((x) => x.rank === rank);
    if (e?.replay) this.openReplay(e, 'recap');
  }

  // ── powtórki biegów z rankingu ──
  async openReplay(entry, from) {
    if (this.replay) return;                               // już się wczytuje
    sfx.pick();
    const loading = { loading: true, from, entry };
    this.replay = loading;
    const r = await online.replay(entry.replay);
    if (this.replay !== loading) return;
    if (!r || r.simVersion !== SIM_VERSION) {
      this.replay = null;
      this.say(t(r ? 'replay.old' : 'replay.fail'), t(r ? 'replay.oldSub' : 'replay.failSub'), 'warn', 2.4);
      return;
    }
    const ci = CHARS.findIndex((c) => c.id === r.char), si = STYLES.findIndex((st) => st.id === r.style);
    // własna postać gracza z trójki: pobieramy jej paczkę (bez niej – pierwsza wbudowana)
    let kind = Math.max(0, ci);
    if (r.char === 'custom' && r.skin) {
      this.remoteSkin(r.skin);
      kind = (await this.remote.get(r.skin)?.wait) ?? kind;
      if (this.replay !== loading) return;
    }
    this.replay = { data: r, from, rank: entry.rank, name: r.nick ?? t('board.player', { tag: r.tag }), charIdx: kind, i: 0, playing: true, speed: 0, ended: false };
    if (si >= 0) applyStyle(si);                           // mapa, na której grał oglądany gracz
    this.state = 'replay';
    this.replayRestart(true);
  }
  /** Od początku biegu; play = od razu odtwarzaj (inaczej stoi – „stop”). */
  replayRestart(play) {
    const r = this.replay;
    this.reset(r.data.seed, DEFAULT_TUNE);                // serwer liczy każdy bieg z domyślnym strojeniem
    this.tier = r.rank <= 3 ? r.rank : null;
    r.i = 0; r.ended = false; r.playing = play;
    sfx.music.reset();
  }
  replayToggle() {
    const r = this.replay;
    if (!r?.data) return;
    sfx.pick();
    if (r.ended) this.replayRestart(true); else r.playing = !r.playing;
  }
  replayStop() { if (this.replay?.data) { sfx.pick(); this.replayRestart(false); } }
  replaySpeed(d) {
    const r = this.replay;
    if (!r?.data) return;
    r.speed = clamp(r.speed + d, 0, REPLAY_SPEEDS.length - 1); sfx.pick();
  }
  get replaySpeedX() { return REPLAY_SPEEDS[this.replay?.speed ?? 0]; }
  exitReplay() {
    const r = this.replay;
    this.replay = null;
    if (!r) return;
    sfx.pick();
    applyStyle(this.styleIdx);
    this.reset(); this.tier = null;
    this.state = r.from;
  }
  replayTick() {
    const r = this.replay, ticks = r.data.ticks;
    if (r.i >= ticks.length || this.sim.over) { this.replayEnd(); return; }
    this.advance(ticks[r.i++]);
  }
  replayEnd() {
    const r = this.replay;
    if (r.ended) return;
    r.ended = true; r.playing = false; this.msgs = [];
    sfx.over();
  }
  /**
   * Zaraz po uruchomieniu (main.js): gracz bez nicku dostaje okienko nicku od razu, a nie dopiero przed pierwszym biegiem.
   * Tylko gdy serwer rankingu odpowiada – bez sieci i tak nie da się zapisać nicku – i gdy gracz nie zaczął już czegoś innego.
   */
  promptNick() {
    if (this.state !== 'title' || !this.needsNick || !online.reachable || nickOpen() || creatorOpen() || roomOpen()) return;
    this.askNick(false);
  }
  /** Formularz nicku (wymagany); startAfter – po zapisaniu od razu bieg. Anuluj = zostajemy na ekranie tytułowym. */
  askNick(startAfter = true) {
    sfx.pick();
    openNick('', async (nick) => {
      const r = await online.setNick(nick);
      if (!r.ok && r.error === 'offline') { this.nickLater = true; return { ok: true }; }   // nie blokujemy gry bez sieci
      return r;
    }, (saved) => {
      this.board.at = {};
      // sam pad nie napisze nicku: B (anuluj) = gramy teraz bez nicku, a zapytamy przy następnym uruchomieniu
      if (!saved && this.hint === 'pad') this.nickLater = true;
      if (startAfter && (saved || this.nickLater) && this.state === 'title') this.start();
      else if (this.recapPending && this.state === 'title') this.openRecap();   // podsumowanie tygodnia czekało na okienko
      if (saved) { live.stop(); this.syncLive(); }
    }, { required: true, pad: this.hint === 'pad' });
  }
  editNick() {
    if (!online.enabled) return;
    sfx.pick();
    openNick(online.nick, (nick) => online.setNick(nick), (saved) => {
      this.board.at = {}; this.loadBoard();
      if (saved) { live.stop(); this.syncLive(); }         // znajomi zobaczą nowy nick po ponownym połączeniu
    });
  }

  // ── opcje ──
  /** page 'controls' = od razu wybór sterowania (z przełącznika na ekranie tytułowym; „Wróć” prowadzi wtedy do tytułu). */
  openSettings(page = 'main') {
    sfx.pick();
    this.state = 'settings';
    this.settings.from = page === 'main' ? 'title' : 'ctrl';
    this.showPage(page, page === 'controls' ? ctrl.mode : null);
  }
  /** Pokazuje stronę opcji; focus – klucz wiersza, który ma być zaznaczony. */
  showPage(page, focus = null) {
    const st = this.settings;
    st.page = page; st.note = ''; st.confirmT = 0; st.confirmK = null; st.capture = null; st.slot = 0;
    st.sel = Math.max(0, focus ? this.settingsSel.findIndex((it) => it.k === focus) : 0);
    st.scroll = st.scrollTo = 0;
    this.revealSel(true);
  }
  openPage(page) { sfx.pick(); this.showPage(page); }
  /** NOWOŚCI: lista zmian w każdej wersji (changelog.js) jako strona opcji tylko do przewijania. */
  openNews() { this.openText('news', buildNews); }
  /** ZASADY GRY: dokładny opis mechaniki (strings.js, klucze rules.*) – tak samo jak NOWOŚCI, tylko do przewijania. */
  openRules() { this.openText('rules', buildRules); }
  /** Strona z samym tekstem; build(g, measure) łamie linijki przy obecnym rozmiarze tekstu i języku. */
  openText(page, build) {
    const font = `${NOTE_FONT.weight} ${fontSize(NOTE_FONT.size)}px ${FONT}`;
    this.pages[page] = build(this, (s) => { ctx.font = font; return ctx.measureText(s).width; });
    sfx.pick();
    this.state = 'settings';
    this.settings.from = 'title';
    this.showPage(page);
  }
  /** PRZEŁADUJ na ekranie tytułowym: wczytuje nową wersję gry. */
  reloadGame() {
    if (!update.available) return;
    sfx.pick();
    reloadForUpdate();
  }
  /** Wiersze otwartej strony opcji i te z nich, które da się wybrać. */
  get settingsItems() { return this.pages[this.settings.page]; }
  get settingsSel() { return selectable(this.settingsItems); }
  get selItem() { return this.settingsSel[this.settings.sel] ?? null; }
  /** Wiersz czeka na drugie dotknięcie (usuwanie danych, przywracanie ustawień). */
  confirming(k) { return this.settings.confirmK === k && this.t < this.settings.confirmT; }
  /** ↑ ↓ w opcjach; jump – o kilka wierszy naraz (PageUp / PageDown, LB / RB) bez zawijania. */
  settingsMove(d, jump = false) {
    const st = this.settings, n = this.settingsSel.length;
    st.capture = null;
    if (isTextPage(st.page)) { this.settingsScroll(st.scrollTo + d * (jump ? LIST.h / 5 : 40)); return; }   // tu nie ma czego wybierać – tylko przewijanie
    const sel = jump ? clamp(st.sel + d, 0, n - 1) : mod(st.sel + d, n);
    if (sel === st.sel) return;
    st.sel = sel; st.slot = 0;
    sfx.pick(); this.revealSel();
  }
  /** ← → w opcjach: zmienia wartość wybranego wiersza (suwak, język, tryb…) albo pole przypisania. */
  settingsSide(d) {
    const it = this.selItem, st = this.settings;
    if (!it) return;
    if (it.type === 'slider') it.set(it.get() + d);
    else if (it.type === 'bind') { const s2 = clamp(st.slot + d, 0, it.slots - 1); if (s2 !== st.slot) { st.slot = s2; st.capture = null; sfx.pick(); } }
    else if (it.type === 'mode') {
      const m = CONTROLS[mod(CONTROLS.indexOf(ctrl.mode) + d, CONTROLS.length)];
      this.pickControl(m);
      st.sel = this.settingsSel.findIndex((x) => x.k === m); this.revealSel();
    } else if (it.side) it.side(d);
    else if (it.arrows) it.act();
  }
  /** ESC / B / „Wróć”: z przypisań do sterowania, ze sterowania do głównych opcji, z głównych – do tytułu. */
  settingsBack() {
    const st = this.settings;
    if (st.capture) { this.cancelCapture(); return; }
    if (st.page === 'keys' || st.page === 'pad') { sfx.pick(); this.showPage('controls', st.page); return; }
    if (st.page === 'controls' && st.from !== 'ctrl') { sfx.pick(); this.showPage('main', 'controls'); return; }
    if (st.page === 'access' || st.page === 'sound') { sfx.pick(); this.showPage('main', st.page); return; }
    this.toTitle();
  }
  pickControl(mode) {
    if (mode === ctrl.mode && (mode !== 'tilt' || tilt.active)) { sfx.pick(); return; }
    setControl(mode); this.savePrefs(); sfx.pick();
  }
  /** Enter / A / dotknięcie wybranego wiersza. */
  activate(i) {
    const st = this.settings, it = this.settingsSel[i];
    if (!it) return;
    st.sel = i;
    if (it.type === 'slider') it.set(it.get() >= (it.max ?? 8) ? 0 : it.get() + 1);
    else if (it.type === 'bind') this.startCapture(it, st.slot);
    else it.act?.();
  }
  toggleOnline() {
    sfx.pick();
    online.setEnabled(!online.enabled).then(() => { if (online.enabled) { online.refill(); online.flush(); } this.syncLive(); });
    this.board.at = {};
  }
  deleteData() {
    const st = this.settings;
    st.note = 'set.deleting';
    online.deleteData().then((ok) => {
      st.note = ok ? 'set.deleted' : 'set.deleteFail';   // klucz tekstu – tłumaczony przy rysowaniu
      this.board.at = {}; this.board.data = {}; this.board.scope = null;
      this.syncLive();
    });
  }

  // przewijanie listy: scroll – rysowane, scrollTo – cel (lista dojeżdża płynnie)
  settingsScroll(v, now = false) {
    const st = this.settings, max = Math.max(0, this.settingsItems.contentH - LIST.h);
    st.scrollTo = clamp(v, 0, max);
    if (now) st.scroll = st.scrollTo;
  }
  /** Przewija tak, żeby wybrany wiersz (z nagłówkiem grupy nad nim) był widoczny. */
  revealSel(now = false) {
    const it = this.selItem, st = this.settings, items = this.settingsItems;
    if (!it || it.type === 'back') return;
    const prev = items[items.indexOf(it) - 1], head = prev && (prev.type === 'head' || prev.type === 'info') ? prev : it;
    const top = head.y - 4, bottom = it.y + it.h + 4;
    let s2 = st.scrollTo;
    if (top < s2) s2 = top; else if (bottom > s2 + LIST.h) s2 = bottom - LIST.h;
    this.settingsScroll(s2, now);
  }

  // przypisywanie klawiszy i przycisków pada
  startCapture(it, slot) {
    const st = this.settings;
    sfx.pick();
    st.slot = slot;
    st.capture = { kind: it.kind, act: it.action, slot, armed: false, until: this.t + 8 };
    st.note = it.kind === 'key' ? 'bind.pressKey' : 'bind.pressPad';
  }
  cancelCapture() { const st = this.settings; if (!st.capture) return; st.capture = null; st.note = ''; sfx.pick(); }
  bindKey(code, name) {
    const c = this.settings.capture;
    if (c?.kind !== 'key') return;
    setBind('key', c.act, c.slot, code, name); this.finishCapture();
  }
  bindPad(i) {
    const c = this.settings.capture;
    if (c?.kind !== 'pad') return;
    setBind('pad', c.act, c.slot, i); this.finishCapture();
  }
  finishCapture() { const st = this.settings; st.capture = null; st.note = 'bind.saved'; this.savePrefs(); sfx.pick(); }
  /** Backspace / Delete / X na padzie: usuwa przypisanie z wybranego pola. */
  clearBind() {
    const it = this.selItem, st = this.settings;
    if (it?.type !== 'bind') return;
    setBind(it.kind, it.action, st.slot, null);
    st.capture = null; st.note = ''; this.savePrefs(); sfx.pick();
  }
  /** Linijka o padzie na stronie przypisań. */
  padInfo() {
    if (gpad.index < 0) return t('bind.noPad');
    const name = KIND_NAMES[gpad.kind] ?? t('pad.generic');
    return gpad.standard ? t('bind.padIs', { name }) : t('bind.padOdd', { name });
  }

  /** Dotknięcie / kliknięcie listy opcji. */
  settingsPointer(x, y) {
    const st = this.settings;
    if (inBox(x, y, LIST_BACK)) { this.settingsBack(); return; }
    if (!inBox(x, y, LIST)) return;
    const sel = this.settingsSel;
    for (const it of this.settingsItems) {
      if (it.type === 'back') continue;
      const r = rowBox(it, st.scroll);
      if (!inBox(x, y, r)) continue;
      const i = sel.indexOf(it);
      if (i < 0) return;                                 // nagłówek, objaśnienie
      if (i !== st.sel) { st.sel = i; st.slot = 0; st.capture = null; }
      if (it.type === 'slider') {
        const v = sliderValueAt(sliderBar(r, !!it.low), x);
        if (v != null) it.set(v); else sfx.pick();
      } else if (it.type === 'bind') {
        for (let j = 0; j < it.slots; j++) if (inBox(x, y, bindCell(r, j, it.slots))) { this.startCapture(it, j); return; }
        sfx.pick();
      } else if (it.type === 'row' && it.side && x >= r.x + r.w - ARROW_W - 8 && x < r.x + r.w - ARROW_W + 40) it.side(-1);
      else if (it.type === 'row' && it.side && x > r.x + r.w - 44) it.side(1);
      else it.act?.();
      return;
    }
  }
  pause() {
    if (this.state === 'play') this.state = 'pause';
    else if (this.state === 'replay' && this.replay) this.replay.playing = false;
  }
  togglePause() {
    if (this.state === 'replay') this.replayToggle();
    else if (this.state === 'play') this.state = 'pause';
    else if (this.state === 'pause') { this.state = 'play'; this.jumpLock = true; this.latch = false; }
  }

  pointer(x, y) {
    if (this.state === 'title') {
      if (y >= UIBOX.chars.y && y <= UIBOX.chars.y + UIBOX.chars.h) {
        for (let i = 0; i <= CUSTOM; i++) {
          if (Math.abs(x - charX(i)) > CHAR_W / 2 + 3) continue;
          // własna postać: puste miejsce albo drugie dotknięcie wybranej otwiera KREATOR
          if (i === CUSTOM && (!this.customId || this.charIdx === CUSTOM)) return this.openCreator();
          return this.pick('char', i, true);
        }
      }
      for (let i = 0; i < STYLES.length; i++) {
        if (Math.abs(x - slotX(i)) <= 34 && y >= UIBOX.maps.y - 4 && y <= UIBOX.maps.y + UIBOX.maps.h + 4) return this.pick('style', i, true);
      }
      if (this.roomPanelOn && !roomOpen()) {             // pokój znajomych: DOŁĄCZ / UTWÓRZ albo OPUŚĆ POKÓJ
        const P = this.roomPanel();
        if (P.join && inBox(x, y, P.join)) return this.openRoomForm('join');
        if (P.create && inBox(x, y, P.create)) return this.openRoomForm('create');
        if (P.leave && inBox(x, y, P.leave)) return this.leaveRoom();
      }
      if (inBox(x, y, UIBOX.play)) this.start();
      else if (inBox(x, y, UIBOX.rank)) this.openBoard();
      else if (inBox(x, y, UIBOX.opts)) this.openSettings();
      else if (inBox(x, y, UIBOX.news)) this.openNews();
      else if (inBox(x, y, UIBOX.rules)) this.openRules();
      else if (inBox(x, y, UIBOX.creator)) this.openCreator();
      else if (update.available && inBox(x, y, UIBOX.update)) this.reloadGame();
      else if ((isTouch || ctrl.mode !== 'buttons') && inBox(x, y, UIBOX.ctrl)) this.openSettings('controls');
    } else if (this.state === 'board') {
      if (roomOpen()) return;                              // okienko pokoju na wierzchu
      const S = UIBOX.scope;                             // WSZYSCY / POKÓJ: górna i dolna połowa przełącznika
      if (inBox(x, y, S)) return this.boardScopeSet(y < S.y + S.h / 2 ? 'world' : 'room');
      for (let i = 0; i < PERIODS.length; i++) if (inBox(x, y, UIBOX.tab(i))) return this.boardTab(i, true);
      const top = this.boardData?.top?.entries ?? [];
      for (let i = 0; i < 3; i++) if (top[i]?.skin && inBox(x, y, UIBOX.boardChar(i))) return this.loadBoardChar(top[i]);   // „⬇ POSTAĆ”
      for (let i = 0; i < 3; i++) if (inBox(x, y, UIBOX.boardRow(i))) return this.boardReplay(i + 1);
      if (inBox(x, y, UIBOX.nick)) this.editNick();
      else if (inBox(x, y, UIBOX.back)) { sfx.pick(); this.toTitle(); }
    } else if (this.state === 'recap') {
      for (let i = 0; i < 3; i++) {
        const b = UIBOX.podWatch(i), top = UIBOX.podBase - UIBOX.podH[i] - 80;   // przycisk albo sama postać na podium
        if (inBox(x, y, b) || inBox(x, y, { x: b.x, y: top, w: b.w, h: b.y - top })) return this.recapReplay(i + 1);
      }
      if (inBox(x, y, UIBOX.recapBoard)) this.recapBoard();
      else if (inBox(x, y, UIBOX.recapNext)) this.closeRecap();
    } else if (this.state === 'replay') {
      const r = this.replay;
      if (!r?.data) return;
      if (r.ended) {
        if (inBox(x, y, UIBOX.rAgain)) this.replayToggle();
        else if (inBox(x, y, UIBOX.rBack)) this.exitReplay();
        return;
      }
      if (inBox(x, y, UIBOX.rPlay)) this.replayToggle();
      else if (inBox(x, y, UIBOX.rStop)) this.replayStop();
      else if (inBox(x, y, UIBOX.rSpeed)) this.replaySpeed(r.speed >= REPLAY_SPEEDS.length - 1 ? -r.speed : 1);
      else if (inBox(x, y, UIBOX.rExit)) this.exitReplay();
      else if (y > 40 && y < 420 && x > LEFT && x < RIGHT) this.replayToggle();   // dotknięcie planszy: start / pauza
    } else if (this.state === 'settings') {
      this.settingsPointer(x, y);
    } else if (this.state === 'pause') {
      if (inBox(x, y, UIBOX.pmenu)) { sfx.pick(); this.toTitle(); } else this.togglePause();
    } else if (this.state === 'over' && this.overT > 0.6) {
      if (inBox(x, y, UIBOX.menu)) this.toTitle(); else this.start();
    }
  }

  /** OPCJE → Przywróć domyślne ustawienia: sterowanie, dostępność, dźwięk, wibracje, ręka, bateria. Język, postać, mapa i ranking zostają. */
  resetSettings() {
    Object.assign(opts, OPTS_DEFAULT); tilt.sens = SENS_MAX / 2; tilt.zero = 0;
    resetPads(); resetBinds('key'); resetBinds('pad'); setControl('buttons');
    loadAccess(null);
    sfx.muted = false; sfx.fxVol = sfx.musicVol = VOL_STEPS; sfx.applyVolume();
    haptics.level = 2; this.setLefty(false); setPowerMode('auto'); this.feedOn = true;
    this.settings.note = 'set.resetAllDone';
    this.savePrefs(); sfx.pick();
  }
  /** Klawisz I: stan biegu dla czytnika ekranu. */
  speakStatus() { speakStatus(this); }
  say(title, sub = '', color = 'gold', dur = 1.6) {
    this.msgs.push({ title, sub, color, dur, t: 0 }); if (this.msgs.length > 3) this.msgs.shift();
    announce(sub ? `${title} ${sub}` : title);           // czytnik ekranu: te same komunikaty słowami
  }

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
      this.net = { status: 'unranked', reason: !ticks ? 'tuned' : !online.enabled ? 'off' : online.outdated ? 'outdated' : online.serverBehind ? 'server' : 'offline' };
      return;
    }
    this.net = { status: 'sending', runId: ticket.runId };
    // statystyka serwera: dawne „touch” to dzisiejsze przyciski ekranowe
    const control = tilt.active ? 'tilt' : ctrl.mode === 'one' ? 'one' : this.hint === 'pad' ? 'pad' : !isTouch ? 'keys' : ctrl.mode === 'buttons' ? 'touch' : ctrl.mode;
    const custom = this.charIdx === CUSTOM;
    online.submit({
      ticket, ticks: ticks.slice(), score: this.score, char: custom ? 'custom' : CHARS[this.charIdx].id, style: STYLES[this.styleIdx].id, control,
      ...(custom && this.customHash ? { skin: this.customHash } : {}),
    })
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
        this.liveFloor();
        if (narrowLevel(e.floor) > this.narrow) {      // nowa setka pięter: od teraz piętra są węższe
          this.narrow = narrowLevel(e.floor);
          this.say(t('msg.narrow'), t(this.narrow >= NARROW_MAX ? 'msg.narrowMax' : 'msg.narrowSub'), 'warn', 1.8);
        }
        break;
      case 'bounce':
        sfx.bounce();
        this.puff(e.left ? LEFT : RIGHT, h.y - 24, 7, { color: this.dustColor(Math.max(0, h.from)), sx: 60, sy: 140, up: 0, life: 0.35, size: 2.5 });
        if (this.tier) this.wallDust(e.left, 14, 10);
        break;
      case 'combo': {
        const ti = TIERS.findIndex((min) => e.floors >= min);
        const label = ti >= 0 ? t(`tier.${TIERS[ti]}`) : t('msg.combo');
        this.say(label, t('msg.comboSub', { floors: e.floors, points: e.points }), 'gold', 1.8);
        if (this.ticket && e.floors >= LIVE_COMBO) live.event('combo', e.floors);   // duże combo – znajomi z pokoju też się dowiedzą
        sfx.combo(TIERS.length - 1 - ti);
        this.buzz(30);
        break;
      }
      case 'boost': {                    // booster to piwo, od VODKA_FROM piętra wódka (drinks.js) – teksty coraz bardziej zatroskane
        const kind = drinkAt(e.floor), m = drinkSay(kind, ++this.drinks[kind]);
        this.say(m.title, m.sub, 'gold', 2.2);
        this.shake = 0.35; sfx.boost(); this.buzz(80);
        this.puff(h.x, h.y - 20, 18, { color: kind === 'beer' ? '#ffc02e' : '#e6f6ff', sx: 160, sy: 120, up: 0, life: 0.5, size: 4, g: 200, star: true });
        break;
      }
      case 'boostEnd':
        sfx.boostEnd();
        break;
      case 'slow':
        this.say(t('msg.slow'), t('msg.slowSub', { s: SLOW_TIME }), 'mint', 1.8);
        sfx.slow(); this.buzz(50);
        this.puff(h.x, h.y - 24, 14, { color: '#7ec8ff', sx: 120, sy: 120, up: 20, life: 0.6, size: 3.5, g: 60, star: true });
        break;
      case 'slowEnd':
        sfx.slowEnd();
        break;
      case 'hurry':
        this.say(t('msg.hurry'), '', 'warn', 1.5);
        this.msgs[this.msgs.length - 1].hurry = true;
        this.shake = 0.6; sfx.hurry(); this.buzz(60);
        break;
      case 'over':
        if (this.state === 'replay') this.replayEnd(); else this.gameOver();
        break;
    }
  }
  /** Wibracje tylko we własnej grze – nie w oglądanej powtórce. */
  buzz(ms) { if (this.state === 'play') haptics.buzz(ms); }

  // ── efekty nagrody najlepszej trójki ──
  /** Złoty (srebrny, brązowy) pył z iskrami tam, gdzie bohater ociera się o ścianę. n – drobinki pyłu, k – iskry. */
  wallDust(left, n, k) {
    const m = MEDALS[this.tier], h = this.sim.hero, x = left ? LEFT : RIGHT, out = left ? 1 : -1;
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: x + out * rand(0, 4), y: h.y - rand(6, 50), vx: out * rand(10, 70), vy: rand(-50, 30) + h.vy * 0.15,
        life: rand(0.55, 1.05), max: 1.05, size: rand(1.8, 3.6), color: m.dust[Math.floor(Math.random() * m.dust.length)], g: 50, star: Math.random() < 0.35, rot: rand(0, 7),
      });
    }
    for (let i = 0; i < k; i++) {
      const sp = rand(160, 380), a = rand(-1.1, 1.1);
      this.parts.push({
        x, y: h.y - rand(10, 46), vx: out * Math.cos(a) * sp, vy: Math.sin(a) * sp - h.vy * 0.25,
        life: rand(0.2, 0.38), max: 0.38, size: rand(1.6, 2.6), color: Math.random() < 0.5 ? m.spark : m.mid, g: 700, spark: true, rot: 0,
      });
    }
  }
  /** Co krok: czy bohater ociera się o ścianę (stoi przy niej i się porusza). */
  rubWalls(dt) {
    const h = this.sim.hero, left = h.x - HW <= LEFT + 0.01, right = h.x + HW >= RIGHT - 0.01;
    this.rubT -= dt;
    if ((!left && !right) || this.rubT > 0) return;
    const sp = Math.hypot(h.vx, h.vy);
    if (sp < 40) return;
    this.rubT = clamp(0.06 - sp / 25_000, 0.016, 0.06);
    this.wallDust(left, sp > 400 ? 5 : 3, Math.random() < 0.4 ? 1 : 2);
  }

  // ── jeden krok fizyki + efekty, które idą z nim w parze ──
  tick() {
    // wejście: po starcie i po pauzie skok działa dopiero po puszczeniu przycisku
    const raw = input.jump;
    if (this.jumpLock && !raw) this.jumpLock = false;
    const press = raw && !this.jumpPrev && !this.jumpLock;
    this.jumpPrev = raw;
    // skok: przytrzymanie (trzymany = skok przy każdym lądowaniu), przełącznik (wciśnięcie włącza / wyłącza) albo automat
    let wantJump;
    if (opts.jump === 'auto') wantJump = true;
    else if (opts.jump === 'toggle') { if (press) this.latch = !this.latch; wantJump = this.latch; }
    else wantJump = raw && !this.jumpLock;
    // klawisze/przyciski/połówki ekranu dają pełne ±1; przechył i gałki – wartość płynną, czyli słabsze lub mocniejsze przyspieszenie
    let axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (!axis) axis = input.padAxis || touchAxis();
    if (ctrl.mode === 'one') axis = this.autoRun(axis);
    // symulacja dostaje dokładnie to, co trafia do zapisu biegu
    const packed = packInput(axis * AXIS_MAX, wantJump);
    this.rec.push(packed);
    this.advance(packed);
  }

  /**
   * Tryb jednego przycisku: bohater biegnie sam i zawraca przy ścianie. Strzałka (gałka) przejmuje bieg na chwilę
   * i ustawia kierunek, w którym bohater pobiegnie dalej. Wynik to zwykła oś – trafia do zapisu jak każde inne sterowanie.
   */
  autoRun(axis) {
    if (axis) { this.autoDir = Math.sign(axis); return axis; }
    const h = this.sim.hero;
    if (h.x - HW <= LEFT + 0.5) this.autoDir = 1;
    else if (h.x + HW >= RIGHT - 0.5) this.autoDir = -1;
    return this.autoDir;
  }

  /** Krok symulacji z podanym wejściem (z gracza albo z zapisu powtórki) i efekty, które idą z nim w parze. */
  advance(packed) {
    const s = this.sim, h = s.hero, fx = this.fx, dt = STEP;
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
    } else if (h.onFloor < 0 && h.spin && !reduceMotion) {   // gwiazdki za obracającym się bohaterem – bez nich przy ograniczeniu ruchu
      fx.angle += dt * 15;
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.03;
        const cols = style.world === 'sketch' ? PENCILS : ['#ffe066', '#7ef0e0', '#ff9ecb', '#ffffff'];
        this.puff(h.x, h.y - 24, 1, { color: cols[Math.floor(Math.random() * cols.length)], sx: 40, sy: 40, up: 0, life: 0.5, size: 5, g: 120, star: true });
      }
    }
    fx.squash += (0 - fx.squash) * Math.min(1, 12 * dt);
    if (this.tier) this.rubWalls(dt);

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.rot += dt * 6;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
  }

  frame(dt) {
    this.t += dt;
    this.liveStatus();
    const edge = input.takeEdge();
    const camBefore = this.sim.camY;
    if (this.state === 'title') { if (edge) this.start(); }
    else if (this.state === 'pause') { if (edge) this.togglePause(); }
    else if (this.state === 'over') { this.overT += dt; if (edge && this.overT > 0.6) this.start(); }
    else if (this.state === 'board') { if (edge) this.boardConfirm(); }
    else if (this.state === 'settings') {
      const st = this.settings;
      if (edge) this.activate(st.sel);
      if (st.capture && this.t > st.capture.until) { st.capture = null; st.note = ''; }   // nikt nic nie nacisnął
      st.scroll += (st.scrollTo - st.scroll) * Math.min(1, dt * 14);
      if (Math.abs(st.scrollTo - st.scroll) < 0.3) st.scroll = st.scrollTo;
    }
    else if (this.state === 'recap') { if (edge) this.closeRecap(); }
    else if (this.state === 'replay') {
      const r = this.replay;
      if (edge) this.replayToggle();
      if (r?.playing) {
        this.acc += dt * this.replaySpeedX;
        while (this.acc >= STEP && r.playing) { this.replayTick(); this.acc -= STEP; }
      }
    } else {
      this.acc += dt;
      while (this.acc >= STEP && this.state === 'play') { this.tick(); this.acc -= STEP; }
    }
    // efekty niezależne od fizyki
    if (this.feed.length && (this.feed[0].t += dt) >= this.feed[0].dur) this.feed.shift();   // komunikaty znajomych po kolei
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
    const playing = this.state === 'play' || (this.state === 'replay' && this.replay?.playing);
    sfx.song(playing ? this.musicParams() : null, dt);
    if (document.body.dataset.state !== this.state) this.showState();
    render(this);
    speakFrame(this);                    // czytnik ekranu: opis ekranu i zmian (speech.js)
  }

  /** Stan gry na <body>: CSS pokazuje przycisk pauzy tylko w biegu i w pauzie (wtedy z ikoną „graj”). */
  showState() {
    document.body.dataset.state = this.state;
    keepAwake(this.state === 'play' || this.state === 'replay');   // ekran nie gaśnie w trakcie biegu i powtórki (wake.js)
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

