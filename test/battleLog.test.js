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
    assert.strictEqual(log.version, 1);
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

  it('keeps the rest of the API behind the token', async () => {
    const res = await fetch(baseUrl + '/api/settings?guildId=g');
    assert.strictEqual(res.status, 401);
  });
});
