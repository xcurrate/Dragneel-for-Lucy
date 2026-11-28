// Hint mines 3x3 Lucy. Papan tidak punya petunjuk angka, jadi semua tile yang
// belum dibuka punya peluang sama. Hint menghitung peluang aman dan EV lanjut.
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { getGuildSettings, DEFAULT_PREFIX } = require('../utils/storage');

const REACTION = '🎯';
const LUCY_BOT_ID = process.env.LUCY_BOT_ID || '1438615298012872817';
const BOARD_SIZE = 9;
const BLANK_EMOJI = 'blank';

function dataOf(message) {
  if (!message) return {};
  if (typeof message.toJSON === 'function') {
    try {
      const json = message.toJSON();
      if (json && typeof json === 'object') return json;
    } catch { /* fallback */ }
  }
  return message.message || message;
}

function componentTexts(components = []) {
  const out = [];
  for (const raw of components || []) {
    const component = raw?.data && raw.data.type ? raw.data : raw;
    if (!component || typeof component !== 'object') continue;
    if (component.type === 10 && typeof component.content === 'string') out.push(component.content);
    if (Array.isArray(component.components)) out.push(...componentTexts(component.components));
  }
  return out;
}

function mineButtons(components = [], out = []) {
  for (const raw of components || []) {
    const component = raw?.data && raw.data.type ? raw.data : raw;
    if (!component || typeof component !== 'object') continue;
    if (component.type === 2 && /^mines_tile_\d+$/.test(String(component.custom_id || component.customId || ''))) {
      out.push(component);
    }
    if (Array.isArray(component.components)) mineButtons(component.components, out);
  }
  return out;
}

function developerIds(client) {
  const ids = new Set(String(process.env.DEVELOPER_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
  const owner = client?.application?.owner;
  if (owner?.id) ids.add(String(owner.id));
  else if (owner?.members) for (const id of owner.members.keys()) ids.add(String(id));
  return ids;
}

function developerFor(user, client) {
  return developerIds(client).has(String(user?.id || ''));
}

function numberFrom(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[.,]/g, '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseMinesMessage(message) {
  const data = dataOf(message);
  const components = data.components || data.message?.components || [];
  const buttons = mineButtons(components);
  if (buttons.length !== BOARD_SIZE) return null;
  const text = componentTexts(components).join('\n');
  if (!/mines/i.test(text) || !/Ranjau\s*:/i.test(text)) return null;

  const playerId = (text.match(/<@!?(\d+)>/) || [])[1] || null;
  const minesMatch = text.match(/Ranjau\s*:\s*\**\s*`?(\d+)`?/i);
  const mines = minesMatch ? Number(minesMatch[1]) : null;
  const betMatch = text.match(/Taruhan\s*:[^\n]*?`([\d,.]+)`/i);
  const bet = betMatch ? numberFrom(betMatch[1]) : null;

  const tiles = buttons.map(button => {
    const id = String(button.custom_id || button.customId || '');
    const index = Number(id.replace('mines_tile_', ''));
    const emoji = button.emoji?.name || null;
    const opened = button.disabled === true || (emoji && emoji !== BLANK_EMOJI);
    return { index, id, disabled: button.disabled === true, emoji, opened };
  }).sort((a, b) => a.index - b.index);

  const opened = tiles.filter(tile => tile.opened).length;
  const remaining = tiles.filter(tile => !tile.opened).length;
  const nextMatch = text.match(/Berikutnya\s*:[^\n]*?\(([\d.]+)x\)/i);
  const nextMultiplier = nextMatch ? Number(nextMatch[1]) : null;
  const cashoutText = ((text.match(/Cash Out\s*:\s*([^\n]*)/i) || [])[1] || '').replace(/\*/g, '').replace(/<a?:[a-z0-9_]+:\d+>/gi, '').trim();
  const cashoutMultiplier = cashoutText.match(/\(?([\d.]+)x\)?/i);
  const cashoutAmount = cashoutText.match(/`?([\d,.]+)`?/i);
  const cashout = /^—+$/.test(cashoutText.trim()) ? null
    : cashoutMultiplier ? Number(cashoutMultiplier[1])
      : cashoutAmount ? (bet ? numberFrom(cashoutAmount[1]) / bet : numberFrom(cashoutAmount[1])) : null;

  return {
    playerId,
    mines,
    bet,
    tiles,
    opened,
    remaining,
    nextMultiplier,
    cashout,
    finished: remaining === 0 || tiles.every(tile => tile.disabled),
    text,
    sourceMessageId: data.id || message?.id || null,
    sourceChannelId: data.channelId || message?.channelId || null,
  };
}

function safeProbability(parsed) {
  if (!parsed || parsed.remaining <= 0 || parsed.mines == null) return null;
  const safeTotal = BOARD_SIZE - parsed.mines;
  const safeRemaining = Math.max(0, safeTotal - parsed.opened);
  return Math.min(1, Math.max(0, safeRemaining / parsed.remaining));
}

function recommend(parsed) {
  if (!parsed || parsed.finished) return null;
  const chance = safeProbability(parsed);
  if (chance == null) return null;
  const ev = parsed.nextMultiplier == null ? null : chance * parsed.nextMultiplier;
  const cashout = parsed.cashout;
  const cashOut = cashout != null && ev != null && cashout >= ev;
  return {
    action: cashOut ? 'cashout' : 'open',
    chance,
    ev,
    tiles: parsed.tiles.filter(tile => !tile.opened).map(tile => tile.index),
  };
}

function percent(value) {
  return (value * 100).toFixed(1).replace('.', ',') + '%';
}

function multiplier(value) {
  return value == null ? '—' : Number(value).toFixed(2).replace('.', ',') + 'x';
}

function buildHintEmbed(parsed) {
  const result = recommend(parsed);
  if (!result) {
    return new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('💣 Mines Hint')
      .setDescription('Papan sudah selesai atau tidak ada tile tersisa.');
  }
  const cashout = result.action === 'cashout';
  return new EmbedBuilder()
    .setColor(cashout ? 0x57F287 : 0xFEE75C)
    .setTitle('💣 Mines Hint')
    .setDescription([
      `**${cashout ? '💎 CASH OUT' : '🎲 BUKA TILE ACAK'}**`,
      '',
      `Papan **3x3** • **${parsed.mines} ranjau** • ${parsed.opened} tile terbuka`,
      `Peluang aman tile berikutnya: **${percent(result.chance)}**`,
      `Cash out sekarang: **${parsed.cashout == null ? '—' : multiplier(parsed.cashout)}**`,
      `Multiplier berikutnya: **${multiplier(parsed.nextMultiplier)}**`,
      `EV lanjut: **${result.ev == null ? '—' : multiplier(result.ev)}**`,
      '',
      cashout
        ? 'Nilai cash out sudah lebih tinggi dari EV lanjut.'
        : 'Semua tile belum dibuka punya peluang sama; tidak ada clue posisi ranjau.',
    ].join('\n'))
    .setFooter({ text: 'Hint probabilistik, bukan jaminan posisi ranjau.' });
}

function parseCommand(content, prefix) {
  const text = String(content || '');
  const prefixes = [...new Set([prefix, '!'].filter(Boolean))];
  for (const candidate of prefixes) {
    if (!text.toLowerCase().startsWith(String(candidate).toLowerCase())) continue;
    const rest = text.slice(String(candidate).length).trim();
    const match = rest.match(/^(?:mhint|mines|mineshint)(?:\s+(.*))?$/i);
    if (match) return { args: (match[1] || '').trim().split(/\s+/).filter(Boolean) };
  }
  return null;
}

function parseOptions(args = []) {
  const options = { source: null, help: false, debug: false };
  for (const arg of args) {
    if (arg.toLowerCase() === 'help') { options.help = true; continue; }
    if (arg.toLowerCase() === 'debug') { options.debug = true; continue; }
    if (/^\d{17,20}$/.test(arg)) { options.source = { type: 'id', id: arg }; continue; }
    const link = arg.match(/^<?https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)>?$/i);
    if (link) { options.source = { type: 'link', guildId: link[1], channelId: link[2], messageId: link[3] }; continue; }
    return { error: 'Argumen tidak dikenal: `' + arg + '`. Gunakan `mhint help`.' };
  }
  return options;
}

function strictPayload(payload) {
  return { ...payload, allowedMentions: { parse: [], repliedUser: false } };
}

async function send(target, payload) {
  const body = strictPayload(payload);
  if (target?.reply) return target.reply(body);
  if (target?.channel?.send) return target.channel.send(body);
}

async function sendDebugFile(target, data) {
  const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
    name: 'lucy-mines-debug.json',
  });
  const payload = { content: 'Debug komponen pesan mines Lucy terbaru.', files: [attachment] };
  if (target?.author?.send) {
    try { return await target.author.send(payload); } catch { /* fallback ke channel */ }
  }
  return send(target, payload);
}

async function deliverHint(message, parsed, user) {
  const embed = buildHintEmbed(parsed);
  if (user?.send) {
    try {
      await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return 'dm';
    } catch { /* lanjut ke pesan penjelasan */ }
  }
  await send(message, { content: 'Hint tidak bisa dikirim karena DM tertutup. Buka DM lalu coba lagi.' });
  return 'failed';
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('💣 Mines Hint')
    .setDescription([
      'Baca papan mines 3x3 Lucy, lalu hitung peluang aman dan EV tile berikutnya.',
      '',
      '**Cara pakai**',
      'Balas pesan mines Lucy lalu ketik `mhint`, atau kirim link/ID pesan.',
      'Reaksi 🎯 pada papan mines juga mengirim hint lewat DM.',
      '`d mhint debug` mengirim JSON komponen pesan terbaru lewat DM.',
      '',
      'Hint hanya untuk developer.',
    ].join('\n'));
}

async function getChannel(client, channelId) {
  if (!client?.channels) return null;
  const cached = client.channels.cache?.get?.(channelId);
  if (cached) return cached;
  return client.channels.fetch ? client.channels.fetch(channelId).catch(() => null) : null;
}

async function fetchMessage(channel, messageId) {
  return channel?.messages?.fetch ? channel.messages.fetch(messageId).catch(() => null) : null;
}

async function freshMessage(message) {
  if (!message) return message;
  if (message.fetch) {
    try { return await message.fetch(true); } catch { /* pakai objek lama */ }
  }
  return message;
}

async function resolveSource(message, options) {
  if (options.source?.type === 'link') {
    const channel = await getChannel(message.client, options.source.channelId);
    const found = await fetchMessage(channel, options.source.messageId);
    return found ? { message: found } : null;
  }
  if (options.source?.type === 'id') {
    const found = await fetchMessage(message.channel, options.source.id);
    return found ? { message: found } : null;
  }
  if (message.reference?.messageId) {
    const found = await fetchMessage(message.channel, message.reference.messageId);
    if (found) return { message: found };
  }
  if (message.reference?.resolved) return { message: message.reference.resolved };
  const collection = await message.channel?.messages?.fetch?.({ limit: 50 });
  if (!collection) return null;
  const messages = typeof collection.values === 'function' ? [...collection.values()] : Object.values(collection);
  for (const candidate of messages) {
    if (candidate?.id !== message.id && parseMinesMessage(candidate)) return { message: candidate };
  }
  return null;
}

async function handleMessage(message) {
  if (!message || message.author?.bot) return false;
  const prefix = (message.guildId && getGuildSettings(message.guildId).prefix) || DEFAULT_PREFIX;
  const command = parseCommand(message.content, prefix);
  if (!command) return false;
  if (!developerFor(message.author, message.client)) {
    await send(message, { content: 'Fitur Mines Hint khusus developer.' });
    return true;
  }
  const options = parseOptions(command.args);
  if (options.error) { await send(message, { content: options.error }); return true; }
  if (options.help) { await send(message, { embeds: [helpEmbed()] }); return true; }
  const source = await resolveSource(message, options);
  if (!source) {
    await send(message, { content: 'Pesan mines Lucy tidak ditemukan. Balas pesan papannya, kirim link/ID, atau jalankan di channel yang punya papan mines.' });
    return true;
  }
  const sourceMessage = await freshMessage(source.message);
  if (options.debug) {
    await sendDebugFile(message, dataOf(sourceMessage));
    return true;
  }
  const parsed = parseMinesMessage(sourceMessage);
  if (!parsed) {
    await send(message, { content: 'Pesan sumber bukan papan mines Lucy yang bisa dibaca.' });
    return true;
  }
  await deliverHint(message, parsed, message.author);
  return true;
}

async function autoReact(message) {
  if (!message || message.author?.id !== LUCY_BOT_ID) return false;
  const parsed = parseMinesMessage(message);
  if (!parsed || !parsed.playerId || !developerFor({ id: parsed.playerId }, message.client)) return false;
  try {
    await message.react(REACTION);
    return true;
  } catch {
    return false;
  }
}

async function handleReaction(reaction, user) {
  if (!reaction || user?.bot || reaction.emoji?.name !== REACTION) return false;
  let message = reaction.message;
  if (message?.fetch) message = await message.fetch(true).catch(() => message);
  const parsed = parseMinesMessage(message);
  if (!parsed) return false;
  if (!developerFor(user, reaction.client || message?.client)) {
    await send(message, { content: 'Fitur Mines Hint khusus developer.' });
    return true;
  }
  if (parsed.playerId !== String(user.id)) {
    await send(message, { content: 'Hint ini hanya untuk papan mines developer.' });
    return true;
  }
  await deliverHint(message, parsed, user);
  return true;
}

module.exports = {
  REACTION, LUCY_BOT_ID, BOARD_SIZE, parseMinesMessage, safeProbability, recommend,
  buildHintEmbed, parseCommand, parseOptions, helpEmbed, resolveSource, freshMessage, deliverHint,
  handleMessage, autoReact, handleReaction,
};
