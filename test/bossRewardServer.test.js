const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let tempDir;
let store;
let service;

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-reward-server-'));
  process.chdir(tempDir);
  store = require(path.join(ROOT, 'src/utils/bossRewardStorage'));
  service = require(path.join(ROOT, 'src/services/bossRewardNotifications'));
});

after(() => {
  process.chdir(ROOT);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function fakeGuild(sent) {
  return {
    id: 'g',
    channels: {
      fetch: async () => ({
        id: 'c',
        isTextBased: () => true,
        permissionsFor: () => ({ has: () => true }),
        send: async payload => { sent.push(payload); },
      }),
    },
    roles: { fetch: async () => ({ id: 'r', mentionable: true }) },
    members: { me: {} },
  };
}

describe('notifikasi reward server', () => {
  it('mempertahankan target setelah notifikasi terkirim', async () => {
    store.setServer('g', {
      enabled: true,
      channelId: 'c',
      roleId: 'r',
      targets: { weapon_shards: { target: 4, operator: '>=' } },
    });
    const sent = [];
    await service.evaluateServer(fakeGuild(sent), { weapon_shards: 4 });

    assert.equal(sent.length, 1, 'notifikasi terkirim sekali');
    assert.deepEqual(store.getServer('g').targets, {
      weapon_shards: { target: 4, operator: '>=' },
    }, 'target tidak dihapus');
    assert.ok(store.getCooldownRemaining('g', 'server') > 0, 'cooldown aktif');
  });

  it('cooldown mencegah notifikasi berulang tanpa menghapus target', async () => {
    const sent = [];
    await service.evaluateServer(fakeGuild(sent), { weapon_shards: 4 });

    assert.equal(sent.length, 0, 'notifikasi kedua ditahan cooldown');
    assert.deepEqual(store.getServer('g').targets, {
      weapon_shards: { target: 4, operator: '>=' },
    });
  });
});
