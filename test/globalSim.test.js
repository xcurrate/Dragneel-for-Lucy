const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));
const globalSim = require(path.join(ROOT, 'src/services/globalSim'));
const panel = require(path.join(ROOT, 'src/ui/battlePanel'));
const { handleSimCommand, handleGlobalLossButton, GLOBAL_COOLDOWN_MS } = require(path.join(ROOT, 'src/commands/battleSim'));

// Stat kuat vs lemah supaya arah hasilnya pasti, bukan acak.
const COEFFS_STRONG = { hp: 8, att: 6, pr: 2, wp: 3, mag: 5, mr: 1 };
const COEFFS_WEAK = { hp: 4, att: 2, pr: 3, wp: 1, mag: 1, mr: 2 };

function message(content, id = 'me') {
  return { guildId: 'g', author: { id }, content };
}

// Tim lawan dengan level berbeda untuk menguji pemisahan kelompok.
function seedWorld() {
  store.createTeam('me', 'Milikku');
  store.setSlot('me', 'Milikku', 1, { custom: COEFFS_STRONG, level: 80 });
  store.setActiveTeam('me', 'Milikku');

  store.createTeam('rival', 'Lemah');
  store.setSlot('rival', 'Lemah', 1, { custom: COEFFS_WEAK, level: 20 });

  store.createTeam('rival', 'Kuat');
  store.setSlot('rival', 'Kuat', 1, { custom: COEFFS_STRONG, level: 90 });
}

describe('simulasi global', () => {
  let tempDir;
  let replies;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-global-sim-'));
    process.chdir(tempDir);
    store.getDb();
    replies = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const sendEmbed = (m, embed) => { replies.push(embed.toJSON()); return { edit: async () => {} }; };

  it('hanya memakai tim milik user lain sebagai lawan', () => {
    seedWorld();
    const opponents = store.listOpponentTeams('me');
    assert.strictEqual(opponents.length, 2);
    assert.ok(opponents.every(t => t.userId === 'rival'));
    assert.ok(!opponents.some(t => t.name === 'Milikku'));
  });

  it('membagi hasil menurut level tim lawan pada batas 35', async () => {
    seedWorld();
    const player = require(path.join(ROOT, 'src/commands/battleSim')).resolveTeamSpecs(store.getActiveTeam('me'));
    const opponents = store.listOpponentTeams('me').map(t => ({
      label: t.name,
      specs: require(path.join(ROOT, 'src/commands/battleSim')).resolveTeamSpecs(t).specs,
    }));

    const result = await globalSim.runGlobalSim(player.specs, opponents, { runs: 20, seed: 7, yieldEvery: 0 });

    assert.strictEqual(result.battles, 40);
    assert.strictEqual(result.buckets.low.teams, 1, 'satu tim di bawah 35');
    assert.strictEqual(result.buckets.high.teams, 1, 'satu tim 35 ke atas');
    assert.strictEqual(result.buckets.low.avgLevel, 20);
    assert.strictEqual(result.buckets.high.avgLevel, 90);
    // Total kedua kelompok harus sama dengan rekap keseluruhan.
    const sum = result.buckets.low.tally.player + result.buckets.high.tally.player;
    assert.strictEqual(sum, result.tally.player);
  });

  it('menghitung streak hanya dari kemenangan berturut-turut', async () => {
    // Tim sangat kuat melawan tim sangat lemah: semua menang, streak = jumlah laga.
    store.createTeam('me', 'Dewa');
    store.setSlot('me', 'Dewa', 1, { custom: { hp: 40, att: 40, pr: 10, wp: 10, mag: 40, mr: 10 }, level: 500 });
    store.createTeam('rival', 'Cupu');
    store.setSlot('rival', 'Cupu', 1, { custom: COEFFS_WEAK, level: 1 });

    const cmd = require(path.join(ROOT, 'src/commands/battleSim'));
    const player = cmd.resolveTeamSpecs(store.getTeam('me', 'Dewa'));
    const opponent = cmd.resolveTeamSpecs(store.getTeam('rival', 'Cupu'));
    const result = await globalSim.runGlobalSim(player.specs, [{ label: 'Cupu', specs: opponent.specs }], {
      runs: 10, seed: 3, yieldEvery: 0,
    });

    assert.strictEqual(result.tally.player, 10);
    assert.strictEqual(result.streak.max, 10);
    assert.strictEqual(result.streak.avg, 10);
  });

  it('mencatat tim yang mengalahkan pemain beserta jumlah kekalahannya', async () => {
    store.createTeam('me', 'Lemah');
    store.setSlot('me', 'Lemah', 1, { custom: COEFFS_WEAK, level: 5 });
    store.createTeam('rival', 'Kuat');
    store.setSlot('rival', 'Kuat', 1, { custom: { hp: 40, att: 40, pr: 10, wp: 10, mag: 40, mr: 10 }, level: 500 });

    const cmd = require(path.join(ROOT, 'src/commands/battleSim'));
    const player = cmd.resolveTeamSpecs(store.getTeam('me', 'Lemah'));
    const opponent = cmd.resolveTeamSpecs(store.getTeam('rival', 'Kuat'));
    const result = await globalSim.runGlobalSim(player.specs, [{ label: 'Kuat', specs: opponent.specs }], {
      runs: 5, seed: 11, yieldEvery: 0,
    });

    assert.strictEqual(result.tally.enemy, 5);
    assert.strictEqual(result.losses.length, 1);
    assert.strictEqual(result.losses[0].label, 'Kuat');
    assert.strictEqual(result.losses[0].tally.enemy, 5);
    assert.strictEqual(result.avgLosses, 5);
  });

  it('menyembunyikan ikon senjata pada daftar kekalahan', async () => {
    store.createTeam('me', 'Lemah');
    store.setSlot('me', 'Lemah', 1, { custom: COEFFS_WEAK, level: 5 });
    store.createTeam('rival', 'Bersenjata');
    store.setSlot('rival', 'Bersenjata', 1, {
      custom: { hp: 40, att: 40, pr: 10, wp: 10, mag: 40, mr: 10 },
      level: 500,
      weaponId: 1,
      weaponQuality: 90,
    });

    const cmd = require(path.join(ROOT, 'src/commands/battleSim'));
    const player = cmd.resolveTeamSpecs(store.getTeam('me', 'Lemah'));
    const opponent = cmd.resolveTeamSpecs(store.getTeam('rival', 'Bersenjata'));
    const result = await globalSim.runGlobalSim(player.specs, [{ label: 'Bersenjata', specs: opponent.specs }], {
      runs: 5, seed: 13, yieldEvery: 0,
    });

    const embed = panel.globalLossesEmbed(result, { playerLabel: 'Lemah' }).toJSON();
    const body = JSON.stringify(embed);
    assert.ok(body.includes('❓'), 'senjata diganti tanda tanya');
    assert.ok(body.includes('Bersenjata'));
    assert.ok(!body.includes('Great Sword'), 'nama senjata tidak bocor');
  });

  // Slot tanpa senjata jangan diberi tanda tanya: itu menyiratkan ada senjata
  // yang disembunyikan padahal kosong.
  it('tidak menaruh tanda tanya pada slot tanpa senjata', async () => {
    store.createTeam('me', 'Lemah');
    store.setSlot('me', 'Lemah', 1, { custom: COEFFS_WEAK, level: 5 });
    store.createTeam('rival', 'Kosong');
    store.setSlot('rival', 'Kosong', 1, { custom: { hp: 40, att: 40, pr: 10, wp: 10, mag: 40, mr: 10 }, level: 500 });

    const cmd = require(path.join(ROOT, 'src/commands/battleSim'));
    const player = cmd.resolveTeamSpecs(store.getTeam('me', 'Lemah'));
    const opponent = cmd.resolveTeamSpecs(store.getTeam('rival', 'Kosong'));
    const result = await globalSim.runGlobalSim(player.specs, [{ label: 'Kosong', specs: opponent.specs }], {
      runs: 5, seed: 17, yieldEvery: 0,
    });

    const body = JSON.stringify(panel.globalLossesEmbed(result, { playerLabel: 'Lemah' }).toJSON());
    assert.ok(!body.includes('❓'), 'tidak ada tanda tanya untuk slot kosong');
  });

  it('menjawab tombol kekalahan sebagai pesan ephemeral', async () => {
    seedWorld();
    let payload = null;
    await handleSimCommand(message('d sim global -m 5 -s 5'), ['global', '-m', '5', '-s', '5'], 'd', {
      sendEmbed,
      sendPayload: (m, p) => { payload = p; return { edit: async () => {} }; },
      isDeveloper: () => true,
    });
    assert.ok(payload?.components?.length, 'hasil global mengirim tombol');

    const customId = payload.components[0].components[0].toJSON().custom_id;
    let reply = null;
    await handleGlobalLossButton({
      customId,
      user: { id: 'me' },
      reply: async p => { reply = p; },
    });
    assert.ok(reply.flags & 64, 'balasan ephemeral');
    assert.ok(reply.embeds[0].toJSON().title.includes('mengalahkan'));
  });

  it('menolak membuka tombol milik user lain', async () => {
    let reply = null;
    await handleGlobalLossButton({
      customId: `battle_global_losses:someone-else:abc`,
      user: { id: 'u' },
      reply: async p => { reply = p; },
    });
    assert.ok(reply.flags & 64);
    assert.ok(reply.content.includes('milik orang lain'));
  });

  it('memberi cooldown 10 detik untuk selain developer', async () => {
    seedWorld();
    const deps = { sendEmbed, isDeveloper: () => false };
    await handleSimCommand(message('d sim global -m 2 -s 1'), ['global', '-m', '2', '-s', '1'], 'd', deps);
    const left = store.cooldownRemaining('me', 'sim-global');
    assert.ok(left > 0 && left <= GLOBAL_COOLDOWN_MS, `sisa cooldown ${left}`);

    replies = [];
    await handleSimCommand(message('d sim global -m 2 -s 2'), ['global', '-m', '2', '-s', '2'], 'd', deps);
    assert.strictEqual(replies.length, 1);
    assert.ok(replies[0].description.includes('baru bisa dipakai lagi'));
  });

  it('developer melewati cooldown simulasi global', async () => {
    seedWorld();
    const deps = { sendEmbed, isDeveloper: () => true };
    await handleSimCommand(message('d sim global -m 2 -s 1'), ['global', '-m', '2', '-s', '1'], 'd', deps);
    assert.strictEqual(store.cooldownRemaining('me', 'sim-global'), 0);
  });

  it('`d sim g` adalah alias yang sama dengan `d sim global`', async () => {
    seedWorld();
    let payload = null;
    await handleSimCommand(message('d sim g -m 2 -s 4'), ['g', '-m', '2', '-s', '4'], 'd', {
      sendEmbed,
      sendPayload: (m, p) => { payload = p; return { edit: async () => {} }; },
      isDeveloper: () => true,
    });
    const embed = payload.embeds[0].toJSON();
    assert.ok(embed.title.includes('Simulasi Global'));
  });

  it('menolak bila belum ada tim lawan dari user lain', async () => {
    store.createTeam('me', 'Sendiri');
    store.setSlot('me', 'Sendiri', 1, { custom: COEFFS_STRONG, level: 50 });
    store.setActiveTeam('me', 'Sendiri');

    await handleSimCommand(message('d sim global -m 1'), ['global', '-m', '1'], 'd', { sendEmbed, isDeveloper: () => true });
    assert.ok(replies[0].description.includes('Belum ada tim lawan'));
  });

  it('embed hasil memuat semua angka yang diminta', async () => {
    seedWorld();
    let payload = null;
    await handleSimCommand(message('d sim global -m 5 -s 9'), ['global', '-m', '5', '-s', '9'], 'd', {
      sendEmbed,
      sendPayload: (m, p) => { payload = p; return { edit: async () => {} }; },
      isDeveloper: () => true,
    });
    const embed = payload.embeds[0].toJSON();
    const names = embed.fields.map(f => f.name).join(' | ');
    const body = JSON.stringify(embed);

    assert.ok(names.includes('Max level < 35'));
    assert.ok(names.includes('Max level ≥ 35'));
    assert.ok(body.includes('Streak'), 'ada rata-rata streak');
    assert.ok(body.includes('Kalah per tim'), 'ada rata-rata kalah');
    assert.ok(body.includes('menang') && body.includes('seri') && body.includes('kalah'));
  });
});
