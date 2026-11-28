// Analisis kartu blackjack Lucy. Hanya memberi rekomendasi hit/stand karena
// reaksi yang tersedia di kartu Lucy adalah 👊 dan 🛑.
const { EmbedBuilder } = require('discord.js');
const { getGuildSettings, DEFAULT_PREFIX } = require('../utils/storage');

const REACTION = '🎯';
const LUCY_BOT_ID = process.env.LUCY_BOT_ID || '1438615298012872817';
const CARD_BACK = 'cardback';

const SUIT_SYMBOL = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RANK_VALUE = { a: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, j: 10, q: 10, k: 10 };
const RANK_LABEL = { a: 'A', j: 'J', q: 'Q', k: 'K' };

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

function embedList(data) {
  return (data.embeds || data.message?.embeds || []).map(raw => raw?.data || raw).filter(Boolean);
}

function parseToken(token) {
  const text = String(token || '').trim().toLowerCase();
  if (text === CARD_BACK) return { hidden: true };
  const emoji = text.match(/^<a?:([a-z0-9_]+):\d+>$/);
  if (emoji) return parseToken(emoji[1]);
  const match = text.match(/^(10|[2-9]|[ajqk])([hdcs])$/);
  if (match) {
    const rank = match[1];
    const suit = match[2];
    return {
      rank,
      suit,
      hidden: false,
      value: rank === 'a' ? 1 : RANK_VALUE[rank],
      label: (RANK_LABEL[rank] || rank) + SUIT_SYMBOL[suit],
    };
  }
  return null;
}

function parseCards(value) {
  const text = String(value || '');
  const out = [];
  for (const match of text.matchAll(/<a?:([a-z0-9_]+):\d+>/gi)) {
    const card = parseToken(match[1]);
    if (card) out.push(card);
  }
  for (const match of text.matchAll(/(10|[2-9]|[ajqk])\s*([♠♥♦♣])/gi)) {
    const card = parseToken(match[1] + match[2]);
    if (card) out.push(card);
  }
  return out;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  let visible = 0;
  for (const card of cards) {
    if (card.hidden) continue;
    visible += 1;
    if (card.rank === 'a') {
      aces += 1;
      total += 11;
    } else {
      total += card.value;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return {
    total,
    soft: aces > 0,
    cards: cards.filter(card => !card.hidden),
    blackjack: visible === 2 && total === 21,
    bust: total > 21,
  };
}

function fieldNameName(name) {
  return String(name || '').replace(/`.*$/, '').replace(/\s*\[\d+\+?\?\]$/, '').trim();
}

function parseBlackjackMessage(message) {
  const data = dataOf(message);
  for (const embed of embedList(data)) {
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    const dealerField = fields.find(field => /^dealer\b/i.test(field?.name || ''));
    if (!dealerField) continue;
    const playerField = fields.find(field => field !== dealerField && /\[\d+\]/.test(field?.name || ''))
      || fields.find(field => field !== dealerField);
    if (!playerField) continue;

    const dealerCards = parseCards(dealerField.value);
    const playerCards = parseCards(playerField.value);
    const dealerUp = dealerCards.find(card => !card.hidden);
    if (!dealerUp || !playerCards.some(card => !card.hidden)) continue;

    return {
      dealerCards,
      dealerUp,
      playerCards,
      player: handValue(playerCards),
      dealer: handValue(dealerCards),
      playerName: fieldNameName(playerField.name),
      sourceMessageId: data.id || message?.id || null,
      sourceChannelId: data.channelId || message?.channelId || null,
    };
  }
  return null;
}

function dealerValue(upcard) {
  if (!upcard) return null;
  return upcard.rank === 'a' ? 11 : upcard.value;
}

function recommend(parsed) {
  const player = parsed.player;
  const dealer = dealerValue(parsed.dealerUp);
  if (player.bust) return { action: 'stand', reason: 'Kartu sudah bust.' };
  if (player.blackjack || player.total >= 21) return { action: 'stand', reason: 'Total sudah 21 atau blackjack.' };

  if (player.soft) {
    if (player.total >= 19) return { action: 'stand', reason: 'Soft 19+ sudah kuat.' };
    if (player.total === 18) {
      if (dealer >= 2 && dealer <= 8) return { action: 'stand', reason: 'Soft 18 melawan dealer 2-8.' };
      return { action: 'hit', reason: 'Soft 18 melawan dealer 9-A.' };
    }
    return { action: 'hit', reason: 'Soft 17 atau kurang masih bisa diperbaiki.' };
  }

  if (player.total >= 17) return { action: 'stand', reason: 'Hard 17+ sudah cukup.' };
  if (player.total === 12) {
    if (dealer >= 4 && dealer <= 6) return { action: 'stand', reason: 'Hard 12 melawan dealer 4-6.' };
    return { action: 'hit', reason: 'Hard 12 melawan dealer 2-3 atau 7-A.' };
  }
  if (player.total >= 13 && player.total <= 16) {
    if (dealer >= 2 && dealer <= 6) return { action: 'stand', reason: 'Hard 13-16 melawan dealer 2-6.' };
    return { action: 'hit', reason: 'Hard 13-16 melawan dealer 7-A.' };
  }
  return { action: 'hit', reason: 'Hard 11 atau kurang masih aman untuk tambah kartu.' };
}

function cardsText(cards) {
  return cards.map(card => card.hidden ? '🂠' : card.label).join(' + ');
}

function buildHintEmbed(parsed) {
  const result = recommend(parsed);
  const hit = result.action === 'hit';
  const playerText = cardsText(parsed.playerCards) + ` = **${parsed.player.total}**` + (parsed.player.soft ? ' (soft)' : '');
  const dealerText = cardsText(parsed.dealerCards);
  return new EmbedBuilder()
    .setColor(hit ? 0xFEE75C : 0x57F287)
    .setTitle('🃏 Blackjack Hint')
    .setDescription([
      `**${hit ? '👊 HIT' : '🛑 STAND'}**`,
      result.reason,
      '',
      '**Kartu kamu**',
      `> ${playerText}`,
      '**Kartu dealer**',
      `> ${dealerText}`,
      '',
      '-# Hanya hit/stand; double dan split tidak tersedia di reaksi Lucy.',
    ].join('\n'))
    .setFooter({ text: `Untuk ${parsed.playerName || 'kamu'}` });
}

function parseCommand(content, prefix) {
  const text = String(content || '');
  const prefixes = [...new Set([prefix, '!'].filter(Boolean))];
  for (const candidate of prefixes) {
    if (!text.toLowerCase().startsWith(String(candidate).toLowerCase())) continue;
    const rest = text.slice(String(candidate).length).trim();
    const match = rest.match(/^(?:bjhint|bj|blackjack)(?:\s+(.*))?$/i);
    if (match) return { args: (match[1] || '').trim().split(/\s+/).filter(Boolean) };
  }
  return null;
}

function parseOptions(args = []) {
  const options = { source: null, help: false };
  for (const arg of args) {
    if (arg.toLowerCase() === 'help') { options.help = true; continue; }
    if (/^\d{17,20}$/.test(arg)) { options.source = { type: 'id', id: arg }; continue; }
    const link = arg.match(/^<?https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)>?$/i);
    if (link) { options.source = { type: 'link', guildId: link[1], channelId: link[2], messageId: link[3] }; continue; }
    return { error: 'Argumen tidak dikenal: `' + arg + '`. Gunakan `bjhint help`.' };
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

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🃏 Blackjack Hint')
    .setDescription([
      'Baca kartu blackjack Lucy, lalu kasih rekomendasi 👊 atau 🛑.',
      '',
      '**Cara pakai**',
      'Balas pesan blackjack Lucy lalu ketik `bjhint`, atau kirim link/ID pesan.',
      'Reaksi 🎯 pada kartu blackjack juga langsung memberi hint.',
      '',
      '**Contoh**',
      '`d bjhint`',
      '`d bjhint https://discord.com/channels/.../.../...`',
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
  if (message.reference?.resolved) return { message: message.reference.resolved };
  if (message.reference?.messageId) {
    const found = await fetchMessage(message.channel, message.reference.messageId);
    if (found) return { message: found };
  }
  const collection = await message.channel?.messages?.fetch?.({ limit: 50 });
  if (!collection) return null;
  const messages = typeof collection.values === 'function' ? [...collection.values()] : Object.values(collection);
  for (const candidate of messages) {
    if (candidate?.id !== message.id && parseBlackjackMessage(candidate)) return { message: candidate };
  }
  return null;
}

async function handleMessage(message) {
  if (!message || message.author?.bot) return false;
  const prefix = (message.guildId && getGuildSettings(message.guildId).prefix) || DEFAULT_PREFIX;
  const command = parseCommand(message.content, prefix);
  if (!command) return false;

  const options = parseOptions(command.args);
  if (options.error) { await send(message, { content: options.error }); return true; }
  if (options.help) { await send(message, { embeds: [helpEmbed()] }); return true; }
  const source = await resolveSource(message, options);
  if (!source) {
    await send(message, { content: 'Pesan blackjack Lucy tidak ditemukan. Balas pesan kartunya, kirim link/ID, atau jalankan di channel yang punya kartu blackjack.' });
    return true;
  }
  const parsed = parseBlackjackMessage(source.message);
  if (!parsed) {
    await send(message, { content: 'Pesan sumber bukan kartu blackjack Lucy yang bisa dibaca.' });
    return true;
  }
  await send(message, { embeds: [buildHintEmbed(parsed)] });
  return true;
}

async function autoReact(message) {
  if (!message || message.author?.id !== LUCY_BOT_ID) return false;
  if (!parseBlackjackMessage(message)) return false;
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
  if (message?.partial && message.fetch) message = await message.fetch();
  const parsed = parseBlackjackMessage(message);
  if (!parsed) return false;
  await send(message, { embeds: [buildHintEmbed(parsed)] });
  return true;
}

module.exports = {
  REACTION, LUCY_BOT_ID, parseCards, handValue, parseBlackjackMessage, recommend,
  buildHintEmbed, parseCommand, parseOptions, helpEmbed, resolveSource,
  handleMessage, autoReact, handleReaction,
};
