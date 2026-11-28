const crypto = require('node:crypto');
const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');

const EMOJI_TOKEN = /<(a?):([A-Za-z0-9_]+):(\d{17,20})>/g;
const EMOJI_ID = /^\d{17,20}$/;
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const PANEL_PREFIX = 'steal_emoji_panel';
const PANEL_TTL_MS = 15 * 60 * 1000;
const PANEL_LIMIT = 100;
const panelStore = new Map();

function parseEmojiToken(value) {
  const match = String(value || '').trim().match(/^<(a?):([A-Za-z0-9_]+):(\d{17,20})>$/);
  if (!match) return null;
  return { animated: Boolean(match[1]), name: match[2], id: match[3] };
}

function emojisFromContent(content) {
  const found = [...String(content || '').matchAll(EMOJI_TOKEN)].map(match => ({
    animated: Boolean(match[1]), name: match[2], id: match[3],
  }));
  const seen = new Set();
  return found.filter(emoji => {
    if (seen.has(emoji.id)) return false;
    seen.add(emoji.id);
    return true;
  });
}

function emojiFromContent(content) {
  const found = emojisFromContent(content);
  return found.length === 1 ? found[0] : null;
}

function emojiToken(emoji) {
  return '<' + (emoji.animated ? 'a' : '') + ':' + emoji.name + ':' + emoji.id + '>';
}

function messageData(message) {
  if (!message) return {};
  if (typeof message.toJSON === 'function') {
    try {
      const json = message.toJSON();
      if (json && typeof json === 'object') return json;
    } catch { /* fallback ke bentuk mentah */ }
  }
  return message.message || message;
}

function collectStrings(value, out = [], seen = new Set()) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, seen);
    return out;
  }
  for (const item of Object.values(value)) {
    if (typeof item !== 'function') collectStrings(item, out, seen);
  }
  return out;
}

function emojisFromUrls(text) {
  const found = [...String(text || '').matchAll(/https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/emojis\/(\d{17,20})\.(png|gif|webp)(?:\?[^\s]*)?/gi)]
    .map(match => ({
      animated: match[2].toLowerCase() === 'gif',
      name: 'emoji_' + match[1],
      id: match[1],
    }));
  const seen = new Set();
  return found.filter(emoji => {
    if (seen.has(emoji.id)) return false;
    seen.add(emoji.id);
    return true;
  });
}

function emojisFromMessage(message) {
  const text = collectStrings(messageData(message)).join('\n');
  const tokens = emojisFromContent(text);
  return tokens.length ? tokens : emojisFromUrls(text);
}

function stickerUrl(sticker) {
  if (sticker?.url) return sticker.url;
  const format = String(sticker?.format || '').toUpperCase();
  const type = Number(sticker?.format_type);
  const ext = format === 'LOTTIE' || type === 3
    ? 'json'
    : (format === 'GIF' || type === 4 ? 'gif' : 'png');
  return 'https://cdn.discordapp.com/stickers/' + sticker.id + '.' + ext;
}

function stickerFileName(sticker, url = stickerUrl(sticker)) {
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(String(url || ''));
  const ext = match ? match[1].toLowerCase() : 'png';
  return safeStickerName(sticker.name, sticker.id).replace(/\s+/g, '_') + '.' + ext;
}

function normalizeSticker(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') raw = { id: raw };
  if (typeof raw !== 'object' || !raw.id) return null;
  const sticker = { ...raw, id: String(raw.id) };
  sticker.name = sticker.name || 'sticker_' + sticker.id;
  sticker.url = stickerUrl(sticker);
  return sticker;
}

function addStickers(value, out) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) addStickers(item, out);
    return;
  }
  if (typeof value.values === 'function') {
    for (const item of value.values()) addStickers(item, out);
    return;
  }
  if (typeof value.first === 'function') {
    addStickers(value.first(), out);
    return;
  }
  const sticker = normalizeSticker(value);
  if (sticker) out.push(sticker);
}

function stickersFromMessage(message) {
  if (!message) return [];
  const data = messageData(message);
  const out = [];
  addStickers(message.stickers, out);
  addStickers(message.stickerItems, out);
  addStickers(data.stickers, out);
  addStickers(data.stickerItems, out);
  addStickers(data.sticker_items, out);
  addStickers(data.message?.stickers, out);
  addStickers(data.message?.stickerItems, out);
  addStickers(data.message?.sticker_items, out);

  const seen = new Set();
  return out.filter(sticker => {
    if (seen.has(sticker.id)) return false;
    seen.add(sticker.id);
    return true;
  });
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
  const url = stickerUrl(sticker);
  if (!url) throw new Error('Sticker ini tidak punya URL yang bisa diunduh.');
  const buffer = await download(url);
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
  if (typeof message.fetchReference === 'function') {
    const fetched = await message.fetchReference().catch(() => null);
    if (fetched) return fetched;
  }
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
  const fromReply = emojisFromMessage(reference);
  if (fromReply.length) return fromReply[0];
  throw new Error('Format: `steal emoji <emoji>` atau balas pesan yang berisi satu emoji custom.');
}

async function resolveEmojis(message, value) {
  const text = String(value || '').trim();
  const fromText = emojisFromContent(text);
  if (fromText.length) return fromText;

  if (EMOJI_ID.test(text)) return [await resolveEmoji(message, text)];

  const ids = text.split(/[\s,]+/).filter(part => EMOJI_ID.test(part));
  if (ids.length) {
    const resolved = [];
    for (const id of ids) resolved.push(await resolveEmoji(message, id));
    return resolved;
  }

  const reference = await referencedMessage(message);
  const fromReply = emojisFromMessage(reference);
  if (fromReply.length) return fromReply;
  throw new Error('Format: `steal emoji <emoji> [emoji...]` atau balas pesan yang berisi emoji custom.');
}

async function fetchSticker(client, id) {
  const restGet = client?.rest?.get;
  const sticker = restGet ? await restGet.call(client.rest, Routes.sticker(id)).catch(() => null) : null;
  return normalizeSticker(sticker);
}

async function resolveStickers(message, value) {
  const text = String(value || '').trim();
  if (text) {
    const ids = text.split(/[\s,]+/).filter(part => EMOJI_ID.test(part));
    if (!ids.length) throw new Error('Sticker ID harus berupa angka 17–20 digit.');
    const stickers = [];
    for (const id of ids) {
      const sticker = await fetchSticker(message.client, id);
      if (!sticker) throw new Error('Sticker tidak ditemukan.');
      stickers.push(sticker);
    }
    return stickers;
  }
  const reference = await referencedMessage(message);
  const fromReply = stickersFromMessage(reference);
  if (fromReply.length) return fromReply;
  const own = stickersFromMessage(message);
  if (own.length) return own;
  throw new Error('Format: `steal sticker <sticker_id> [sticker_id...]` atau balas pesan yang berisi sticker.');
}

async function resolveSticker(message, value) {
  const stickers = await resolveStickers(message, value);
  return stickers[0];
}

function cleanupPanels(now = Date.now()) {
  for (const [token, entry] of panelStore) {
    if (now - entry.createdAt > PANEL_TTL_MS) panelStore.delete(token);
  }
  while (panelStore.size >= PANEL_LIMIT) {
    panelStore.delete(panelStore.keys().next().value);
  }
}

function rememberPanel({ userId, guildId, kind = 'emoji', items }) {
  cleanupPanels();
  const token = crypto.randomBytes(8).toString('hex');
  const entry = {
    token,
    userId,
    guildId,
    kind,
    items,
    index: 0,
    saved: new Set(),
    createdAt: Date.now(),
  };
  panelStore.set(token, entry);
  return entry;
}

function getPanel(token, userId) {
  const entry = panelStore.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PANEL_TTL_MS) {
    panelStore.delete(token);
    return null;
  }
  if (userId && entry.userId !== userId) return null;
  return entry;
}

function panelId(token, action, index) {
  return `${PANEL_PREFIX}:${token}:${action}:${index}`;
}

function isStealPanelButton(customId) {
  return typeof customId === 'string' && customId.startsWith(`${PANEL_PREFIX}:`);
}

function parseStealPanelButton(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 4 || parts[0] !== PANEL_PREFIX) return { ok: false };
  const index = Number(parts[3]);
  if (!Number.isInteger(index) || index < 0) return { ok: false };
  if (!['prev', 'next', 'save', 'download'].includes(parts[2])) return { ok: false };
  return { ok: true, token: parts[1], action: parts[2], index };
}

function panelComponents(entry, index, total, saved) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(panelId(entry.token, 'prev', index))
      .setLabel('◀ Sebelumnya')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId(panelId(entry.token, 'next', index))
      .setLabel('Berikutnya ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= total - 1),
    new ButtonBuilder()
      .setCustomId(panelId(entry.token, 'save', index))
      .setLabel(saved ? '✅ Tersimpan' : '💾 Simpan')
      .setStyle(saved ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(saved),
    new ButtonBuilder()
      .setCustomId(panelId(entry.token, 'download', index))
      .setLabel('⬇️ Download')
      .setStyle(ButtonStyle.Secondary),
  )];
}

function panelPayload(entry) {
  const index = Math.max(0, Math.min(entry.index, entry.items.length - 1));
  const item = entry.items[index];
  const total = entry.items.length;
  const saved = entry.saved.has(index);
  const sticker = entry.kind === 'sticker';
  const embed = new EmbedBuilder()
    .setColor(sticker ? 0xFEE75C : 0x5865F2)
    .setTitle(sticker ? '🧩 Steal Sticker' : '🧩 Steal Emoji')
    .setDescription(sticker
      ? `**${item.name}**\nID: \`${item.id}\`\n\nSticker **${index + 1}/${total}**`
      : `**${item.name}**\n${emojiToken(item)}\n\nEmoji **${index + 1}/${total}**`)
    .setThumbnail(sticker ? stickerUrl(item) : emojiUrl(item))
    .setFooter({ text: '◀ ▶ navigasi · Simpan ke server · Download file' });
  if (saved) embed.addFields({ name: 'Status', value: '✅ Sudah disimpan ke server ini' });

  return {
    embeds: [embed],
    components: panelComponents(entry, index, total, saved),
  };
}

function panelFor(userId, guildId, items, kind = 'emoji') {
  return rememberPanel({ userId, guildId, kind, items });
}

async function handleStealPanelButton(interaction, deps = {}) {
  const parsed = parseStealPanelButton(interaction.customId);
  if (!parsed.ok) return;
  const entry = getPanel(parsed.token, interaction.user?.id);
  if (!entry) {
    return interaction.reply({
      content: 'Panel ini sudah kedaluwarsa atau bukan milikmu.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (entry.guildId && interaction.guildId && entry.guildId !== interaction.guildId) {
    return interaction.reply({
      content: 'Panel ini hanya bisa dipakai di server asalnya.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (deps.isDeveloper && !deps.isDeveloper({
    author: interaction.user,
    client: interaction.client,
    guild: interaction.guild,
  })) {
    return interaction.reply({
      content: 'Fitur steal emoji/sticker hanya untuk developer bot.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const index = Math.max(0, Math.min(entry.index, entry.items.length - 1));
  const item = entry.items[index];
  if (parsed.action === 'prev' || parsed.action === 'next') {
    entry.index = Math.max(0, Math.min(
      index + (parsed.action === 'next' ? 1 : -1),
      entry.items.length - 1,
    ));
    return interaction.update(panelPayload(entry));
  }

  if (parsed.action === 'save') {
    if (entry.saved.has(index)) {
      return interaction.update({
        ...panelPayload(entry),
        content: `ℹ️ **${item.name}** sudah tersimpan di server ini.`,
      });
    }
    try {
      const result = entry.kind === 'sticker'
        ? await stealSticker({ guild: interaction.guild, sticker: item, download: deps.download })
        : await stealEmoji({ guild: interaction.guild, emoji: item, download: deps.download });
      entry.saved.add(index);
      return interaction.update({
        ...panelPayload(entry),
        content: `✅ **${result.name}** sudah ditambahkan ke server ini.`,
      });
    } catch (error) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Gagal Menyimpan').setDescription(error.message || 'Terjadi kesalahan.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (parsed.action === 'download') {
    try {
      const download = deps.download || defaultDownload;
      const url = entry.kind === 'sticker' ? stickerUrl(item) : emojiUrl(item);
      const buffer = await download(url);
      const filename = entry.kind === 'sticker'
        ? stickerFileName(item, url)
        : safeEmojiName(item.name, item.id) + (item.animated ? '.gif' : '.png');
      return interaction.reply({
        content: `⬇️ **${item.name}**`,
        files: [new AttachmentBuilder(buffer, { name: filename })],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Gagal Mengunduh').setDescription(error.message || 'Terjadi kesalahan.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
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
    if (kind === 'emoji' || kind === 'emote') {
      const emojis = await resolveEmojis(message, value);
      const entry = panelFor(message.author?.id || 'unknown', message.guildId || message.guild?.id, emojis);
      return send(message, panelPayload(entry));
    }
    if (kind === 'sticker' || kind === 'stiker') {
      const stickers = await resolveStickers(message, value);
      const entry = panelFor(message.author?.id || 'unknown', message.guildId || message.guild?.id, stickers, 'sticker');
      return send(message, panelPayload(entry));
    }
    return send(message, {
      embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('ℹ️ Format Steal').setDescription(
        '`' + prefix + ' steal emoji <emoji> [emoji...]` — buka panel emoji custom.\n' +
        '`' + prefix + ' steal sticker <sticker_id> [sticker_id...]` — buka panel sticker.\n' +
        'Panel menyediakan navigasi ◀ ▶, Simpan ke server, dan Download.\n' +
        'Bisa juga balas pesan yang berisi emoji/sticker lalu jalankan perintahnya.'
      )],
    });
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
  .setDescription('Panel emoji/sticker untuk developer')
  .addSubcommand(sub => sub
    .setName('emoji')
    .setDescription('Buka panel emoji custom: navigasi, simpan, download')
    .addStringOption(option => option.setName('emoji').setDescription('Token emoji atau ID').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('sticker')
    .setDescription('Buka panel sticker: navigasi, simpan, download')
    .addStringOption(option => option.setName('sticker').setDescription('ID sticker (bisa lebih dari satu, pisahkan spasi/koma)').setRequired(true)));

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
    if (kind === 'emoji') {
      const emojis = await resolveEmojis({ guild: interaction.guild }, interaction.options.getString('emoji'));
      const entry = panelFor(interaction.user.id, interaction.guildId, emojis);
      return interaction.reply({ ...panelPayload(entry), flags: MessageFlags.Ephemeral });
    }
    const stickers = await resolveStickers(
      { client: interaction.client, guild: interaction.guild },
      interaction.options.getString('sticker'),
    );
    const entry = panelFor(interaction.user.id, interaction.guildId, stickers, 'sticker');
    return interaction.reply({ ...panelPayload(entry), flags: MessageFlags.Ephemeral });
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
  emojisFromContent,
  emojisFromMessage,
  emojiToken,
  safeEmojiName,
  safeStickerName,
  emojiUrl,
  stealEmoji,
  stealSticker,
  resolveEmoji,
  resolveEmojis,
  resolveSticker,
  resolveStickers,
  stickersFromMessage,
  stickerUrl,
  isStealPanelButton,
  parseStealPanelButton,
  handleStealPanelButton,
};
