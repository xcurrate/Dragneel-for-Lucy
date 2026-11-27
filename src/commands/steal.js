const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, Routes,
} = require('discord.js');

const EMOJI_TOKEN = /<(a?):([A-Za-z0-9_]+):(\d{17,20})>/g;
const EMOJI_ID = /^\d{17,20}$/;
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;

function parseEmojiToken(value) {
  const match = String(value || '').trim().match(/^<(a?):([A-Za-z0-9_]+):(\d{17,20})>$/);
  if (!match) return null;
  return { animated: Boolean(match[1]), name: match[2], id: match[3] };
}

function emojiFromContent(content) {
  const found = [...String(content || '').matchAll(EMOJI_TOKEN)].map(match => ({
    animated: Boolean(match[1]), name: match[2], id: match[3],
  }));
  return found.length === 1 ? found[0] : null;
}

function safeEmojiName(name, id) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32);
  return cleaned.length >= 2 ? cleaned : ('e_' + id).slice(0, 32);
}

function safeStickerName(name, id) {
  const cleaned = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return cleaned.length >= 2 ? cleaned : ('sticker ' + id).slice(0, 30);
}

function emojiUrl(emoji) {
  return 'https://cdn.discordapp.com/emojis/' + emoji.id + '.' + (emoji.animated ? 'gif' : 'png') + '?size=128&quality=lossless';
}

async function defaultDownload(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Gagal mengunduh aset (HTTP ' + response.status + ').');
  return Buffer.from(await response.arrayBuffer());
}

async function stealEmoji({ guild, emoji, download = defaultDownload }) {
  if (!guild) throw new Error('Perintah ini hanya bisa dipakai di server.');
  const buffer = await download(emojiUrl(emoji));
  if (buffer.length > MAX_EMOJI_BYTES) throw new Error('Ukuran emoji melebihi batas 256 KB.');
  const name = safeEmojiName(emoji.name, emoji.id);
  const created = await guild.emojis.create({
    attachment: buffer,
    name,
    reason: 'Steal emoji oleh developer',
  });
  return { kind: 'emoji', name: created?.name || name, id: created?.id || null, animated: Boolean(emoji.animated) };
}

async function stealSticker({ guild, sticker, download = defaultDownload }) {
  if (!guild) throw new Error('Perintah ini hanya bisa dipakai di server.');
  if (!sticker?.url) throw new Error('Sticker ini tidak punya URL yang bisa diunduh.');
  const buffer = await download(sticker.url);
  if (buffer.length > MAX_STICKER_BYTES) throw new Error('Ukuran sticker melebihi batas 512 KB.');
  const name = safeStickerName(sticker.name, sticker.id || 'sticker');
  const tags = String(sticker.tags || sticker.name || 'sticker').slice(0, 200);
  const created = await guild.stickers.create({
    file: buffer,
    name,
    tags,
    description: String(sticker.description || '').slice(0, 200) || undefined,
    reason: 'Steal sticker oleh developer',
  });
  return { kind: 'sticker', name: created?.name || name, id: created?.id || null };
}

async function referencedMessage(message) {
  if (!message?.reference?.messageId) return null;
  if (typeof message.fetchReference === 'function') return message.fetchReference().catch(() => null);
  const fetchMessage = message.channel?.messages?.fetch;
  return fetchMessage ? fetchMessage.call(message.channel.messages, message.reference.messageId).catch(() => null) : null;
}

async function resolveEmoji(message, value) {
  const token = parseEmojiToken(value);
  if (token) return token;
  if (EMOJI_ID.test(String(value || '').trim())) {
    const id = String(value).trim();
    const cached = message.guild?.emojis?.cache?.get?.(id);
    if (cached) return { animated: Boolean(cached.animated), name: cached.name, id: cached.id };
    const fetchEmoji = message.guild?.emojis?.fetch;
    const fetched = fetchEmoji ? await fetchEmoji.call(message.guild.emojis, id).catch(() => null) : null;
    if (fetched) return { animated: Boolean(fetched.animated), name: fetched.name, id: fetched.id };
    throw new Error('Emoji tidak ditemukan. Kirim token emoji utuh, mis. `<:nama:123456789012345678>`.');
  }
  const reference = await referencedMessage(message);
  const fromReply = emojiFromContent(reference?.content);
  if (fromReply) return fromReply;
  throw new Error('Format: `steal emoji <emoji>` atau balas pesan yang berisi satu emoji custom.');
}

async function resolveSticker(message, value) {
  const trimmed = String(value || '').trim();
  if (trimmed) {
    if (!EMOJI_ID.test(trimmed)) throw new Error('Sticker ID harus berupa angka 17–20 digit.');
    const restGet = message.client?.rest?.get;
    const sticker = restGet ? await restGet.call(message.client.rest, Routes.sticker(trimmed)).catch(() => null) : null;
    if (!sticker) throw new Error('Sticker tidak ditemukan.');
    return sticker;
  }
  const reference = await referencedMessage(message);
  const sticker = reference?.stickers?.first?.() || message.stickers?.first?.();
  if (sticker) return sticker;
  throw new Error('Format: `steal sticker <sticker_id>` atau balas pesan yang berisi sticker.');
}

function resultEmbed(result) {
  const label = result.kind === 'emoji' ? 'Emoji' : 'Sticker';
  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ ' + label + ' Berhasil Diambil')
    .setDescription('**' + result.name + '**' + (result.id ? ' (`' + result.id + '`)' : '') + ' sudah ditambahkan ke server ini.');
}

async function handleStealCommand(message, args, prefix, deps = {}) {
  const send = deps.send || ((m, payload) => m.reply(payload));
  const isDeveloper = deps.isDeveloper || (() => false);
  if (!isDeveloper(message)) {
    return send(message, { embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Akses Ditolak').setDescription('Fitur steal emoji/sticker hanya untuk developer bot.')] });
  }
  if (!message.guild) {
    return send(message, { embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Gagal').setDescription('Perintah ini hanya bisa dipakai di server.')] });
  }
  const kind = String(args[0] || '').toLowerCase();
  const value = args.slice(1).join(' ').trim();
  try {
    let result;
    if (kind === 'emoji' || kind === 'emote') {
      const emoji = await resolveEmoji(message, value);
      result = await stealEmoji({ guild: message.guild, emoji, download: deps.download });
    } else if (kind === 'sticker' || kind === 'stiker') {
      const sticker = await resolveSticker(message, value);
      result = await stealSticker({ guild: message.guild, sticker, download: deps.download });
    } else {
      return send(message, {
        embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('ℹ️ Format Steal').setDescription(
          '`' + prefix + ' steal emoji <emoji>` — ambil emoji custom.\n' +
          '`' + prefix + ' steal sticker <sticker_id>` — ambil sticker.\n' +
          'Bisa juga balas pesan yang berisi emoji/sticker lalu jalankan perintahnya.'
        )],
      });
    }
    return send(message, { embeds: [resultEmbed(result)] });
  } catch (error) {
    return send(message, { embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Gagal Mengambil').setDescription(error.message || 'Terjadi kesalahan.')] });
  }
}

function isDeveloperInteraction(interaction, deps = {}) {
  if (deps.isDeveloper) {
    return deps.isDeveloper({ author: interaction.user, client: interaction.client, guild: interaction.guild });
  }
  return false;
}

const data = new SlashCommandBuilder()
  .setName('steal')
  .setDescription('Ambil emoji atau sticker ke server ini (developer)')
  .addSubcommand(sub => sub
    .setName('emoji')
    .setDescription('Ambil emoji custom')
    .addStringOption(option => option.setName('emoji').setDescription('Token emoji atau ID').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('sticker')
    .setDescription('Ambil sticker')
    .addStringOption(option => option.setName('sticker').setDescription('ID sticker').setRequired(true)));

async function execute(interaction, deps = {}) {
  if (!isDeveloperInteraction(interaction, deps)) {
    return interaction.reply({
      content: 'Fitur steal emoji/sticker hanya untuk developer bot.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!interaction.guild) {
    return interaction.reply({ content: 'Perintah ini hanya bisa dipakai di server.', flags: MessageFlags.Ephemeral });
  }
  const kind = interaction.options.getSubcommand();
  try {
    let result;
    if (kind === 'emoji') {
      const emoji = await resolveEmoji({ guild: interaction.guild }, interaction.options.getString('emoji'));
      result = await stealEmoji({ guild: interaction.guild, emoji, download: deps.download });
    } else {
      const sticker = await interaction.client.rest.get(Routes.sticker(interaction.options.getString('sticker')));
      result = await stealSticker({ guild: interaction.guild, sticker, download: deps.download });
    }
    return interaction.reply({ embeds: [resultEmbed(result)], flags: MessageFlags.Ephemeral });
  } catch (error) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Gagal Mengambil').setDescription(error.message || 'Terjadi kesalahan.')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = {
  data,
  execute,
  handleStealCommand,
  parseEmojiToken,
  emojiFromContent,
  safeEmojiName,
  safeStickerName,
  emojiUrl,
  stealEmoji,
  stealSticker,
  resolveEmoji,
  resolveSticker,
};
