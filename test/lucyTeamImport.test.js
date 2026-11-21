const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let tempDir;
let importer;
let store;

function cardMessage(overrides = {}) {
  const slot = `**[2] <:animal:1> **for** **
Lvl 83 \`[6,602,130/47,459,321]\`
<:hp:1> \`2990\` <:wp:2> \`0666\`
<:att:3> \`0100\` <:mg:4> \`0100\`
<:pr:5> \`67%\` <:mr:6> \`67%\`
🔒 \`2PI\` <a:fabled:7> <:fshield:8> <:fthorns:9> <:fhgen:10> 100%`;
  return {
    id: 'lucy-message-1',
    author: { id: '1438615298012872817', bot: true },
    guildId: 'guild-1',
    channelId: 'channel-1',
    components: [{
      type: 17,
      components: [
        { type: 10, content: "## ⭐ **nnneozen's team**" },
        { type: 10, content: slot },
      ],
    }],
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-team-import-'));
  process.chdir(tempDir);
  delete require.cache[require.resolve('../src/utils/battleTeamStorage')];
  delete require.cache[require.resolve('../src/services/lucyTeamImport')];
  store = require('../src/utils/battleTeamStorage');
  importer = require('../src/services/lucyTeamImport');
});

afterEach(() => {
  process.chdir(ROOT);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Lucy team import', () => {
  it('membaca Components V2, stat, fabled weapon, dan passive', () => {
    const parsed = importer.parseLucyTeamMessage(cardMessage());
    assert.equal(parsed.name, "nnneozen's team");
    assert.equal(parsed.slots.length, 1);
    assert.deepEqual(parsed.slots[0], {
      slot: 2,
      label: 'for',
      level: 83,
      displayedStats: { hp: 2990, wp: 666, att: 100, mag: 100, pr: 67, mr: 67 },
      weaponId: 5,
      weaponQuality: 100,
      passives: [8, 15],
    });
  });

  it('mengabaikan pesan non-Lucy dan metadata 2PI/1F1C', () => {
    assert.equal(importer.parseLucyTeamMessage(cardMessage({ author: { id: 'other-bot' } })), null);
    const parsed = importer.parseLucyTeamMessage(cardMessage());
    assert.equal(parsed.slots[0].passives.includes('2PI'), false);
  });

  it('mengimpor final stats tanpa menambahkan stat senjata dua kali', () => {
    const parsed = importer.parseLucyTeamMessage(cardMessage());
    const result = importer.importLucyTeam('user-1', parsed);
    assert.equal(result.imported, 1);
    const slot = result.team.slots[0];
    assert.deepEqual(slot.finalStats, { hp: 2990, att: 100, pr: 67, wp: 666, mag: 100, mr: 67 });
    assert.equal(slot.weaponQuality, 100);
    assert.deepEqual(slot.passives, [8, 15]);
    const sim = require('../src/services/battleSim');
    const specs = sim.toSpecs(result.team);
    assert.equal(specs.specs[0].finalStats.hp, 2990);
    assert.equal(specs.specs[0].finalStats.pr, 67);

    const duplicate = importer.importLucyTeam('user-1', parsed);
    assert.match(duplicate.error, /sudah kamu impor/);
  });

  it('memberi reaksi hanya pada kartu Lucy yang valid', async () => {
    const calls = [];
    const message = cardMessage({ react: async emoji => calls.push(emoji) });
    assert.equal(await importer.prepareLucyTeamMessage(message), true);
    assert.deepEqual(calls, ['📊']);
    assert.equal(await importer.prepareLucyTeamMessage({ author: { id: 'other' } }), false);
  });

  it('mengimpor saat user menekan reaksi 📊 dan mengabaikan bot', async () => {
    const message = cardMessage({ react: async () => {} });
    await importer.prepareLucyTeamMessage(message);
    const reaction = { emoji: { name: '📊' }, message };
    const result = await importer.handleReaction(reaction, { id: 'user-2', bot: false });
    assert.equal(result.imported, 1);
    assert.equal(await importer.handleReaction(reaction, { id: 'bot', bot: true }), null);
    assert.equal(await importer.handleReaction({ emoji: { name: '👍' }, message }, { id: 'user-3' }), null);
  });
});
