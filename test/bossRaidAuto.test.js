const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handleMessage, isBossSpawn, resetAutoState } = require('../src/services/bossRaidAuto');
const { findRaidImageUrl, closeBossOcrWorker } = require('../src/services/bossRaidBlueprint');

const image = fs.readFileSync(path.join(__dirname, 'fixtures', 'boss-raid', 'ringkas.png'));

function bossMessage(id = 'boss-1', raidUrl = 'https://cdn.test/raid.png') {
  return {
    id,
    guildId: 'guild-1',
    channelId: 'channel-1',
    author: { id: 'lucy' },
    components: [{
      type: 17,
      components: [
        { type: 10, content: '## Guild Boss Telah Muncul!' },
        { type: 12, items: [{ media: { url: raidUrl } }] },
        { type: 10, content: '## Hadiah' },
        { type: 12, items: [{ media: { url: 'https://cdn.test/reward.png' } }] },
      ],
    }],
    attachments: new Map(),
  };
}

test.after(() => closeBossOcrWorker());

test('mengambil gambar raid dari Components V2, bukan reward', () => {
  assert.equal(findRaidImageUrl(bossMessage()), 'https://cdn.test/raid.png');
  assert.equal(isBossSpawn(bossMessage()), true);
  assert.equal(isBossSpawn({
    components: [{ type: 10, content: '## GUILD BOSS KABUR!' }],
  }), false);
});

test('menyelesaikan attachment:// ke URL attachment', () => {
  const message = bossMessage('boss-2', 'attachment://raid.png');
  message.attachments = new Map([['a', { name: 'raid.png', url: 'https://cdn.test/files/raid.png' }]]);
  assert.equal(findRaidImageUrl(message), 'https://cdn.test/files/raid.png');
});

test('otomatis mengirim blueprint sekali saat boss muncul', async () => {
  process.env.LUCY_BOT_ID = 'lucy';
  resetAutoState();
  let sends = 0;
  let sent = null;
  const result = await handleMessage(bossMessage('boss-3'), {
    lucyBotId: 'lucy',
    fetch: async () => ({ ok: true, arrayBuffer: async () => image }),
    templateSection: async () => '__**Template Penghasil Kerusakan Terbaik**__\n1. 🐾Lizard Poison Dagger Giant Slayer: **1.000–2.000** damage',
    sendPayload: (_message, payload) => { sends++; sent = payload; },
  });
  assert.ok(result);
  assert.equal(sends, 1);
  assert.equal(sent.flags, 32768, 'Components V2');
  const row = sent.components[0].toJSON();
  const text = sent.components[1].toJSON();
  assert.equal(row.type, 1, 'action row di atas');
  assert.equal(row.components[0].label, 'Salin Command');
  assert.equal(text.type, 10, 'template di bawah tombol');
  assert.match(text.content, /Template Penghasil Kerusakan Terbaik/);
  assert.doesNotMatch(text.content, /28 \?\? poison dagger/, 'blueprint tidak ditampilkan');
  assert.doesNotMatch(text.content, /Kartu 1/);

  const duplicate = await handleMessage(bossMessage('boss-3'), {
    lucyBotId: 'lucy',
    fetch: async () => ({ ok: true, arrayBuffer: async () => image }),
    sendPayload: () => { sends++; },
  });
  assert.equal(duplicate, null);
  assert.equal(sends, 1);
});

test('mengabaikan pesan bukan spawn dan pesan bot lain', async () => {
  process.env.LUCY_BOT_ID = 'lucy';
  resetAutoState();
  let sends = 0;
  const ended = bossMessage('boss-4');
  ended.components[0].components[0].content = '## GUILD BOSS TELAH DIKALAHKAN!';
  assert.equal(await handleMessage(ended, { lucyBotId: 'lucy', send: () => { sends++; } }), null);
  const otherBot = bossMessage('boss-5');
  otherBot.author.id = 'other';
  assert.equal(await handleMessage(otherBot, { lucyBotId: 'lucy', send: () => { sends++; } }), null);
  assert.equal(sends, 0);
});
