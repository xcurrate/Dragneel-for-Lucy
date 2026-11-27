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

const download = async () => Buffer.from('asset');

test('parse emoji token dan nama aman', () => {
  assert.deepEqual(steal.parseEmojiToken('<a:party_parrot:123456789012345678>'), {
    animated: true, name: 'party_parrot', id: '123456789012345678',
  });
  assert.equal(steal.parseEmojiToken('<:party:123456789012345678>').animated, false);
  assert.equal(steal.parseEmojiToken('bukan emoji'), null);
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

test('steal emoji mengunduh dan membuat emoji di guild', async () => {
  const guild = makeGuild();
  const message = makeMessage({ guild });
  const out = capture();
  let downloaded = null;
  await steal.handleStealCommand(message, ['emoji', '<a:party_parrot:123456789012345678>'], 'd', {
    send: out.send,
    isDeveloper: () => true,
    download: async url => { downloaded = url; return Buffer.from('asset'); },
  });
  assert.match(downloaded, /emojis\/123456789012345678\.gif/);
  assert.equal(guild.calls.emoji.length, 1);
  assert.equal(guild.calls.emoji[0].name, 'party_parrot');
  assert.equal(guild.calls.emoji[0].attachment.toString(), 'asset');
  assert.match(out.calls[0].embeds[0].toJSON().title, /Emoji Berhasil/);
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

test('slash steal emoji membuat aset untuk developer', async () => {
  const guild = makeGuild();
  const interaction = {
    user: { id: 'dev-1' },
    client: {},
    guild,
    options: { getSubcommand: () => 'emoji', getString: () => '<:party:123456789012345678>' },
    reply: async payload => { interaction.replied = payload; },
  };
  await steal.execute(interaction, {
    isDeveloper: () => true,
    download,
  });
  assert.equal(guild.calls.emoji.length, 1);
  assert.match(interaction.replied.embeds[0].toJSON().title, /Emoji Berhasil/);
});
