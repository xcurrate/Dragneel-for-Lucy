const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseBossRaidImage,
  buildBossBlueprint,
  closeBossOcrWorker,
} = require('../src/services/bossRaidBlueprint');
const { handleRaidBlueprint } = require('../src/commands/battleSim');
const simParser = require('../src/utils/simParser');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'boss-raid', name));

test.after(() => closeBossOcrWorker());

function cardSummary(card) {
  return {
    level: card.level,
    stats: card.stats,
    weapon: card.weapon && card.weapon.id,
    passives: card.passives.map(passive => passive.id),
  };
}

test('membaca kartu raid ringkas dan penuh', async t => {

  const ringkas = await parseBossRaidImage(fixture('ringkas.png'));
  assert.equal(ringkas.layout, 'ringkas');
  assert.deepEqual(ringkas.cards.map(cardSummary), [
    {
      level: 28,
      stats: { hpCurrent: 80160, hpMax: 80160, att: 212, pr: 46, wp: 668, mag: 156, mr: 46 },
      weapon: 8,
      passives: [19, 18],
    },
    {
      level: 53,
      stats: { hpCurrent: 98160, hpMax: 98160, att: 153, pr: 45, wp: 1321, mag: 259, mr: 62 },
      weapon: 3,
      passives: [22, 4],
    },
    {
      level: 72,
      stats: { hpCurrent: 94560, hpMax: 94560, att: 244, pr: 74, wp: 932, mag: 316, mr: 55 },
      weapon: 6,
      passives: [27, 6],
    },
  ]);

  const penuh = await parseBossRaidImage(fixture('penuh.png'));
  assert.equal(penuh.layout, 'penuh');
  assert.deepEqual(penuh.cards.map(cardSummary), [
    {
      level: 34,
      stats: { hpCurrent: 74739, hpMax: 84480, att: 236, pr: 49, wp: 704, mag: 168, mr: 49 },
      weapon: 16,
      passives: [14, 13],
    },
    {
      level: 57,
      stats: { hpCurrent: 88533, hpMax: 100000, att: 214, pr: 57, wp: 842, mag: 157, mr: 66 },
      weapon: 13,
      passives: [16, 3],
    },
    {
      level: 82,
      stats: { hpCurrent: 96441, hpMax: 100000, att: 264, pr: 52, wp: 1812, mag: 346, mr: 62 },
      weapon: 125,
      passives: [10, 21],
    },
  ]);
});

test('blueprint bisa diparse oleh dsim', async t => {
  const parsed = await parseBossRaidImage(fixture('ringkas.png'));
  const built = buildBossBlueprint(parsed.cards, { prefix: 'd', player: 'timku' });
  assert.equal(built.warnings.length, 0);
  assert.equal(built.units.length, 3);
  assert.match(built.command, /^d sim timku vs /);
  assert.match(built.command, /-eboss$/);

  const inline = simParser.parseInlineSide(built.blueprint, { prefix: 'd' });
  assert.equal(inline.error, undefined);
  assert.equal(inline.specs.length, 3);
  assert.deepEqual(inline.specs.map(spec => spec.weapon.id), [8, 3, 6]);
  assert.deepEqual(inline.specs.map(spec => spec.finalStats.hpCurrent), [80160, 98160, 94560]);
});

test('perintah sim raid membaca gambar dari lampiran', async t => {
  const originalFetch = global.fetch;
  const image = fixture('ringkas.png');
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => image });
  t.after(() => { global.fetch = originalFetch; });

  let sent = null;
  const message = {
    author: { id: 'user-1' },
    attachments: new Map([['a', { name: 'raid.png', contentType: 'image/png', url: 'https://example.test/raid.png' }]]),
  };
  await handleRaidBlueprint(message, [], 'd', {
    templateSection: async () => '__**Template Penghasil Kerusakan Terbaik**__\n1. 🐾Lizard: **1.000–2.000** damage',
    sendPayload: (_message, payload) => { sent = payload; },
    isDeveloper: () => true,
  });
  assert.ok(sent);
  assert.equal(sent.flags, 32768, 'Components V2');
  const row = sent.components[0].toJSON();
  const text = sent.components[1].toJSON();
  assert.equal(row.type, 1, 'action row di atas');
  assert.equal(row.components[0].label, 'Salin Command');
  assert.equal(text.type, 10, 'template di bawah tombol');
  assert.match(text.content, /Template Penghasil Kerusakan Terbaik/);
  assert.doesNotMatch(text.content, /28 \?\? poison dagger/, 'blueprint tidak ditampilkan');
  assert.doesNotMatch(text.content, /Kartu 1/);
});

test('perintah sim raid membaca gambar dari components pesan Lucy', async t => {
  const originalFetch = global.fetch;
  const image = fixture('ringkas.png');
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => image });
  t.after(() => { global.fetch = originalFetch; });

  const boss = {
    id: 'boss-1',
    components: [{
      type: 17,
      components: [
        { type: 10, content: '## Guild Boss Telah Muncul!' },
        { type: 12, items: [{ media: { url: 'https://cdn.test/raid.png' } }] },
        { type: 10, content: '## Hadiah' },
        { type: 12, items: [{ media: { url: 'https://cdn.test/reward.png' } }] },
      ],
    }],
    attachments: new Map(),
  };
  const message = {
    author: { id: 'user-1' },
    attachments: new Map(),
    reference: { messageId: 'boss-1' },
    channel: { messages: { fetch: async () => boss } },
  };
  let sent = null;
  await handleRaidBlueprint(message, [], 'd', {
    templateSection: async () => '__**Template Penghasil Kerusakan Terbaik**__\n1. 🐾Lizard: **1.000–2.000** damage',
    sendText: (_message, text) => { sent = text; },
    isDeveloper: () => true,
  });
  assert.ok(sent);
  assert.match(sent, /Template Penghasil Kerusakan Terbaik/);
  assert.doesNotMatch(sent, /28 \?\? poison dagger/, 'blueprint tidak ditampilkan');
});

test('perintah sim raid meminta gambar', async t => {
  let sent = null;
  await handleRaidBlueprint({
    author: { id: 'user-1' },
    attachments: new Map(),
  }, [], 'd', { sendEmbed: (_message, embed) => { sent = embed; } });
  assert.match(sent.data.description, /balas gambar kartu raid/i);
});
