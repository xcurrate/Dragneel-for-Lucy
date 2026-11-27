const test = require('node:test');
const assert = require('node:assert/strict');
const { createButtonRow, isCopyButton, handleButton } = require('../src/services/bossRaidCopy');

test('tombol salin membawa customId dan command tersimpan', async () => {
  const row = createButtonRow('d sim tim vs 1 ?? poison dagger -eboss').toJSON();
  const button = row.components[0];
  assert.equal(button.label, '📋 Salin command');
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
