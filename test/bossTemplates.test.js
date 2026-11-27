const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const templates = require(path.join(ROOT, 'src/services/bossTemplates'));
const { handleTemplateCommand } = require(path.join(ROOT, 'src/commands/battleTemplate'));
const { handleSimCommand } = require(path.join(ROOT, 'src/commands/battleSim'));
const { buildBossBlueprint } = require(path.join(ROOT, 'src/services/bossRaidBlueprint'));

const GUILD = 'template-test-guild';
const OTHER = '60 snail sword crit';
const THIRD = '60 lizard pdagger gslay';

let memory = {};
function cleanup() {
  memory = {};
  templates.setTemplateStore({
    get: guildId => ({ ...(memory[guildId] || {}) }),
    update: (guildId, fn) => {
      memory[guildId] = fn({ ...(memory[guildId] || {}) });
      return memory[guildId];
    },
  });
}

function bossBlueprint() {
  return buildBossBlueprint([{
    slot: 1,
    level: 83,
    name: 'Boss',
    stats: { hpCurrent: 100000, hpMax: 100000, att: 200, pr: 50, wp: 300, mag: 100, mr: 50 },
    weapon: { name: 'poison dagger' },
    passives: [{ name: 'giant slayer' }],
  }]).blueprint;
}

test('template bawaan dipakai saat guild belum mengatur daftar', () => {
  cleanup();
  assert.deepEqual(templates.templatesOf(GUILD), [templates.DEFAULT_TEMPLATE]);
});

test('template bisa ditambah, diganti, dihapus, dan direset', () => {
  cleanup();
  let result = templates.addTemplate(GUILD, OTHER);
  assert.equal(result.error, undefined);
  assert.equal(result.templates.length, 2);

  result = templates.setTemplate(GUILD, 2, THIRD);
  assert.equal(result.error, undefined);
  assert.equal(result.templates[1], THIRD);

  result = templates.removeTemplate(GUILD, 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.templates, [templates.DEFAULT_TEMPLATE]);

  templates.addTemplate(GUILD, OTHER);
  result = templates.resetTemplates(GUILD);
  assert.deepEqual(result.templates, [templates.DEFAULT_TEMPLATE]);
});

test('template menolak komposisi tidak dikenal dan melebihi batas', () => {
  cleanup();
  assert.ok(templates.addTemplate(GUILD, 'bukanhewan').error);
  for (let i = 1; i < templates.MAX_TEMPLATES; i++) {
    assert.equal(templates.addTemplate(GUILD, OTHER).error, undefined);
  }
  assert.ok(templates.addTemplate(GUILD, THIRD).error);
});

test('template ditampilkan dengan emoji dex atau fallback 🐾', () => {
  cleanup();
  const display = templates.formatTemplate(templates.DEFAULT_TEMPLATE);
  assert.match(display, /(?:🐾|<a?:\w+:\d+>)/, 'ada emoji pet atau fallback');
  assert.doesNotMatch(display, /Poison Dagger|Giant Slayer/, 'nama senjata/pasif tidak ditampilkan');
  assert.match(display, / \+ /);
});

test('simulasi template mengurutkan damage dan menampilkan min-max', async () => {
  cleanup();
  templates.addTemplate(GUILD, OTHER);
  const result = await templates.simulateTemplates(GUILD, bossBlueprint(), { runs: 2, seed: 11 });
  assert.equal(result.error, undefined);
  assert.equal(result.results.length, 2);
  assert.ok(result.results[0].damage.player >= result.results[1].damage.player, 'urut damage terbesar');
  assert.ok(result.results[0].damage.playerMin <= result.results[0].damage.playerMax);

  const section = templates.renderTemplateSection(result.results);
  assert.match(section, /__\*\*Template Penghasil Kerusakan Terbaik\*\*__/);
  assert.match(section, /1\. .+: \*\*[\d.]+–[\d.]+\*\* damage/);
  assert.match(section, /Gunakan Copy Command/);
  assert.match(templates.formatDamageRange({ playerMin: 10, playerMax: 20 }), /^10–20$/);
});

test('command template bisa menambah dan menampilkan daftar', async () => {
  cleanup();
  const replies = [];
  const sendEmbed = (_message, embed) => { replies.push(embed.toJSON()); };
  const message = { guildId: GUILD, author: { id: 'u' }, member: { permissions: { has: () => true } } };

  await handleTemplateCommand(message, ['add', OTHER], 'd', { sendEmbed, isAdmin: () => true });
  assert.ok(replies[0].description.includes('ditambahkan'));

  await handleTemplateCommand(message, [], 'd', { sendEmbed, isAdmin: () => true });
  assert.ok(replies[1].description.includes('Template Penghasil') || replies[1].title.includes('Template'));
  assert.ok(replies[1].description.includes('1.'));
  assert.ok(replies[1].description.includes('2.'));
});

test('command template menolak pengubah non-admin', async () => {
  cleanup();
  const replies = [];
  const sendEmbed = (_message, embed) => { replies.push(embed.toJSON()); };
  const message = { guildId: GUILD, author: { id: 'u' } };
  await handleTemplateCommand(message, ['add', OTHER], 'd', {
    sendEmbed, isAdmin: () => false, isDeveloper: () => false,
  });
  assert.ok(replies[0].description.includes('developer/admin'));
  cleanup();
});

test('d sim template add terhubung ke handler template', async () => {
  cleanup();
  const replies = [];
  const sendEmbed = (_message, embed) => { replies.push(embed.toJSON()); };
  const message = { guildId: GUILD, author: { id: 'u' } };
  await handleSimCommand(message, ['template', 'add', OTHER], 'd', {
    sendEmbed, isAdmin: () => true,
  });
  assert.ok(replies[0].description.includes('ditambahkan'));
  assert.equal(templates.templatesOf(GUILD).length, 2);
  cleanup();
});
