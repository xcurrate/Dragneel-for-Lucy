const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'src/services/battleEngine'));
const { createRng } = require(path.join(ROOT, 'src/services/battleRng'));

const COEFFS = { hp: 8, att: 6, pr: 2, wp: 3, mag: 5, mr: 1 };
const TOKEN = 't'.repeat(32);

function playerTeam() {
  return [
    { slot: 1, label: 'tank', level: 50, coeffs: COEFFS, weapon: { id: 5, quality: 100, passives: [24] } },
    { slot: 2, label: 'crune', level: 50, coeffs: COEFFS, weapon: { id: 18, quality: 100, passives: [5, 16] } },
  ];
}

function enemyTeam() {
  return [{ slot: 1, label: 'lawan', level: 50, coeffs: COEFFS }];
}

function run(log) {
  return engine.runBattle(playerTeam(), enemyTeam(), { rng: createRng(7), seed: 7, log });
}

describe('battle log recorder', () => {
  it('does not record anything unless asked', () => {
    const battle = run(false);
    assert.strictEqual(battle.log, undefined);
    assert.ok(battle.turns > 0);
  });

  it('records units, turns, and events', () => {
    const battle = run(true);
    const log = battle.log;
    assert.strictEqual(log.version, 2);
    assert.strictEqual(log.seed, 7);
    assert.strictEqual(log.winner, battle.winner);
    assert.strictEqual(log.turns, battle.turns);
    assert.strictEqual(log.units.length, 3);
    assert.ok(log.events.length > 0);
    assert.strictEqual(log.dropped, 0);

    // Setiap event menunjuk unit yang ada di daftar `units`.
    const refs = new Set(log.units.map(u => u.ref));
    for (const event of log.events) {
      assert.ok(event.t >= 1 && event.t <= log.turns);
      for (const key of ['a', 'r', 's']) {
        if (event[key] != null) assert.ok(refs.has(event[key]), `ref ${event[key]} tidak dikenal`);
      }
    }
  });

  it('records a full state snapshot for every action', () => {
    const log = run(true).log;
    assert.ok(Array.isArray(log.actions) && log.actions.length > 0);
    assert.strictEqual(log.droppedActions, 0);

    // Setiap aksi menunjuk rentang event yang sah dan tidak tumpang tindih.
    let previousTo = 0;
    for (const action of log.actions) {
      assert.ok(action.from >= previousTo, 'rentang event aksi harus maju');
      assert.ok(action.to >= action.from);
      assert.ok(action.to <= log.events.length);
      previousTo = action.to;

      // Snapshot harus mencakup SEMUA unit, bukan hanya yang terlibat.
      assert.strictEqual(action.s.length, log.units.length);
      for (const snap of action.s) {
        assert.ok(Number.isInteger(snap.hp) && snap.hp >= 0);
        assert.ok(Number.isInteger(snap.wp) && snap.wp >= 0);
        assert.ok(Array.isArray(snap.b));
      }
    }

    // Snapshot terakhir harus sama dengan HP akhir yang dilaporkan `units`.
    const last = log.actions[log.actions.length - 1].s;
    log.units.forEach((unit, i) => assert.strictEqual(last[i].hp, unit.hp, `HP akhir ${unit.name}`));
  });

  it('covers every event with an action, including deaths', () => {
    const log = run(true).log;
    const last = log.actions[log.actions.length - 1];
    // Tidak boleh ada event yatim: kalau ada, baris itu tidak akan pernah
    // tersorot saat memutar log.
    assert.strictEqual(last.to, log.events.length);

    const deathEvents = log.events.filter(e => e.k === 'death');
    assert.ok(deathEvents.length > 0, 'battle uji harus menghasilkan kematian');
    for (const death of deathEvents) {
      const owner = log.actions.find(a => a.from <= log.events.indexOf(death) && log.events.indexOf(death) < a.to);
      assert.ok(owner, 'setiap event kematian harus punya aksi induk');
    }
  });

  it('groups stacked buffs instead of repeating them per snapshot', () => {
    const log = run(true).log;
    const snap = log.actions[log.actions.length - 1].s;
    for (const state of snap) {
      for (const buff of state.b) {
        // Frostbite menumpuk; snapshot harus melaporkannya sebagai satu entri
        // dengan hitungan, bukan puluhan entri identik.
        assert.ok(buff.c >= 1, 'setiap buff punya hitungan minimal 1');
      }
      const keys = state.b.map(b => `${b.id}|${b.n}|${b.d}|${b.dur}`);
      assert.strictEqual(new Set(keys).size, keys.length, 'buff tidak boleh duplikat dalam satu snapshot');
    }
  });

  it('records the same battle result with and without logging', () => {
    const plain = run(false);
    const logged = run(true);
    assert.strictEqual(logged.winner, plain.winner);
    assert.strictEqual(logged.turns, plain.turns);
  });

  it('records the weapons and passives that actually fought', () => {
    const log = run(true).log;
    const crune = log.units.find(u => u.name === 'crune');
    assert.strictEqual(crune.weapon, 'Rune of Celebration');
    assert.deepStrictEqual(crune.passives, ['Physical Resistance', 'Energize']);
  });

  it('records damage, heal, and buff events with real values', () => {
    const log = run(true).log;
    const damage = log.events.filter(e => e.k === 'dmg');
    const heal = log.events.filter(e => e.k === 'heal');
    const buff = log.events.filter(e => e.k === 'buff');

    assert.ok(damage.length > 0, 'harus ada event damage');
    assert.ok(heal.length > 0, 'Celebration harus menghasilkan heal');
    assert.ok(buff.length > 0, 'Taunt/Celebration harus tercatat');

    for (const event of damage) assert.ok(event.v > 0);
    for (const event of heal) assert.ok(event.v > 0);
  });
});

describe('battle log storage', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-battle-log-'));
    process.chdir(tempDir);
    for (const key of Object.keys(require.cache)) {
      if (key.includes('battleLogStorage.js')) delete require.cache[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and reads a log back unchanged', () => {
    const store = require(path.join(ROOT, 'src/utils/battleLogStorage'));
    const log = run(true).log;
    const saved = store.save(log);
    assert.match(saved.id, /^[a-f0-9]{32}$/);

    const found = store.get(saved.id);
    assert.ok(found);
    assert.deepStrictEqual(found.log, log);
    assert.ok(found.expiresAt > Date.now());
  });

  it('rejects malformed and unknown ids', () => {
    const store = require(path.join(ROOT, 'src/utils/battleLogStorage'));
    assert.strictEqual(store.get('bukan-id'), null);
    assert.strictEqual(store.get('a'.repeat(32)), null);
    assert.strictEqual(store.get(undefined), null);
  });
});

describe('battle log page', () => {
  let tempDir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-battle-page-'));
    process.chdir(tempDir);
    process.env.DASHBOARD_TOKEN = TOKEN;
    process.env.DASHBOARD_PORT = '0';
    for (const key of Object.keys(require.cache)) {
      if (key.includes('battleLogStorage.js') || key.includes(path.sep + 'dashboard' + path.sep + 'server.js')) {
        delete require.cache[key];
      }
    }
    const { startDashboard } = require(path.join(ROOT, 'src/dashboard/server'));
    server = startDashboard({ guilds: { cache: new Map() } }, { stopGuild() {}, scheduleGuild() {} });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    delete process.env.DASHBOARD_TOKEN;
    delete process.env.DASHBOARD_PORT;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves the page and its assets without a token', async () => {
    const page = await fetch(baseUrl + '/battle-log');
    assert.strictEqual(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);

    for (const asset of ['/assets/battle-log.js', '/assets/battle-log.css']) {
      const res = await fetch(baseUrl + asset);
      assert.strictEqual(res.status, 200, asset);
    }
  });

  it('serves a saved log publicly and 404s an unknown one', async () => {
    const store = require(path.join(ROOT, 'src/utils/battleLogStorage'));
    const saved = store.save(run(true).log);

    const res = await fetch(baseUrl + '/api/battle-log/' + saved.id);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.log.winner, 'player');

    const missing = await fetch(baseUrl + '/api/battle-log/' + 'b'.repeat(32));
    assert.strictEqual(missing.status, 404);
  });

  it('allows animal images from the Discord CDN but nothing else', async () => {
    const res = await fetch(baseUrl + '/battle-log');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /img-src[^;]*https:\/\/cdn\.discordapp\.com/);
    // Script tetap hanya dari origin sendiri: gambar boleh remote, kode tidak.
    assert.match(csp, /script-src 'self'/);
  });

  it('ships a player page with seekbar and image support', async () => {
    const html = await (await fetch(baseUrl + '/battle-log')).text();
    for (const id of ['seek', 'btn-prev', 'btn-next', 'btn-play', 'side-player', 'side-enemy']) {
      assert.match(html, new RegExp('id="' + id + '"'), `halaman harus punya #${id}`);
    }

    const js = await (await fetch(baseUrl + '/assets/battle-log.js')).text();
    assert.match(js, /paintState/, 'player harus menggambar ulang state per aksi');
    assert.match(js, /groupEvents/, 'event berulang harus diringkas');
    assert.match(js, /cdn\.discordapp\.com|image/, 'player harus memakai gambar hewan');

    // Regresi: `scrollIntoView` menggeser seluruh halaman, sehingga arena dan
    // gambar hewan terdorong keluar layar tiap klik next. Feed harus digulir
    // sendiri lewat scrollTop kotaknya.
    assert.doesNotMatch(js, /\.scrollIntoView\(/, 'jangan menggeser halaman saat menyorot feed');
    assert.match(js, /host\.scrollTop/, 'feed harus digulir di dalam kotaknya sendiri');

    // Regresi: arena sticky pernah menutupi tombol next (klik tidak sampai).
    const css = await (await fetch(baseUrl + '/assets/battle-log.css')).text();
    assert.doesNotMatch(css, /position:\s*sticky/, 'arena tidak boleh menutupi tombol kontrol');
    assert.match(css, /#content\s*\{[^}]*grid-template-columns/, 'arena dan feed harus berdampingan');
    // Gambar harus cukup besar untuk dilihat, bukan ikon 46 px.
    assert.match(css, /\.avatar\s*\{[^}]*width:\s*(\d+)px/, 'avatar harus punya ukuran eksplisit');
    const size = Number(/\.avatar\s*\{[^}]*width:\s*(\d+)px/.exec(css)[1]);
    assert.ok(size >= 64, `avatar minimal 64px agar gambarnya jelas, dapat ${size}px`);

    // Regresi: turn 1 adalah "start battle" (roster HP penuh), bukan aksi.
    // OwO menomori begitu — `logs[0]` baru terisi sesudah turn pertama jalan,
    // dan battleDisplayUtil menampilkan "Turn 1" untuk state sebelum itu.
    assert.match(js, /startStep/, 'pemutar harus punya langkah pembuka "mulai"');
    assert.match(js, /displayTurn/, 'nomor turn tampilan harus digeser dari nomor mesin');
    assert.match(js, /engineTurn \+ \(state\.playable \? 1 : 0\)/, 'turn mesin 1 ditampilkan sebagai TURN 2');
  });

  it('renders a v1 log (tanpa actions) tanpa memutar apa pun', async () => {
    const store = require(path.join(ROOT, 'src/utils/battleLogStorage'));
    const log = { ...run(true).log, version: 1 };
    delete log.actions;
    delete log.droppedActions;
    const saved = store.save(log);

    const res = await fetch(baseUrl + '/api/battle-log/' + saved.id);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    // Halaman mendeteksi absennya `actions` dan beralih ke mode teks; yang
    // penting API tetap mengirim log lama apa adanya.
    assert.strictEqual(body.log.actions, undefined);
    assert.ok(body.log.events.length > 0);
  });

  it('keeps the rest of the API behind the token', async () => {
    const res = await fetch(baseUrl + '/api/settings?guildId=g');
    assert.strictEqual(res.status, 401);
  });
});
