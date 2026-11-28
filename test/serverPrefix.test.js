const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-prefix-slash-'));
  process.chdir(tempDir);
  fs.mkdirSync(path.join(tempDir, 'data'), { recursive: true });
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.sep + 'storage.js') || key.includes('serverPrefix.js') || key.includes('boss.js')) {
      delete require.cache[key];
    }
  }
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeInteraction(value, admin = true) {
  const replies = [];
  return {
    guildId: 'guild1',
    memberPermissions: { has: () => admin },
    options: { getString: () => value },
    reply: async payload => { replies.push(payload); },
    replies,
  };
}

describe('/prefix standalone command', () => {
  it('memakai nama prefix dan tidak lagi menjadi subcommand /boss', () => {
    const { data } = require('../src/commands/serverPrefix');
    assert.strictEqual(data.toJSON().name, 'prefix');
    const boss = require('../src/commands/boss');
    const subs = boss.data.toJSON().options.map(o => o.name);
    assert.ok(!subs.includes('prefix'), '/boss prefix harus dihapus');
  });

  it('menampilkan prefix server saat ini tanpa opsi nilai', async () => {
    const { execute } = require('../src/commands/serverPrefix');
    const i = makeInteraction(null);
    await execute(i);
    assert.match(i.replies[0].content, /Prefix server saat ini: `d`/);
  });

  it('mengubah prefix server lewat /prefix', async () => {
    const { execute } = require('../src/commands/serverPrefix');
    const { getGuildSettings } = require('../src/utils/storage');
    const i = makeInteraction('X');
    await execute(i);
    assert.strictEqual(getGuildSettings('guild1').prefix, 'x');
    assert.match(i.replies[0].content, /Prefix server diubah/);
  });

  it('menolak prefix tidak valid', async () => {
    const { execute } = require('../src/commands/serverPrefix');
    const i = makeInteraction('a b');
    await execute(i);
    assert.match(i.replies[0].content, /1–10 karakter/);
  });

  it('menolak non-admin', async () => {
    const { execute } = require('../src/commands/serverPrefix');
    const i = makeInteraction('!', false);
    await execute(i);
    assert.match(i.replies[0].content, /moderator\/admin/);
  });
});
