// Klient rankingu (src/net/online.ts) przeciw prawdziwemu serwerowi z lokalną bazą D1.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { MemoryStore, Online, TICKET_RESERVE } from '../../src/net/online';
import type { Ticket } from '../../src/net/online';
import { SIM_VERSION } from '../../src/sim';
import { sha256hex } from '../../server/src/auth';
import { idleThen, momentumPilot } from '../helpers';
import { playRun, startServer } from '../server/harness';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => { srv = await startServer(); }, 60_000);
afterAll(async () => { await srv?.dispose(); });
beforeEach(async () => { await srv.reset(); net.down = false; net.failAfter = Infinity; net.calls = 0; });

const BASE = 'https://api.test';
/** Sieć pod kontrolą testu: można ją wyłączyć albo zerwać po n zapytaniach. */
const net = { down: false, failAfter: Infinity, calls: 0 };
const fetchShim: typeof fetch = async (input, init) => {
  net.calls++;
  if (net.down || net.calls > net.failAfter) throw new TypeError('Failed to fetch');
  return srv.app.request(String(input), init as RequestInit, srv.env);
};
const rows = async (sql: string) => (await srv.db.prepare(sql).all()).results as any[];

function client(store = new MemoryStore()) {
  return new Online({ baseUrl: BASE, fetch: fetchShim, store, platform: 'web', appVersion: 'test', now: () => srv.clock.now });
}

/** Rozgrywa bieg na wieży z biletu i przesuwa zegar serwera o czas gry. */
function play(ticket: Ticket, pilotSeed = 1, idle = 0) {
  const run = playRun(ticket.seed, idleThen(idle, momentumPilot(pilotSeed)));
  srv.clock.now += Math.ceil(run.ticks.length * 1000 / 120) + 1000;
  return { ticket, ticks: run.ticks, score: run.score, char: 'fox', style: 'ice', control: 'keys' };
}

async function ready() {
  const o = client();
  await o.init();
  await o.refill();
  return o;
}

describe('konto i bilety', () => {
  test('pierwsze połączenie zakłada konto i odkłada zapas biletów', async () => {
    const o = await ready();
    expect(o.tickets).toBe(TICKET_RESERVE);
    expect(await rows('SELECT id FROM players')).toHaveLength(1);
  });

  test('konto i bilety przeżywają ponowne uruchomienie', async () => {
    const store = new MemoryStore();
    const a = client(store); await a.init(); await a.refill();
    const b = client(store); await b.init();
    expect(b.tickets).toBe(TICKET_RESERVE);
    await b.refill();
    expect(await rows('SELECT id FROM players')).toHaveLength(1);
    expect(await rows("SELECT id FROM runs WHERE status = 'issued'")).toHaveLength(TICKET_RESERVE);
  });

  test('przed wczytaniem pamięci klient nic nie wysyła (żeby nie założyć drugiego konta)', async () => {
    const store = new MemoryStore();
    const a = client(store); await a.init(); await a.refill();
    const b = client(store);
    expect(b.takeTicket()).toBeNull();
    await b.refill(); await b.flush();
    expect(await b.setNick('Ktoś')).toEqual({ ok: false, error: 'offline' });
    await b.init();
    expect(b.takeTicket()).not.toBeNull();
    expect(await rows('SELECT id FROM players')).toHaveLength(1);
  });

  test('wzięcie biletu jest natychmiastowe, a zapas uzupełnia się w tle', async () => {
    const o = await ready();
    const t = o.takeTicket();
    expect(t).toMatchObject({ simVersion: SIM_VERSION });
    expect(o.tickets).toBe(TICKET_RESERVE - 1);
    await o.refill();
    expect(o.tickets).toBe(TICKET_RESERVE);
  });

  test('bez sieci nie ma biletów, ale gra działa dalej (bieg poza rankingiem)', async () => {
    net.down = true;
    const o = client(); await o.init(); await o.refill();
    expect(o.takeTicket()).toBeNull();
  });

  test('przeterminowane bilety i bilety innej wersji symulacji są wyrzucane', async () => {
    const store = new MemoryStore();
    const old = client(store); await old.init(); await old.refill();
    srv.clock.now += 6 * 24 * 3_600_000 + 1;
    const later = client(store); await later.init();
    expect(later.tickets).toBe(0);
    await store.set('sj.tickets', JSON.stringify([{ runId: 'x', seed: 1, simVersion: SIM_VERSION + 1, issuedAt: srv.clock.now }]));
    const other = client(store); await other.init();
    expect(other.tickets).toBe(0);
  });

  test('stara wersja gry: komunikat o aktualizacji zamiast biletów', async () => {
    const o = await ready();
    await srv.db.prepare("DELETE FROM runs").run();
    (o as any).simVersion = SIM_VERSION - 1;   // udajemy starą aplikację
    while (o.takeTicket());
    await o.refill();
    expect(o.outdated).toBe(true);
    expect(o.tickets).toBe(0);
  });

  test('serwer jeszcze na starszej wersji: gra się nie blokuje i bierze bilety, gdy serwer się zaktualizuje', async () => {
    const o = await ready();
    while (o.takeTicket());
    (o as any).simVersion = SIM_VERSION + 1;   // gra wdrożona przed serwerem
    await o.refill();
    expect(o.serverBehind).toBe(true);
    expect(o.outdated).toBe(false);
    expect(o.tickets).toBe(0);
    (o as any).simVersion = SIM_VERSION;       // serwer dogonił grę
    expect(o.takeTicket()).toBeNull();
    await o.refill();
    expect(o.serverBehind).toBe(false);
    expect(o.tickets).toBe(TICKET_RESERVE);
  });

  test('konto usunięte na serwerze: klient zakłada nowe', async () => {
    const o = await ready();
    await srv.db.prepare('DELETE FROM players').run();
    while (o.takeTicket());
    await o.refill();
    expect(o.tickets).toBe(TICKET_RESERVE);
    expect(await rows('SELECT id FROM players')).toHaveLength(1);
  });

  test('ranking wyłączony: zero zapytań i brak biletów', async () => {
    const o = client(); await o.init();
    await o.setEnabled(false);
    await o.refill();
    expect(o.takeTicket()).toBeNull();
    expect(net.calls).toBe(0);
  });
});

describe('wysyłka biegów', () => {
  test('uczciwy bieg zostaje zweryfikowany i daje miejsca w rankingach', async () => {
    const o = await ready();
    const r = await o.submit(play(o.takeTicket()!));
    expect(r).toMatchObject({ status: 'verified', ranks: { all: 1, week: 1, day: 1 } });
    expect(o.pending).toBe(0);
  });

  test('długi bieg idzie w wielu porcjach', async () => {
    const o = await ready();
    const run = play(o.takeTicket()!, 2, 5000);
    expect((await o.submit(run)).status).toBe('verified');
  });

  test('bez sieci bieg czeka w kolejce i wychodzi, gdy sieć wróci', async () => {
    const store = new MemoryStore();
    const o = client(store); await o.init(); await o.refill();
    const run = play(o.takeTicket()!);
    net.down = true;
    expect(await o.submit(run)).toEqual({ status: 'queued' });
    expect(o.pending).toBe(1);
    net.down = false;
    const restarted = client(store); await restarted.init();
    expect(restarted.pending).toBe(1);
    await restarted.flush();
    expect(restarted.pending).toBe(0);
    expect((await rows("SELECT status FROM runs WHERE status = 'verified'"))).toHaveLength(1);
  });

  test('zerwana w połowie wysyłka jest wznawiana od miejsca, w którym stanęła', async () => {
    const o = await ready();
    const run = play(o.takeTicket()!, 2, 5000);
    net.calls = 0; net.failAfter = 2;            // dwie porcje dochodzą, potem sieć pada
    expect((await o.submit(run)).status).toBe('queued');
    net.failAfter = Infinity;
    await o.flush();
    expect(o.pending).toBe(0);
    expect((await rows("SELECT status FROM runs WHERE status = 'verified'"))).toHaveLength(1);
  });

  test('odrzucony bieg nie wraca do kolejki', async () => {
    const o = await ready();
    const run = play(o.takeTicket()!);
    const r = await o.submit({ ...run, score: run.score + 500 });
    expect(r).toEqual({ status: 'rejected', reason: 'score_mismatch' });
    expect(o.pending).toBe(0);
  });

  test('ostatni wynik: lista zmian w rankingach po wysłaniu kolejki', async () => {
    const o = await ready();
    const results: string[] = [];
    o.onResult = (r) => results.push(r.status);
    net.down = true;
    await o.submit(play(o.takeTicket()!));
    net.down = false;
    await o.flush();
    expect(results).toEqual(['verified']);
  });
});

describe('rankingi, nick i dane', () => {
  test('top i moje miejsce', async () => {
    const o = await ready();
    await o.setNick('Skoczek');
    const r = await o.submit(play(o.takeTicket()!));
    expect(r.status).toBe('verified');
    const top = await o.leaderboard('day');
    expect(top!.entries[0]).toMatchObject({ rank: 1, nick: 'Skoczek' });
    const me = await o.around('day');
    expect(me).toMatchObject({ rank: 1 });
    expect(me!.entries.find((e) => e.me)?.nick).toBe('Skoczek');
  });

  test('bez sieci ranking zwraca null', async () => {
    const o = await ready();
    net.down = true;
    expect(await o.leaderboard('all')).toBeNull();
  });

  test('nick: zapis, błędy walidacji i zajęty nick', async () => {
    const a = await ready(), b = await ready();
    expect(await a.setNick('Żółw')).toEqual({ ok: true });
    expect(a.nick).toBe('Żółw');
    expect(await b.setNick('żółw')).toEqual({ ok: false, error: 'nick_taken' });
    expect(await b.setNick('x')).toEqual({ ok: false, error: 'nick_length' });
    net.down = true;
    expect(await b.setNick('Bocian')).toEqual({ ok: false, error: 'offline' });
  });

  test('usunięcie danych czyści serwer i urządzenie', async () => {
    const store = new MemoryStore();
    const o = client(store); await o.init(); await o.refill();
    await o.submit(play(o.takeTicket()!));
    expect(await o.deleteData()).toBe(true);
    for (const t of ['players', 'runs', 'bests']) expect(await rows(`SELECT * FROM ${t}`)).toEqual([]);
    expect(o.tickets).toBe(0);
    expect(o.nick).toBeNull();
    expect(await store.get('sj.account')).toBeNull();
  });

  test('usunięcie danych bez sieci się nie udaje i niczego nie kasuje lokalnie', async () => {
    const o = await ready();
    net.down = true;
    expect(await o.deleteData()).toBe(false);
    expect(o.tickets).toBe(TICKET_RESERVE);
  });
});

describe('korony i powtórki', () => {
  const DAY = 86_400_000;

  test('miejsce w najlepszej trójce zeszłego tygodnia daje koronę na cały następny tydzień – także bez sieci', async () => {
    const store = new MemoryStore();
    const o = client(store); await o.init(); await o.refill();
    expect((await o.submit(play(o.takeTicket()!))).status).toBe('verified');
    expect(o.crown).toBeNull();
    srv.clock.now += 7 * DAY;
    const lw = await o.lastWeek();
    expect(lw?.top.entries.length).toBe(1);
    expect(lw?.me?.rank).toBe(1);
    expect(o.crown).toBe(1);
    // po ponownym uruchomieniu korona jest od razu, bez pytania serwera
    net.down = true;
    const again = client(store); await again.init();
    expect(again.crown).toBe(1);
    // tydzień później korona wygasa
    srv.clock.now += 7 * DAY;
    expect(again.crown).toBeNull();
  });

  test('powtórka z rankingu odtwarza ten sam bieg', async () => {
    const o = await ready();
    const run = play(o.takeTicket()!);
    await o.submit(run);
    const top = await o.leaderboard('week', 10);
    const id = top!.entries[0].replay!;
    const r = await o.replay(id);
    expect(r).toMatchObject({ seed: run.ticket.seed, score: run.score, char: 'fox', style: 'ice', simVersion: SIM_VERSION });
    expect(r!.ticks).toEqual(run.ticks);
    expect(await o.replay('nie-ma')).toBeNull();
    net.down = true;
    expect(await o.replay(id)).toBeNull();
  });
});

describe('własne postacie w najlepszej trójce', () => {
  const pack = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 7, 7, 7]);

  test('bieg w trójce: klient dosyła paczkę postaci, a każdy może ją pobrać', async () => {
    const hash = await sha256hex(pack);
    const o = await ready();
    const asked: string[] = [];
    o.skinSource = async (h) => { asked.push(h); return h === hash ? pack : null; };
    const r = await o.submit({ ...play(o.takeTicket()!), char: 'custom', skin: hash });
    expect(r).toMatchObject({ status: 'verified', needSkin: true });
    expect(asked).toEqual([hash]);
    expect((await rows('SELECT hash FROM skins')).map((x) => x.hash)).toEqual([hash]);
    const board = await o.leaderboard('week');
    expect(board!.entries[0]).toMatchObject({ char: 'custom', skin: hash });
    expect(await client().skinPack(hash)).toEqual(pack);
    expect(await client().skinPack('0'.repeat(64))).toBeNull();
    expect((await o.replay(board!.entries[0].replay!))!.skin).toBe(hash);
  });

  test('bez sieci przy wysyłce paczki – klient wyśle ją przy następnej okazji', async () => {
    const hash = await sha256hex(pack);
    const store = new MemoryStore();
    const o = client(store); await o.init(); await o.refill();
    o.skinSource = async () => { net.down = true; return pack; };   // bieg zatwierdzony, a sieć pada tuż przed wysłaniem paczki
    expect((await o.submit({ ...play(o.takeTicket()!), char: 'custom', skin: hash })).status).toBe('verified');
    expect(await rows('SELECT hash FROM skins')).toEqual([]);
    net.down = false;
    const again = client(store); await again.init();     // także po ponownym uruchomieniu gry
    again.skinSource = async () => pack;
    await again.flush();
    expect((await rows('SELECT hash FROM skins')).map((x) => x.hash)).toEqual([hash]);
  });
});

describe('pokoje znajomych', () => {
  test('założenie, dołączenie, ranking pokoju i wyjście', async () => {
    const store = new MemoryStore();
    const a = client(store); await a.init(); await a.refill();
    const b = await ready();
    expect(await a.createRoom('Ekipa', 'tajne123')).toEqual({ ok: false, error: 'nick_required' });   // najpierw nick
    await a.setNick('Ala'); await b.setNick('Bartek');
    expect(await a.createRoom('Ekipa', 'tajne123')).toEqual({ ok: true, room: { name: 'Ekipa' } });
    expect(a.room).toEqual({ name: 'Ekipa' });
    expect(await b.joinRoom('ekipa', 'zle')).toEqual({ ok: false, error: 'room_password' });
    expect(b.room).toBeNull();
    expect(await b.joinRoom('ekipa', 'tajne123')).toMatchObject({ ok: true });
    expect((await b.roomInfo())!.members).toHaveLength(2);

    await a.submit(play(a.takeTicket()!, 1));
    const rb = await b.roomBoard('week');
    expect(rb!.top.entries).toHaveLength(1);
    expect(rb!.me).toMatchObject({ rank: null, entries: [] });
    expect((await a.roomBoard('week'))!.me.rank).toBe(1);

    const again = client(store); await again.init();      // pokój pamiętany po ponownym uruchomieniu
    expect(again.room).toEqual({ name: 'Ekipa' });

    expect(await a.leaveRoom()).toBe(true);
    expect(a.room).toBeNull();
    expect(await a.roomBoard('week')).toBeNull();
  });

  test('pokój usunięty po stronie serwera – klient go zapomina; bez sieci zostaje', async () => {
    const a = await ready(), b = await ready();
    await a.setNick('Ala'); await b.setNick('Bartek');
    await a.createRoom('Ekipa', 'tajne123');
    await b.joinRoom('Ekipa', 'tajne123');
    net.down = true;
    expect(await b.roomBoard('day')).toBeNull();
    expect(await b.leaveRoom()).toBe(false);
    expect(b.room).toEqual({ name: 'Ekipa' });
    net.down = false;
    await srv.db.prepare('UPDATE players SET room_id = NULL').run();
    expect(await b.roomBoard('day')).toBeNull();
    expect(b.room).toBeNull();
  });

  test('usunięcie danych zapomina pokój', async () => {
    const a = await ready();
    await a.setNick('Ala');
    await a.createRoom('Ekipa', 'tajne123');
    expect(await a.deleteData()).toBe(true);
    expect(a.room).toBeNull();
  });

  test('reachable: czy serwer odpowiada (gra pyta o nick od razu tylko wtedy)', async () => {
    const o = client(); await o.init();
    expect(o.reachable).toBe(false);
    await o.refill();
    expect(o.reachable).toBe(true);
    net.down = true;
    await o.leaderboard('week');
    expect(o.reachable).toBe(false);
  });
});
