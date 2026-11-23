const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractNextBossTimestamp, parseBossMessage, isBeforeScheduledBoss,
} = require('../src/services/bossTracker');

const TS = 1750000000;

describe('extractNextBossTimestamp', () => {
  it('extracts timestamp from plain message content', () => {
    const m = {
      content: 'Guild Boss Telah Dikalahkan!\nBoss baru: <t:' + TS + ':F>',
      embeds: [],
      components: []
    };
    assert.strictEqual(extractNextBossTimestamp(m), TS);
  });

  it('extracts the next boss timestamp from a "kabur" message', () => {
    // Pesan kabur memakai format sama seperti dikalahkan, hanya judulnya beda.
    const m = {
      content: 'GUILD BOSS KABUR!\nBoss baru: <t:' + TS + ':F>',
      embeds: [],
      components: []
    };
    assert.strictEqual(extractNextBossTimestamp(m), TS);
  });

  it('ignores messages without boss title', () => {
    const m = {
      content: 'Boss baru <t:' + TS + ':F>',
      embeds: [],
      components: []
    };
    assert.strictEqual(extractNextBossTimestamp(m), null);
  });

  it('extracts timestamp from v2 components', () => {
    const m = {
      content: 'Guild Boss Telah Dikalahkan!',
      embeds: [{ description: 'Boss baru: <t:' + TS + ':F>' }],
      components: [{ components: [{ components: [{ value: '<t:' + TS + ':R>' }] }] }]
    };
    assert.strictEqual(extractNextBossTimestamp(m), TS);
  });

  it('extracts timestamp from embeds of a real Message object', () => {
    const m = {
      toJSON: () => ({
        content: 'Guild Boss Telah Dikalahkan!',
        embeds: [{ description: '**Boss baru** <t:' + TS + ':F>' }],
        components: []
      })
    };
    assert.strictEqual(extractNextBossTimestamp(m), TS);
  });

  it('returns null when no timestamp is present', () => {
    const m = {
      content: 'Guild Boss Telah Dikalahkan!\nBoss baru muncul!',
      embeds: [],
      components: []
    };
    assert.strictEqual(extractNextBossTimestamp(m), null);
  });
});
describe('parseBossMessage', () => {
  // Struktur pesan Components V2 seperti yang dikirim bot Lucy.
  function componentsMessage(lines) {
    return { content: '', components: [{ type: 17, components: lines.map(content => ({ type: 10, content })) }] };
  }

  it('classifies a spawn message and uses the message time', () => {
    const m = componentsMessage([
      '## <:lucy_think:1> Guild Boss Telah Muncul!',
      '⏳ Berakhir <t:1793615870:R>'
    ]);
    m.createdTimestamp = TS * 1000;
    assert.deepStrictEqual(parseBossMessage(m), { kind: 'spawn', appearAt: TS });
  });

  it('classifies a global raid spawn message', () => {
    const m = componentsMessage([
      '## <:lucy_think:1> Global Raid Boss Telah Muncul!',
      '⏳ Berakhir <t:1793719068:R>'
    ]);
    m.createdTimestamp = TS * 1000;
    assert.deepStrictEqual(parseBossMessage(m), { kind: 'spawn', appearAt: TS });
  });

  it('reads the next spawn time from a defeat message', () => {
    const m = componentsMessage([
      '## <:lucy_yay:1> Guild Boss Telah Dikalahkan!',
      '☠ Dikalahkan 7 menit yang lalu\n⌛ Boss baru <t:1792162619:R>\n-# Limit fight reset <t:1792170000:R>'
    ]);
    assert.deepStrictEqual(parseBossMessage(m), { kind: 'ended', nextAt: 1792162619 });
  });

  it('reads the next spawn time from an escaped boss message', () => {
    const m = {
      content: 'GUILD BOSS KABUR!',
      components: [
        { type: 17, components: [{ type: 10, content: '⌛ Boss baru <t:1792162619:R>' }] },
        { type: 2, custom_id: 'raid:fight', disabled: true }
      ]
    };
    assert.deepStrictEqual(parseBossMessage(m), { kind: 'ended', nextAt: 1792162619 });
  });

  it('classifies an escaped boss message without a schedule', () => {
    const m = { content: 'GUILD BOSS KABUR!', components: [{ type: 2, custom_id: 'raid:fight', disabled: true }] };
    assert.deepStrictEqual(parseBossMessage(m), { kind: 'ended', nextAt: null });
  });

  it('derives spawn time from the snowflake when createdTimestamp is absent', () => {
    // 2026-11-02T09:37:50.877Z dari id pesan BOSS MUNCUL.
    const m = componentsMessage(['## Guild Boss Telah Muncul!']);
    m.id = '1566748163186892976';
    const event = parseBossMessage(m);
    assert.strictEqual(event.kind, 'spawn');
    assert.strictEqual(event.appearAt, 1793612270);
  });

  it('does not treat the defeat line as a spawn message', () => {
    const m = componentsMessage(['## Guild Boss Telah Dikalahkan!', '⌛ Boss baru <t:1792162619:R>']);
    assert.strictEqual(parseBossMessage(m).kind, 'ended');
  });

  it('returns null for unrelated messages', () => {
    assert.strictEqual(parseBossMessage({ content: 'halo dunia' }), null);
  });
});

describe('timestamp validation', () => {
  it('treats a spawn older than the schedule as stale', () => {
    assert.strictEqual(isBeforeScheduledBoss(TS, TS + 3600), true);
    assert.strictEqual(isBeforeScheduledBoss(TS, TS + 61), true);
  });

  it('allows a spawn within the clock-skew grace window', () => {
    assert.strictEqual(isBeforeScheduledBoss(TS, TS + 60), false);
    assert.strictEqual(isBeforeScheduledBoss(TS, TS), false);
    assert.strictEqual(isBeforeScheduledBoss(TS, TS - 1), false);
  });

  it('does not compare when there is no schedule or message time', () => {
    assert.strictEqual(isBeforeScheduledBoss(null, TS), false);
    assert.strictEqual(isBeforeScheduledBoss(TS, null), false);
  });
});

describe('boss tracker notification timing', () => {
  let tempDir;
  let previousLucyId;
  let previousChannelId;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-timing-'));
    process.chdir(tempDir);
    for (const key of Object.keys(require.cache)) {
      if (key.includes('utils' + path.sep + 'storage.js')) delete require.cache[key];
      if (key.includes('services' + path.sep + 'bossTracker.js')) delete require.cache[key];
    }
    previousLucyId = process.env.LUCY_BOT_ID;
    previousChannelId = process.env.LUCY_CHANNEL_ID;
    process.env.LUCY_BOT_ID = 'lucy';
    delete process.env.LUCY_CHANNEL_ID;
  });

  afterEach(() => {
    if (previousLucyId == null) delete process.env.LUCY_BOT_ID;
    else process.env.LUCY_BOT_ID = previousLucyId;
    if (previousChannelId == null) delete process.env.LUCY_CHANNEL_ID;
    else process.env.LUCY_CHANNEL_ID = previousChannelId;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function setup(settings) {
    const { updateGuildSettings } = require('../src/utils/storage');
    const { BossTracker } = require('../src/services/bossTracker');
    const guildId = 'guild-timing';
    updateGuildSettings(guildId, s => ({
      ...s,
      enabled: true,
      channelId: 'channel',
      roleId: 'role',
      ...settings,
    }));
    const sends = [];
    const guild = {
      id: guildId,
      channels: {
        fetch: async id => ({ id, send: async payload => sends.push(payload) }),
      },
    };
    const client = {
      guilds: { cache: new Map([[guildId, guild]]) },
      users: { fetch: async () => ({ send: async () => {} }) },
    };
    return { guildId, tracker: new BossTracker(client), sends };
  }

  function spawnMessage(guildId, appearAt) {
    return {
      id: '1',
      guildId,
      channelId: 'channel',
      author: { id: 'lucy' },
      createdTimestamp: appearAt * 1000,
      content: '## Guild Boss Telah Muncul!',
      components: [],
    };
  }

  it('ignores a stale spawn message instead of tagging immediately', async () => {
    const now = Math.floor(Date.now() / 1000);
    const scheduled = now + 3600;
    const { guildId, tracker, sends } = setup({ lastBossTimestamp: scheduled });

    await tracker.handleMessage(spawnMessage(guildId, now));

    assert.strictEqual(sends.length, 0, 'spawn lama tidak boleh mengirim tag');
    const { getGuildSettings } = require('../src/utils/storage');
    assert.strictEqual(getGuildSettings(guildId).lastBossTimestamp, scheduled, 'jadwal aktif tidak ditimpa');
    tracker.stopGuild(guildId);
  });

  it('does not notify before the scheduled timestamp', async () => {
    const now = Math.floor(Date.now() / 1000);
    const scheduled = now + 3600;
    const { guildId, tracker, sends } = setup({ lastBossTimestamp: scheduled });

    await tracker.notifyBoss(guildId, scheduled);

    assert.strictEqual(sends.length, 0, 'notifikasi sebelum waktunya harus ditahan');
    tracker.stopGuild(guildId);
  });

  it('notifies once the timestamp is due and still active', async () => {
    const now = Math.floor(Date.now() / 1000);
    const scheduled = now - 1;
    const { guildId, tracker, sends } = setup({ lastBossTimestamp: scheduled });

    await tracker.notifyBoss(guildId, scheduled);

    assert.strictEqual(sends.length, 1, 'notifikasi jatuh tempo harus dikirim');
    assert.ok(sends[0].content.includes('Boss baru sudah muncul'), sends[0].content);
    tracker.stopGuild(guildId);
  });

  it('ignores a stale timer for a replaced schedule', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { guildId, tracker, sends } = setup({ lastBossTimestamp: now + 3600 });

    await tracker.notifyBoss(guildId, now - 1);

    assert.strictEqual(sends.length, 0, 'timer jadwal lama tidak boleh mengirim');
    tracker.stopGuild(guildId);
  });
});

