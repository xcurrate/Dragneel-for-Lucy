const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const steal = require(path.join(ROOT, 'src/commands/steal'));
const { parsePrefixInput } = require(path.join(ROOT, 'src/commands/prefix'));

function makeGuild() {
  const calls = { emoji: [], sticker: [] };
  return {
    calls,
    id: 'guild-1',
    ownerId: 'owner-1',
    emojis: {
      cache: new Map(),
      create: async options => {
        calls.emoji.push(options);
        return { id: 'emoji-created', name: options.name };
      },
    },
    stickers: {
      create: async options => {
        calls.sticker.push(options);
        return { id: 'sticker-created', name: options.name };
      },
    },
  };
}

function makeMessage(overrides = {}) {
  const guild = overrides.guild || makeGuild();
  return {
    guildId: 'guild-1',
    guild,
    author: { id: 'dev-1', bot: false },
    content: 'd steal',
    member: { permissions: { has: () => false } },
    client: { rest: { get: async () => null } },
    reply: async () => {},
    ...overrides,
    guild,
  };
}

function capture() {
  const calls = [];
  return {
    calls,
    send: async (_message, payload) => { calls.push(payload); },
  };
}

function buttonIds(payload) {
  return payload.components[0].toJSON().components;
}

function makeButtonInteraction(customId, guild, user = { id: 'dev-1' }) {
  const interaction = {
    customId,
    user,
    guild,
    guildId: guild.id,
    client: {},
    reply: async payload => { interaction.replied = payload; },
    update: async payload => { interaction.updated = payload; },
  };
  return interaction;
}

const download = async () => Buffer.from('asset');

test('parse emoji token dan nama aman', () => {
  assert.deepEqual(steal.parseEmojiToken('<a:party_parrot:123456789012345678>'), {
    animated: true, name: 'party_parrot', id: '123456789012345678',
  });
  assert.equal(steal.parseEmojiToken('<:party:123456789012345678>').animated, false);
  assert.equal(steal.parseEmojiToken('bukan emoji'), null);
  assert.deepEqual(steal.emojisFromContent('<:a:123456789012345678> <a:b:223456789012345678> <:a:123456789012345678>'), [
    { animated: false, name: 'a', id: '123456789012345678' },
    { animated: true, name: 'b', id: '223456789012345678' },
  ]);
  assert.equal(steal.safeEmojiName('party parrot', '123'), 'party_parrot');
  assert.ok(steal.safeEmojiName('x', '123456789012345678').length >= 2);
});

test('steal emoji ditolak untuk non-developer', async () => {
  const guild = makeGuild();
  const message = makeMessage({ guild });
  const out = capture();
  await steal.handleStealCommand(message, ['emoji', '<:party:123456789012345678>'], 'd', {
    send: out.send,
    isDeveloper: () => false,
  });
  assert.equal(guild.calls.emoji.length, 0);
  assert.match(out.calls[0].embeds[0].toJSON().description, /developer/);
});

test('steal emoji membuka panel dengan navigasi, simpan, dan download', async () => {
  const guild = makeGuild();
  const message = makeMessage({ guild });
  const out = capture();
  await steal.handleStealCommand(message, [
    'emoji',
    '<a:party_parrot:123456789012345678>',
    '<:second:223456789012345678>',
  ], 'd', {
    send: out.send,
    isDeveloper: () => true,
  });

  assert.equal(guild.calls.emoji.length, 0, 'belum membuat emoji sebelum tombol Simpan');
  const payload = out.calls[0];
  assert.match(payload.embeds[0].toJSON().title, /Steal Emoji/);
  assert.match(payload.embeds[0].toJSON().description, /1\/2/);

  const buttons = buttonIds(payload);
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].disabled, true, 'previous nonaktif di emoji pertama');
  assert.equal(buttons[1].disabled, false);
  assert.match(buttons[2].label, /Simpan/);
  assert.match(buttons[3].label, /Download/);

  const next = makeButtonInteraction(buttons[1].custom_id, guild);
  await steal.handleStealPanelButton(next, { isDeveloper: () => true });
  assert.match(next.updated.embeds[0].toJSON().description, /2\/2/);

  const save = makeButtonInteraction(buttonIds(next.updated)[2].custom_id, guild);
  await steal.handleStealPanelButton(save, {
    isDeveloper: () => true,
    download,
  });
  assert.equal(guild.calls.emoji.length, 1);
  assert.equal(guild.calls.emoji[0].name, 'second');
  assert.match(save.updated.content, /ditambahkan/);
  assert.match(save.updated.embeds[0].toJSON().fields[0].value, /Sudah disimpan/);

  const prev = makeButtonInteraction(buttonIds(save.updated)[0].custom_id, guild);
  await steal.handleStealPanelButton(prev, { isDeveloper: () => true });
  assert.match(prev.updated.embeds[0].toJSON().description, /1\/2/);

  const downloadButton = makeButtonInteraction(buttonIds(prev.updated)[3].custom_id, guild);
  let downloaded = null;
  await steal.handleStealPanelButton(downloadButton, {
    isDeveloper: () => true,
    download: async url => { downloaded = url; return Buffer.from('asset'); },
  });
  assert.match(downloaded, /emojis\/123456789012345678\.gif/);
  assert.equal(downloadButton.replied.files.length, 1);
  assert.match(downloadButton.replied.content, /party_parrot/);
});

test('steal emoji dari balasan mengambil semua emoji custom', async () => {
  const guild = makeGuild();
  const message = makeMessage({
    guild,
    reference: { messageId: 'message-1' },
    fetchReference: async () => ({
      content: '<:first:123456789012345678> dan <a:second:223456789012345678>',
    }),
  });
  const out = capture();
  await steal.handleStealCommand(message, ['emoji'], 'd', {
    send: out.send,
    isDeveloper: () => true,
  });
  const payload = out.calls[0];
  assert.match(payload.embeds[0].toJSON().description, /1\/2/);
  assert.equal(buttonIds(payload)[1].disabled, false);
});

test('panel steal emoji hanya bisa dipakai pemiliknya', async () => {
  const guild = makeGuild();
  const message = makeMessage({ guild });
  const out = capture();
  await steal.handleStealCommand(message, ['emoji', '<:party:123456789012345678>'], 'd', {
    send: out.send,
    isDeveloper: () => true,
  });
  const saveId = buttonIds(out.calls[0])[2].custom_id;
  const other = makeButtonInteraction(saveId, guild, { id: 'user-2' });
  await steal.handleStealPanelButton(other, { isDeveloper: () => true, download });
  assert.match(other.replied.content, /bukan milikmu|kedaluwarsa/);
  assert.equal(guild.calls.emoji.length, 0);
});

test('steal sticker dari pesan yang dibalas', async () => {
  const guild = makeGuild();
  const sticker = {
    id: 'sticker-1',
    name: 'Kucing Lucu',
    tags: 'kucing',
    description: 'sticker kucing',
    url: 'https://cdn.discordapp.com/stickers/1.png',
  };
  const message = makeMessage({
    guild,
    reference: { messageId: 'message-1' },
    fetchReference: async () => ({ stickers: { first: () => sticker } }),
  });
  const out = capture();
  await steal.handleStealCommand(message, ['sticker'], 'd', {
    send: out.send,
    isDeveloper: () => true,
    download,
  });
  assert.equal(guild.calls.sticker.length, 1);
  assert.equal(guild.calls.sticker[0].name, 'Kucing Lucu');
  assert.equal(guild.calls.sticker[0].tags, 'kucing');
  assert.match(out.calls[0].embeds[0].toJSON().title, /Sticker Berhasil/);
});

test('steal sticker menerima sticker ID lewat REST', async () => {
  const guild = makeGuild();
  const sticker = { id: '123456789012345678', name: 'Sticker REST', tags: 'tag', url: 'https://cdn.discordapp.com/stickers/2.png' };
  const message = makeMessage({
    guild,
    client: { rest: { get: async route => { assert.match(route, /123456789012345678/); return sticker; } } },
  });
  const out = capture();
  await steal.handleStealCommand(message, ['sticker', '123456789012345678'], 'd', {
    send: out.send,
    isDeveloper: () => true,
    download,
  });
  assert.equal(guild.calls.sticker.length, 1);
  assert.equal(guild.calls.sticker[0].name, 'Sticker REST');
});

test('format salah menampilkan panduan tanpa membuat aset', async () => {
  const guild = makeGuild();
  const message = makeMessage({ guild });
  const out = capture();
  await steal.handleStealCommand(message, ['emoji'], 'd', {
    send: out.send,
    isDeveloper: () => true,
    download,
  });
  assert.equal(guild.calls.emoji.length, 0);
  assert.match(out.calls[0].embeds[0].toJSON().description, /Format/);
});

test('prefix d steal dikenali', () => {
  const parsed = parsePrefixInput('d steal emoji <:party:123456789012345678>', 'd');
  assert.equal(parsed.sub, 'steal');
  assert.deepEqual(parsed.args, ['emoji', '<:party:123456789012345678>']);
});

test('slash steal menolak non-developer sebelum menyentuh guild', async () => {
  const guild = makeGuild();
  const interaction = {
    user: { id: 'user-1' },
    client: {},
    guild,
    options: { getSubcommand: () => 'emoji', getString: () => '<:party:123456789012345678>' },
    reply: async payload => { interaction.replied = payload; },
  };
  await steal.execute(interaction, { isDeveloper: () => false });
  assert.equal(guild.calls.emoji.length, 0);
  assert.match(interaction.replied.content, /developer/);
});

test('slash steal emoji membuka panel untuk developer', async () => {
  const guild = makeGuild();
  const interaction = {
    user: { id: 'dev-1' },
    client: {},
    guild,
    guildId: guild.id,
    options: { getSubcommand: () => 'emoji', getString: () => '<:party:123456789012345678>' },
    reply: async payload => { interaction.replied = payload; },
  };
  await steal.execute(interaction, {
    isDeveloper: () => true,
    download,
  });
  assert.equal(guild.calls.emoji.length, 0);
  assert.match(interaction.replied.embeds[0].toJSON().title, /Steal Emoji/);
  assert.equal(buttonIds(interaction.replied).length, 4);
});
