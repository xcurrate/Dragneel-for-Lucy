const test = require('node:test');
const assert = require('node:assert/strict');
const { createButtonRow, createBlueprintPayload, isCopyButton, handleButton } = require('../src/services/bossRaidCopy');

test('tombol salin membawa customId dan command tersimpan', async () => {
  const row = createButtonRow('d sim tim vs 1 ?? poison dagger -eboss').toJSON();
  const button = row.components[0];
  assert.equal(button.label, 'Salin Command');
  assert.ok(isCopyButton(button.custom_id));
  let replied = null;
  await handleButton({
    customId: button.custom_id,
    reply: async payload => { replied = payload; },
  });
  assert.equal(replied.flags, 64, 'ephemeral');
  assert.match(replied.content, /^`d sim tim vs 1 \?\? poison dagger -eboss`$/);
  assert.doesNotMatch(replied.content, /```/);
});

test('token tidak dikenal ditolak', async () => {
  let replied = null;
  await handleButton({
    customId: 'boss_raid_copy:tidak-ada',
    reply: async payload => { replied = payload; },
  });
  assert.match(replied.content, /kedaluwarsa/i);
});

test('payload blueprint menaruh tombol di atas template (Components V2)', () => {
  const payload = createBlueprintPayload('d sim tim vs boss -eboss', '__**Template**__\n1. 🐾Lizard: **1–2** damage');
  assert.equal(payload.flags, 32768);
  const container = payload.components[0].toJSON();
  assert.equal(container.type, 17);
  assert.equal(container.components[0].type, 1);
  assert.equal(container.components[0].components[0].label, 'Salin Command');
  assert.equal(container.components[1].type, 10);
  assert.match(container.components[1].content, /Template/);
});
