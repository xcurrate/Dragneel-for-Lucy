const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

let tempDir;

// Modul reminder menyimpan handle SQLite dan membaca prefix dari storage, jadi
// cache dibuang dan cwd dipindah ke temp agar tiap test berdiri sendiri.
function resetModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('reminder') || key.includes('lucyCounterStorage.js') || key.includes('storage.js')) {
      delete require.cache[key];
    }
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-reminder-'));
  process.chdir(tempDir);
  delete process.env.DEVELOPER_IDS;
  resetModules();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

let counter = 0;

function makeMessage(content, {
  guildId = 'guild1', channelId = 'chan1', userId = 'user1', name = 'Tester',
  admin = false, dev = false, guildOwner = false, guild = null, dmFails = false
} = {}) {
  const sent = [];
  const dms = [];
  const nextId = () => 'm' + (++counter);
  const channel = { id: channelId, send: async payload => { sent.push(payload); return { id: nextId() }; } };
  const resolvedGuild = guild || { id: guildId, ownerId: guildOwner ? userId : 'someone-else', name: 'Guild Satu', iconURL: () => 'https://cdn.discordapp.com/icons/1/a.png' };
  return {
    guildId,
    guild: resolvedGuild,
    channelId,
    author: { id: userId, bot: false, username: name },
    member: { displayName: name, nickname: name + '-nick', permissions: { has: () => admin } },
    content,
    client: {
      application: { owner: dev ? { id: userId } : null },
      channels: { fetch: async () => channel },
      guilds: { cache: new Map([[guildId, resolvedGuild]]) },
      users: {
        fetch: async id => ({
          id, username: 'user' + id, globalName: 'Global ' + id,
          displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/' + id + '/x.png',
          send: async payload => { if (dmFails) throw new Error('Cannot send messages to this user'); dms.push(payload); }
        })
      }
    },
    react: async () => {},
    reply: async payload => { sent.push(payload); return { id: nextId(), delete: async () => {} }; },
    channel,
    sent,
    dms
  };
}

// Gabungkan semua teks balasan (bisa berupa string atau payload embed).
function textOf(message) {
  return message.sent
    .map(payload => (typeof payload === 'string' ? payload : payload.content || ''))
    .filter(Boolean)
    .join('\n');
}

function idOf(message, prefix) {
  const match = textOf(message).match(new RegExp('`(' + prefix + '-[A-Z0-9]+)`'));
  return match ? match[1] : null;
}

const svc = () => require('../src/services/reminders');
const storage = () => require('../src/utils/reminderStorage');

async function makeTemplate(name = 'Template Satu', body = 'Halo {USER}') {
  const message = makeMessage('d r create ' + name + ' | ' + body, { userId: 'dev1', dev: true });
  await svc().handleMessage(message);
  return { templateId: idOf(message, 'T'), message };
}

async function awardAndRedeem(recipientId = '111222333444555666') {
  const { templateId } = await makeTemplate();
  const give = makeMessage('d r give <@' + recipientId + '> ' + templateId, { userId: 'dev1', dev: true });
  await svc().handleMessage(give);
  const claimId = idOf(give, 'C');
  const redeem = makeMessage('d r redeem ' + claimId, { userId: recipientId });
  await svc().handleMessage(redeem);
  return { templateId, claimId, reminderId: idOf(redeem, 'R'), give, redeem };
}

describe('custom reminder — prefix resolution', () => {
  it('works with the default prefix d', async () => {
    const { updateGuildSettings } = require('../src/utils/storage');
    updateGuildSettings('guild1', s => ({ ...s, prefix: 'd' }));
    const { templateId } = await makeTemplate();
    assert.ok(templateId, 'template dibuat dengan prefix default');
  });

  it('follows a custom prefix configured for guild A', async () => {
    const { updateGuildSettings } = require('../src/utils/storage');
    updateGuildSettings('guild1', s => ({ ...s, prefix: '!' }));
    const ok = makeMessage('! r help', { guildId: 'guild1' });
    assert.equal(await svc().handleMessage(ok), true);
    assert.match(textOf(ok), /Custom Reminder/);
    assert.equal(await svc().handleMessage(makeMessage('d r help', { guildId: 'guild1' })), false);
  });

  it('keeps guild B on a different prefix independently', async () => {
    const { updateGuildSettings } = require('../src/utils/storage');
    updateGuildSettings('guildA', s => ({ ...s, prefix: '!' }));
    updateGuildSettings('guildB', s => ({ ...s, prefix: '?' }));
    assert.equal(await svc().handleMessage(makeMessage('! r help', { guildId: 'guildA' })), true);
    assert.equal(await svc().handleMessage(makeMessage('? r help', { guildId: 'guildB' })), true);
    assert.equal(await svc().handleMessage(makeMessage('? r help', { guildId: 'guildA' })), false);
    assert.equal(await svc().handleMessage(makeMessage('! r help', { guildId: 'guildB' })), false);
  });

  it('keeps reminder commands working after the prefix changes', async () => {
    const { updateGuildSettings, getGuildSettings } = require('../src/utils/storage');
    const { templateId } = await makeTemplate();
    updateGuildSettings('guild1', s => ({ ...s, prefix: 'lucy' }));
    assert.equal(getGuildSettings('guild1').prefix, 'lucy');
    const after = makeMessage('lucy r templates', { userId: 'dev1', dev: true });
    assert.equal(await svc().handleMessage(after), true);
    assert.match(textOf(after), new RegExp(templateId));
  });

  it('ignores unrelated messages and other bots', async () => {
    assert.equal(await svc().handleMessage(makeMessage('d bos status')), false);
    const bot = makeMessage('d r help');
    bot.author.bot = true;
    assert.equal(await svc().handleMessage(bot), false);
  });
});

describe('custom reminder — developer authorization', () => {
  it('lets only the existing developer ID create templates and award reminders', async () => {
    const denied = makeMessage('d r create Nakal | x', { userId: 'user9' });
    await svc().handleMessage(denied);
    assert.match(textOf(denied), /Hanya developer bot/);
    assert.equal(storage().listTemplates().length, 0);

    const dev = makeMessage('d r create Sah | y', { userId: 'dev1', dev: true });
    await svc().handleMessage(dev);
    assert.equal(storage().listTemplates().length, 1);

    // Penerima biasa tidak bisa memberi reminder ke dirinya sendiri.
    const selfGive = makeMessage('d r give <@user9> ' + idOf(dev, 'T'), { userId: 'user9' });
    await svc().handleMessage(selfGive);
    assert.match(textOf(selfGive), /Hanya developer bot/);
    assert.equal(storage().listAwards().length, 0);
  });

  it('honours DEVELOPER_IDS and the guild owner, not server roles or names', async () => {
    process.env.DEVELOPER_IDS = 'envdev';
    assert.equal(await svc().handleMessage(makeMessage('d r create A | x', { userId: 'envdev' })), true);
    const admin = makeMessage('d r create B | y', { userId: 'user1', admin: true });
    await svc().handleMessage(admin);
    assert.match(textOf(admin), /Hanya developer bot/);
    assert.equal(await svc().handleMessage(makeMessage('d r create C | z', { userId: 'user1', guildOwner: true })), true);
  });

  it('rejects unknown subcommands with a helpful message', async () => {
    const message = makeMessage('d r tidakada');
    await svc().handleMessage(message);
    assert.match(textOf(message), /Subperintah tidak dikenal/);
  });
});

describe('custom reminder — award and redeem flow', () => {
  it('awards a reminder once and DMs the recipient the claim ID', async () => {
    const { templateId } = await makeTemplate();
    const give = makeMessage('d r give <@111222333444555666> ' + templateId, { userId: 'dev1', dev: true });
    await svc().handleMessage(give);
    const claimId = idOf(give, 'C');
    assert.ok(claimId);
    assert.equal(give.dms.length, 1, 'DM instruksi terkirim');
    assert.match(give.dms[0].content, new RegExp(claimId));
    assert.match(give.dms[0].content, /r redeem/);
    const award = storage().getAward(claimId);
    assert.equal(award.recipientId, '111222333444555666');
    assert.equal(award.issuerId, 'dev1', 'developer penerbit tercatat');
    assert.equal(award.status, 'pending');
  });

  it('does not duplicate a manual award for the same template and recipient', async () => {
    const { templateId } = await makeTemplate();
    await svc().handleMessage(makeMessage('d r give <@111222333444555666> ' + templateId, { userId: 'dev1', dev: true }));
    const second = makeMessage('d r give <@111222333444555666> ' + templateId, { userId: 'dev1', dev: true });
    await svc().handleMessage(second);
    assert.match(textOf(second), /sudah ada/);
    assert.equal(storage().listAwards({ recipientId: '111222333444555666' }).length, 1);
  });

  it('awards a reminder exactly once when the same source event is replayed', async () => {
    const { templateId } = await makeTemplate();
    const args = { templateId, recipientId: '111222333444555666', source: 'giveaway', sourceRef: 'GW-1' };
    const first = svc().awardReminder(args);
    const second = svc().awardReminder(args);
    assert.equal(first.created, true);
    assert.equal(second.created, false, 'event kedua tidak membuat award baru');
    assert.equal(second.award.claimId, first.award.claimId);
    assert.equal(storage().listAwards({ recipientId: '111222333444555666' }).length, 1);
  });

  it('handles duplicate giveaway completion events through the giveaway hook', async () => {
    const { templateId } = await makeTemplate();
    const client = makeMessage('d r help').client;
    const payload = { client, guildId: 'guild1', giveawayId: 'GW-9', winnerId: '111222333444555666', templateId };
    const a = await svc().onGiveawayWinner(payload);
    const b = await svc().onGiveawayWinner(payload);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(storage().listAwards({ recipientId: '111222333444555666' }).length, 1);
  });

  it('redeems a claim into an owned reminder and refuses duplicates', async () => {
    const { claimId, reminderId } = await awardAndRedeem();
    assert.ok(reminderId, 'reminder dibuat saat redeem');
    assert.equal(storage().getAward(claimId).status, 'redeemed');
    assert.equal(storage().getReminder(reminderId).ownerId, '111222333444555666');

    const again = makeMessage('d r redeem ' + claimId, { userId: '111222333444555666' });
    await svc().handleMessage(again);
    assert.match(textOf(again), /sudah diklaim/);
    assert.equal(storage().listRemindersByOwner('111222333444555666').length, 1);
  });

  it('only lets the assigned recipient redeem, and refuses revoked or expired awards', async () => {
    const { templateId } = await makeTemplate();
    const give = makeMessage('d r give <@111222333444555666> ' + templateId, { userId: 'dev1', dev: true });
    await svc().handleMessage(give);
    const claimId = idOf(give, 'C');

    const wrong = makeMessage('d r redeem ' + claimId, { userId: '999888777666555444' });
    await svc().handleMessage(wrong);
    assert.match(textOf(wrong), /bukan milikmu/);
    assert.equal(storage().getAward(claimId).status, 'pending');

    storage().revokeAward({ claimId, actorId: 'dev1' });
    const revoked = makeMessage('d r redeem ' + claimId, { userId: '111222333444555666' });
    await svc().handleMessage(revoked);
    assert.match(textOf(revoked), /sudah dicabut/);

    const expired = svc().awardReminder({ templateId, recipientId: '111222333444555666', source: 'giveaway', sourceRef: 'GW-X', expiresAt: Date.now() - 1000 });
    const late = makeMessage('d r redeem ' + expired.award.claimId, { userId: '111222333444555666' });
    await svc().handleMessage(late);
    assert.match(textOf(late), /kedaluwarsa/);
  });

  it('tells the developer when the DM cannot be delivered', async () => {
    const { templateId } = await makeTemplate();
    const give = makeMessage('d r give <@111222333444555666> ' + templateId, { userId: 'dev1', dev: true, dmFails: true });
    await svc().handleMessage(give);
    assert.match(textOf(give), /DM gagal/);
    assert.match(textOf(give), new RegExp(idOf(give, 'C')), 'claim ID tetap diberikan');
  });

  it('rejects malformed IDs and unknown templates', async () => {
    const badClaim = makeMessage('d r redeem NOPE');
    await svc().handleMessage(badClaim);
    assert.match(textOf(badClaim), /Format claim ID/);

    const give = makeMessage('d r give <@111222333444555666> T-XXXXXX', { userId: 'dev1', dev: true });
    await svc().handleMessage(give);
    assert.match(textOf(give), /tidak ditemukan/);
  });

  it('exposes the award list with claim statuses to developers only', async () => {
    const { claimId } = await awardAndRedeem();
    const list = makeMessage('d r awards', { userId: 'dev1', dev: true });
    await svc().handleMessage(list);
    assert.match(textOf(list), new RegExp(claimId));
    assert.match(textOf(list), /redeemed/);

    const denied = makeMessage('d r awards', { userId: 'user9' });
    await svc().handleMessage(denied);
    assert.match(textOf(denied), /Hanya developer bot/);
  });
});

describe('custom reminder — ownership and permissions', () => {
  it('refuses edits by anyone other than the owner', async () => {
    const { reminderId } = await awardAndRedeem();
    const other = makeMessage('d r update ' + reminderId + ' diretas', { userId: 'user9' });
    await svc().handleMessage(other);
    assert.match(textOf(other), /hanya bisa mengubah reminder milikmu/);
    assert.equal(storage().getReminder(reminderId).message, 'Halo {USER}');
  });

  it('blocks non-owners from embed, collectible, enable and reset too', async () => {
    const { reminderId } = await awardAndRedeem();
    for (const command of [
      'd r embed ' + reminderId + ' {"title":"x"}',
      'd r setcollectible ' + reminderId + ' rare',
      'd r enable ' + reminderId,
      'd r reset ' + reminderId
    ]) {
      const message = makeMessage(command, { userId: 'user9' });
      await svc().handleMessage(message);
      assert.match(textOf(message), /bukan milikmu|hanya bisa|Hanya pemilik/, command);
    }
    assert.equal(storage().getReminder(reminderId).active, false);
    assert.equal(storage().getReminder(reminderId).collectible, null);
  });

  it('transfers ownership only after confirmation and revokes the old owner', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    const target = '999888777666555444';

    const send = makeMessage('d r send <@' + target + '> ' + reminderId, { userId: owner });
    await svc().handleMessage(send);
    assert.match(textOf(send), /memindahkan kepemilikan/);
    assert.equal(storage().getReminder(reminderId).ownerId, owner, 'belum berpindah sebelum konfirmasi');

    const confirm = makeMessage('d r confirm', { userId: owner });
    await svc().handleMessage(confirm);
    assert.equal(storage().getReminder(reminderId).ownerId, target);

    const oldOwner = makeMessage('d r update ' + reminderId + ' masih bisa?', { userId: owner });
    await svc().handleMessage(oldOwner);
    assert.match(textOf(oldOwner), /hanya bisa mengubah reminder milikmu/);
    assert.equal(storage().getReminder(reminderId).message, 'Halo {USER}');
  });

  it('lets a cancelled transfer leave ownership untouched', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    await svc().handleMessage(makeMessage('d r send <@999888777666555444> ' + reminderId, { userId: owner }));
    await svc().handleMessage(makeMessage('d r cancel', { userId: owner }));
    assert.equal(storage().getReminder(reminderId).ownerId, owner);
  });

  it('keeps ownership and award state after a restart', async () => {
    const { reminderId, claimId } = await awardAndRedeem();
    await svc().handleMessage(makeMessage('d r enable ' + reminderId, { userId: '111222333444555666' }));
    resetModules();
    assert.equal(storage().getReminder(reminderId).ownerId, '111222333444555666');
    assert.equal(storage().getReminder(reminderId).active, true);
    assert.equal(storage().getAward(claimId).status, 'redeemed');
  });

  it('records an audit trail for awards and transfers', async () => {
    const { reminderId, claimId } = await awardAndRedeem();
    await svc().handleMessage(makeMessage('d r send <@999888777666555444> ' + reminderId, { userId: '111222333444555666' }));
    await svc().handleMessage(makeMessage('d r confirm', { userId: '111222333444555666' }));
    const actions = storage().listAudit({ reminderId }).map(a => a.action);
    assert.ok(actions.includes('reminder_transfer'));
    const awardAudit = storage().listAudit({ claimId }).map(a => a.action);
    assert.ok(awardAudit.includes('award_create'));
    assert.ok(awardAudit.includes('award_redeem'));
  });
});

describe('custom reminder — customization commands', () => {
  it('updates the message and resets to template defaults with confirmation', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    await svc().handleMessage(makeMessage('d r update ' + reminderId + ' Pesan baru {USER}', { userId: owner }));
    assert.equal(storage().getReminder(reminderId).message, 'Pesan baru {USER}');

    await svc().handleMessage(makeMessage('d r setcollectible ' + reminderId + ' epic', { userId: owner }));
    assert.equal(storage().getReminder(reminderId).collectible, 'epic');

    const reset = makeMessage('d r reset ' + reminderId, { userId: owner });
    await svc().handleMessage(reset);
    assert.match(textOf(reset), /akan mengembalikan/);
    assert.equal(storage().getReminder(reminderId).message, 'Pesan baru {USER}', 'belum berubah sebelum konfirmasi');

    await svc().handleMessage(makeMessage('d r confirm', { userId: owner }));
    const reminder = storage().getReminder(reminderId);
    assert.equal(reminder.message, 'Halo {USER}', 'kembali ke bawaan template');
    assert.equal(reminder.collectible, null);
  });

  it('validates collectible values and lists supported ones', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    const bad = makeMessage('d r setcollectible ' + reminderId + ' tier_dewa', { userId: owner });
    await svc().handleMessage(bad);
    assert.match(textOf(bad), /tidak dikenal/);
    assert.match(textOf(bad), /legendary/, 'menyebut pilihan yang didukung');
    assert.equal(storage().getReminder(reminderId).collectible, null);
  });

  it('honours per-guild extra collectibles from configuration', async () => {
    const { updateGuildSettings } = require('../src/utils/storage');
    const { reminderId } = await awardAndRedeem();
    updateGuildSettings('guild1', s => ({ ...s, reminders: { ...s.reminders, collectibles: ['event_khusus'] } }));
    const ok = makeMessage('d r setcollectible ' + reminderId + ' event_khusus', { userId: '111222333444555666' });
    await svc().handleMessage(ok);
    assert.match(textOf(ok), /event_khusus/);
    assert.equal(storage().getReminder(reminderId).collectible, 'event_khusus');
  });

  it('enables and disables reminders and lists active ones', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    await svc().handleMessage(makeMessage('d r enable ' + reminderId, { userId: owner }));
    assert.equal(storage().getReminder(reminderId).active, true);
    assert.ok(storage().getReminder(reminderId).activatedAt, 'waktu aktivasi tercatat');
    const active = makeMessage('d r active', { userId: owner });
    await svc().handleMessage(active);
    assert.match(textOf(active), new RegExp(reminderId));

    await svc().handleMessage(makeMessage('d r disable ' + reminderId, { userId: owner }));
    assert.equal(storage().getReminder(reminderId).active, false);
  });

  it('shows inventory, view and info for the owner', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    const inventory = makeMessage('d r inventory', { userId: owner });
    await svc().handleMessage(inventory);
    assert.match(textOf(inventory), new RegExp(reminderId));

    const view = makeMessage('d r view ' + reminderId, { userId: owner });
    await svc().handleMessage(view);
    const embed = view.sent.at(-1).embeds[0].data;
    assert.match(embed.description, /<@111222333444555666>/, 'variabel USER ter-render');

    const info = makeMessage('d r info ' + reminderId, { userId: owner });
    await svc().handleMessage(info);
    assert.match(textOf(info), /Pemilik/);
    assert.match(textOf(info), /template/);
  });

  it('keeps view and info away from non-owners', async () => {
    const { reminderId } = await awardAndRedeem();
    const view = makeMessage('d r view ' + reminderId, { userId: 'user9' });
    await svc().handleMessage(view);
    assert.match(textOf(view), /bukan milikmu/);
  });
});

describe('custom reminder — embed validation', () => {
  it('rejects invalid JSON with an actionable error', async () => {
    const { reminderId } = await awardAndRedeem();
    const message = makeMessage('d r embed ' + reminderId + ' {bukan json}', { userId: '111222333444555666' });
    await svc().handleMessage(message);
    assert.match(textOf(message), /JSON tidak valid/);
    assert.equal(storage().getReminder(reminderId).embed, null);
  });

  it('rejects unsafe URL schemes and unknown fields', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    const evil = makeMessage('d r embed ' + reminderId + ' {"title":"x","url":"javascript:alert(1)"}', { userId: owner });
    await svc().handleMessage(evil);
    assert.match(textOf(evil), /url harus URL https/);

    const unknown = makeMessage('d r embed ' + reminderId + ' {"title":"x","webhook":"https://evil.example"}', { userId: owner });
    await svc().handleMessage(unknown);
    assert.match(textOf(unknown), /Field tidak dikenal/);
    assert.equal(storage().getReminder(reminderId).embed, null);
  });

  it('accepts a valid embed and stores it normalized', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    const message = makeMessage('d r embed ' + reminderId + ' {"title":"Halo","color":"#ff0000","footer":{"text":"{SERVER_NAME}"}}', { userId: owner });
    await svc().handleMessage(message);
    assert.match(textOf(message), /tersimpan/);
    const embed = storage().getReminder(reminderId).embed;
    assert.equal(embed.color, 0xff0000, 'hex dinormalkan ke integer');
  });

  it('enforces Discord embed limits', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    const tooLong = makeMessage('d r embed ' + reminderId + ' {"title":"' + 'x'.repeat(300) + '"}', { userId: owner });
    await svc().handleMessage(tooLong);
    assert.match(textOf(tooLong), /melebihi 256/);

    const tooMany = makeMessage('d r embed ' + reminderId + ' {"fields":' + JSON.stringify(Array.from({ length: 26 }, (_, i) => ({ name: 'n' + i, value: 'v' }))) + '}', { userId: owner });
    await svc().handleMessage(tooMany);
    assert.match(textOf(tooMany), /maksimal 25/);
    assert.equal(storage().getReminder(reminderId).embed, null);
  });
});

describe('custom reminder — Tenor utility', () => {
  it('accepts direct media.tenor.com URLs', async () => {
    const { resolveTenor } = require('../src/utils/reminderValidate');
    const result = await resolveTenor('https://media.tenor.com/abc/xyz.gif');
    assert.equal(result.ok, true);
    assert.equal(result.value, 'https://media.tenor.com/abc/xyz.gif');
  });

  it('rejects unsafe schemes and non-Tenor hosts', async () => {
    const { resolveTenor } = require('../src/utils/reminderValidate');
    assert.equal((await resolveTenor('javascript:alert(1)')).ok, false);
    assert.equal((await resolveTenor('http://media.tenor.com/a.gif')).ok, false);
    assert.equal((await resolveTenor('https://evil.example/x.gif')).ok, false);
    assert.equal((await resolveTenor('https://media.tenor.com/a.txt')).ok, false);
  });

  it('resolves a Tenor view page through an injected fetch', async () => {
    const { resolveTenor } = require('../src/utils/reminderValidate');
    const fetchFn = async () => ({ ok: true, text: async () => '<meta property="og:image" content="https://media.tenor.com/ZZZ/abc.gif">' });
    const result = await resolveTenor('https://tenor.com/view/something-123', { fetchFn });
    assert.equal(result.ok, true);
    assert.equal(result.value, 'https://media.tenor.com/ZZZ/abc.gif');

    const failing = await resolveTenor('https://tenor.com/view/x', { fetchFn: async () => ({ ok: false, status: 404 }) });
    assert.equal(failing.ok, false);
  });
});

describe('custom reminder — variables', () => {
  const variables = () => require('../src/utils/reminderVariables');

  it('resolves every user variable and falls back when data is missing', () => {
    const context = variables().createRenderContext({
      user: {
        id: '123', name: 'ani', displayName: 'Ani', nickname: 'Ani N', mention: '<@123>',
        avatarUrl: 'https://cdn.discordapp.com/avatars/123/x.png',
        serverAvatarUrl: 'https://cdn.discordapp.com/guilds/1/users/123/avatars/y.png'
      },
      guild: { name: 'Guild Satu', iconUrl: 'https://cdn.discordapp.com/icons/1/a.png' }
    });
    assert.equal(variables().render('{USER}', context), '<@123>');
    assert.equal(variables().render('{USER_ID}', context), '123');
    assert.equal(variables().render('{USER_NAME}', context), 'ani');
    assert.equal(variables().render('{USER_DISPLAYNAME}', context), 'Ani');
    assert.equal(variables().render('{USER_NICKNAME}', context), 'Ani N');
    assert.match(variables().render('{USER_AVATAR}', context), /^https:\/\/cdn\.discordapp\.com/);
    assert.match(variables().render('{USER_SERVERAVATAR}', context), /^https:\/\/cdn\.discordapp\.com/);

    const empty = variables().createRenderContext({ user: { id: '1' } });
    assert.equal(variables().render('{USER_NICKNAME}', empty), variables().FALLBACK);
    assert.equal(variables().render('{USER_AVATAR}', empty), variables().FALLBACK);
    assert.equal(variables().render('{SERVER_ICON}', empty), variables().FALLBACK);
    assert.equal(variables().render('{SERVER_NAME}', empty), variables().FALLBACK);
  });

  it('rejects non-Discord avatar URLs', () => {
    const context = variables().createRenderContext({ user: { id: '1', avatarUrl: 'https://evil.example/x.png' } });
    assert.equal(variables().render('{USER_AVATAR}', context), variables().FALLBACK);
  });

  it('resolves random and time variables consistently within one render', () => {
    const context = variables().createRenderContext({ user: { id: '1' } });
    const out = variables().render('{EMOJI} {EMOJI} {FLAG}', context);
    const [emojiA, emojiB] = out.split(' ');
    assert.equal(emojiA, emojiB, 'emoji sama dalam satu render');

    const time = variables().render('{TIME} {DAILY} {DAILY_TOMORROW} {DAILY_YESTERDAY}', context);
    const [now, daily, tomorrow, yesterday] = time.split(' ').map(Number);
    assert.ok(Number.isFinite(now) && Number.isFinite(daily));
    assert.equal(daily - yesterday, 86400, 'selisih harian tepat 1 hari');
    assert.equal(tomorrow - daily, 86400);
    assert.match(variables().render('<t:{DAILY_TOMORROW}:R>', context), /^<t:\d+:R>$/);
  });

  it('falls back for goal variables when the target system is off', () => {
    const context = variables().createRenderContext({ guildId: 'guild1', user: { id: '1' } });
    assert.equal(context.goal.available, false);
    assert.equal(variables().render('{GOAL}', context), variables().FALLBACK);
    assert.equal(variables().render('{GOAL_PROGRESS}', context), variables().FALLBACK);
    assert.equal(variables().render('{GOAL_PROGRESS_INVERTED}', context), variables().FALLBACK);
    assert.equal(variables().render('{GOAL_END}', context), variables().FALLBACK);
  });

  it('reads goal values from the existing Lucy target system when enabled', () => {
    const { updateGuildSettings, getGuildSettings } = require('../src/utils/storage');
    updateGuildSettings('guild1', s => ({ ...s, lucyCounter: { ...s.lucyCounter, targetEnabled: true, targetGoal: 10 } }));
    const lucyStore = require('../src/utils/lucyCounterStorage');
    const { dayKey, challengeCycleKey } = require('../src/services/lucyCounter');
    const cycle = challengeCycleKey(new Date(), getGuildSettings('guild1').lucyCounter);
    lucyStore.recordLucy({ guildId: 'guild1', userId: 'user1', name: 'Ani', day: dayKey(), cycleKey: cycle, targetActive: true, goal: 10 });
    lucyStore.recordLucy({ guildId: 'guild1', userId: 'user1', name: 'Ani', day: dayKey(), cycleKey: cycle, targetActive: true, goal: 10 });

    const context = variables().createRenderContext({ guildId: 'guild1', user: { id: 'user1' } });
    assert.equal(context.goal.available, true);
    assert.equal(context.goal.progress, 2);
    assert.equal(variables().render('{GOAL}', context), '10');
    assert.equal(variables().render('{GOAL_PROGRESS}', context), '2');
    assert.equal(variables().render('{GOAL_PROGRESS_INVERTED}', context), '8');
    assert.equal(variables().render('{GOAL_END}', context), '10');
  });

  it('leaves unknown variables untouched and prevents recursive expansion', () => {
    const context = variables().createRenderContext({ user: { id: '1', name: 'ani' } });
    assert.equal(variables().render('{TIDAK_ADA}', context), '{TIDAK_ADA}');
    assert.deepEqual(variables().unknownVariables('{TIDAK_ADA} {USER}'), ['TIDAK_ADA']);
    const injected = variables().createRenderContext({ user: { id: '1', name: '{USER}' } });
    assert.equal(variables().render('{USER_NAME}', injected), '{USER}');
  });

  it('caps excessive output length', () => {
    const context = variables().createRenderContext({ user: { id: '1' } });
    const long = variables().render('{EMOJI}'.repeat(3000), context);
    assert.ok(long.length <= variables().MAX_OUTPUT_LENGTH);
  });

  it('interpolates embed text fields but not structural values', () => {
    const context = variables().createRenderContext({ user: { id: '1', mention: '<@1>' }, guild: { name: 'G' } });
    const embed = variables().renderEmbed({
      title: 'Halo {USER}', description: '{SERVER_NAME}',
      footer: { text: '{USER}' }, author: { name: '{USER}' },
      fields: [{ name: '{USER}', value: '{SERVER_NAME}' }],
      color: 0x123456, url: 'https://example.com/{USER}'
    }, context);
    assert.equal(embed.title, 'Halo <@1>');
    assert.equal(embed.description, 'G');
    assert.equal(embed.footer.text, '<@1>');
    assert.equal(embed.author.name, '<@1>');
    assert.equal(embed.fields[0].name, '<@1>');
    assert.equal(embed.color, 0x123456, 'nilai non-teks tidak diubah');
    assert.equal(embed.url, 'https://example.com/{USER}', 'url tidak diinterpolasi');
  });

  it('documents every variable in the reference', () => {
    const reference = variables().variableReference();
    const names = reference.map(r => r.name.replace(/[{}]/g, ''));
    assert.deepEqual(names.sort(), variables().VARIABLE_NAMES.slice().sort());
    for (const item of reference) assert.ok(item.description && item.description.length > 3, item.name);
  });
});

describe('custom reminder — runtime delivery', () => {
  function runtimeClient(sent) {
    return {
      channels: { fetch: async () => ({ send: async payload => { sent.push(payload); } }) },
      guilds: { cache: new Map([['guild1', { name: 'Guild Satu', iconURL: () => null }]]) },
      users: { fetch: async id => ({ id, username: 'ani', displayAvatarURL: () => null }) }
    };
  }

  it('delivers active reminders to the activity channel', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    await svc().handleMessage(makeMessage('d r enable ' + reminderId, { userId: owner }));

    const sent = [];
    const result = await svc().deliverForActivity({ client: runtimeClient(sent), guildId: 'guild1', userId: owner, channelId: 'chan1' });
    assert.equal(result.delivered, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /<@111222333444555666>/);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] }, 'tidak bisa mention massal');
  });

  it('respects the delivery cooldown and skips when nothing is active', async () => {
    const { reminderId } = await awardAndRedeem();
    const owner = '111222333444555666';
    await svc().handleMessage(makeMessage('d r enable ' + reminderId, { userId: owner }));
    const sent = [];
    const client = runtimeClient(sent);
    await svc().deliverForActivity({ client, guildId: 'guild1', userId: owner, channelId: 'chan1' });
    const second = await svc().deliverForActivity({ client, guildId: 'guild1', userId: owner, channelId: 'chan1' });
    assert.equal(second.delivered, 0);
    assert.equal(second.skipped, 'cooldown');
    assert.equal(sent.length, 1, 'tidak spam');

    const other = await svc().deliverForActivity({ client, guildId: 'guild1', userId: 'user9', channelId: 'chan1' });
    assert.equal(other.skipped, 'none', 'pengguna tanpa reminder dilewati');
  });

  it('fails gracefully when the channel, user or client is unavailable', async () => {
    const noClient = await svc().deliverForActivity({ client: null, guildId: 'guild1', userId: 'user1' });
    assert.equal(noClient.skipped, 'invalid');

    const { reminderId } = await awardAndRedeem();
    await svc().handleMessage(makeMessage('d r enable ' + reminderId, { userId: '111222333444555666' }));

    const noChannel = await svc().deliverForActivity({
      client: { channels: { fetch: async () => null }, guilds: { cache: new Map() }, users: { fetch: async () => null } },
      guildId: 'guild1', userId: '111222333444555666', channelId: 'chan1'
    });
    assert.equal(noChannel.delivered, 0);

    const noUser = await svc().deliverForActivity({
      client: {
        channels: { fetch: async () => ({ send: async () => {} }) },
        guilds: { cache: new Map() },
        users: { fetch: async () => { throw new Error('Unknown User'); } }
      },
      guildId: 'guild1', userId: '111222333444555666', channelId: 'chan1'
    });
    assert.equal(noUser.delivered, 0);
    assert.equal(noUser.skipped, 'no-user');
  });
});

describe('custom reminder — storage schema and IDs', () => {
  it('creates the schema with a version marker and validates IDs', () => {
    const store = storage();
    store.getDb();
    assert.ok(store.SCHEMA_VERSION);
    assert.equal(store.isValidTemplateId('T-ABC123'), true);
    assert.equal(store.isValidTemplateId('R-ABC123'), false);
    assert.equal(store.isValidClaimId('C-ABC123'), true);
    assert.equal(store.isValidReminderId('R-ABC123'), true);
    assert.equal(store.isValidReminderId('X-ABC123'), false);
    assert.equal(store.isValidUserId('123'), false);
    assert.equal(store.isValidUserId('111222333444555666'), true);
  });

  it('keeps template, claim and reminder IDs distinct', async () => {
    const { templateId, claimId, reminderId } = await awardAndRedeem();
    assert.match(templateId, /^T-/);
    assert.match(claimId, /^C-/);
    assert.match(reminderId, /^R-/);
    assert.notEqual(templateId, claimId);
    assert.notEqual(claimId, reminderId);
  });

  it('persists templates across a restart', async () => {
    const { templateId } = await makeTemplate('Tetap Ada', 'Isi {USER}');
    resetModules();
    const template = storage().getTemplate(templateId);
    assert.equal(template.name, 'Tetap Ada');
    assert.equal(template.message, 'Isi {USER}');
  });

  it('never lets a user gain developer power through names or arguments', async () => {
    const spoof = makeMessage('d r create X | y', { userId: '999888777666555444', name: 'dev1' });
    await svc().handleMessage(spoof);
    assert.match(textOf(spoof), /Hanya developer bot/);
    assert.equal(storage().listTemplates().length, 0);
  });
});
