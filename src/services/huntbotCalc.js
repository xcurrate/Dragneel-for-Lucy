// Kalkulator HuntBot Lucy. Angka dibaca dari pesan Components V2 (`type: 10`)
// atau embed biasa, bukan dari screenshot.
const { EmbedBuilder } = require('discord.js');
const { getGuildSettings, DEFAULT_PREFIX } = require('../utils/storage');

const REACTION = '📊';
const LUCY_BOT_ID = process.env.LUCY_BOT_ID || '1438615298012872817';

const TRAITS = [
  { key: 'efficiency', label: 'Efficiency', inc: 10, pow: 1.748, max: 215, base: 25, upg: 1 },
  { key: 'duration', label: 'Duration', inc: 10, pow: 1.7, max: 235, base: 0.5, upg: 0.1 },
  { key: 'cost', label: 'Cost', inc: 1000, pow: 3.4, max: 5, base: 10, upg: -1 },
  { key: 'gain', label: 'Gain', inc: 10, pow: 1.8, max: 200, base: 0, upg: 25 },
  { key: 'exp', label: 'Experience', inc: 10, pow: 1.8, max: 200, base: 0, upg: 35 },
  { key: 'radar', label: 'Radar', inc: 50, pow: 2.5, max: 999, base: 0, upg: 0.00000004 },
];

const TRAIT_BY_KEY = new Map(TRAITS.map(trait => [trait.key, trait]));
const TRAIT_ALIASES = {
  efficiency: 'efficiency', eff: 'efficiency',
  duration: 'duration', dur: 'duration',
  cost: 'cost',
  gain: 'gain',
  exp: 'exp', experience: 'exp', xp: 'exp',
  radar: 'radar',
};

const cumulativeCache = new Map();

function cumulativeXp(level, trait) {
  const lvl = Math.max(0, Math.trunc(Number(level) || 0));
  const inc = Number(trait?.inc) || 0;
  const exponent = Number(trait?.pow) || 0;
  const key = inc + ':' + exponent + ':' + lvl;
  if (cumulativeCache.has(key)) return cumulativeCache.get(key);
  let sum = 0;
  for (let i = 1; i <= lvl; i++) sum += Math.trunc(inc * Math.pow(i, exponent));
  cumulativeCache.set(key, sum);
  return sum;
}

function traitTotal(trait) {
  return cumulativeXp(trait.max, trait);
}

const MAX_ALL = TRAITS.reduce((sum, trait) => sum + traitTotal(trait), 0);

function numberFrom(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[.,]/g, '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('id-ID');
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

function embedTexts(embeds = []) {
  const out = [];
  for (const raw of embeds || []) {
    const embed = raw?.data || raw;
    if (!embed || typeof embed !== 'object') continue;
    for (const key of ['title', 'description', 'author', 'footer']) {
      if (typeof embed[key] === 'string') out.push(embed[key]);
      if (embed[key] && typeof embed[key] === 'object' && typeof embed[key].name === 'string') out.push(embed[key].name);
      if (embed[key] && typeof embed[key] === 'object' && typeof embed[key].text === 'string') out.push(embed[key].text);
    }
    for (const field of embed.fields || []) {
      if (typeof field?.name === 'string') out.push(field.name);
      if (typeof field?.value === 'string') out.push(field.value);
    }
  }
  return out;
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

function messageText(message) {
  const data = messageData(message);
  const parts = [];
  if (typeof data.content === 'string' && data.content) parts.push(data.content);
  parts.push(...componentTexts(data.components || data.message?.components || []));
  parts.push(...embedTexts(data.embeds || []));
  return parts.join('\n');
}

function parseHuntBotMessage(message) {
  const data = messageData(message);
  const text = messageText(data);
  if (!text) return null;
  const matches = [...text.matchAll(/Lvl\s+([\d,]+)\s*\[(MAX|([\d,]+)\s*\/\s*([\d,]+))\]/gi)].slice(0, 6);
  if (matches.length < 6) return null;
  // Judul/intro boleh hilang; Essence/Autohunt/Gain tetap menandai kartu HuntBot
  // dan membedakannya dari kartu tim Lucy yang juga punya beberapa `Lvl`.
  if (!/(?:HuntBot|Huntbot|Max\s+Autohunt|Animal\s+Essence|Essence\s+Hewan|Gain[^\n]*essence\s*\/\s*H)/i.test(text)) return null;

  const traits = matches.map((match, index) => {
    const spec = TRAITS[index];
    const maxed = match[2].toUpperCase() === 'MAX';
    return {
      key: spec.key,
      label: spec.label,
      level: Math.max(0, numberFrom(match[1]) || 0),
      currentXp: maxed ? 0 : (numberFrom(match[3]) || 0),
      levelXpMax: maxed ? null : (numberFrom(match[4]) || 0),
      maxed,
    };
  });

  let ownedEssence = null;
  const essenceMatch = text.match(/(?:Animal\s+Essence|Essence\s+Hewan)[^\n`]*`([\d,.]+)`/i)
    || text.match(/(?:Animal\s+Essence|Essence\s+Hewan)[^\n]*?`([\d,.]+)`/i);
  if (essenceMatch) ownedEssence = numberFrom(essenceMatch[1]);
  if (ownedEssence == null) {
    const line = text.split('\n').find(value => /essence/i.test(value) && !/max\s+autohunt/i.test(value) && /`[\d,.]+`/.test(value));
    const fallback = line?.match(/`([\d,.]+)`/);
    if (fallback) ownedEssence = numberFrom(fallback[1]);
  }

  const autoMatch = text.match(/Max\s+Autohunt[^\n]*?([\d,.]+)\s*hewan[^\n]*?([\d,.]+)\s*essence[^\n]*?([\d,.]+)\s*xp[^\n]*?([\d,.]+)\s*lucent/i);
  const autohunt = autoMatch ? {
    animals: numberFrom(autoMatch[1]),
    essence: numberFrom(autoMatch[2]),
    xp: numberFrom(autoMatch[3]),
    lucent: numberFrom(autoMatch[4]),
  } : null;

  const gainMatch = text.match(/Gain[^\n`]*`?([\d,.]+)\s*essence\s*\/\s*H/i);
  const gainPerHour = gainMatch ? numberFrom(gainMatch[1]) : null;

  const cowoncyMatch = text.match(/1\s*cowoncy\s*=\s*([\d,.]+)\s*essence/i)
    || text.match(/([\d,.]+)\s*essence\s*per\s*cowoncy/i);
  const cowoncyEssence = cowoncyMatch ? numberFrom(cowoncyMatch[1]) : null;

  return {
    traits,
    ownedEssence,
    autohunt,
    gainPerHour,
    cowoncyEssence,
    sourceMessageId: data.id || message?.id || null,
    sourceChannelId: data.channelId || message?.channelId || null,
    text,
  };
}

function targetValue(raw, current, trait) {
  if (raw == null) return trait.max;
  const text = String(raw).trim();
  if (/^max$/i.test(text)) return trait.max;
  const relative = text.startsWith('+');
  const value = Number(text.replace(/^\+/, '').replace(/,/g, ''));
  if (!Number.isFinite(value)) return current;
  return Math.max(0, Math.min(trait.max, Math.trunc(relative ? current + value : value)));
}

function calculate(parsed, options = {}) {
  const targets = options.targets || {};
  const hasSpecific = Object.keys(targets).length > 0;
  const rows = TRAITS.map((trait, index) => {
    const current = parsed.traits[index];
    const level = Math.max(0, Math.min(trait.max, current.level));
    let target;
    if (Object.hasOwn(targets, trait.key)) target = targetValue(targets[trait.key], level, trait);
    else if (options.all != null) target = targetValue(options.all, level, trait);
    else if (hasSpecific) target = level;
    else target = trait.max;
    target = Math.max(0, Math.min(trait.max, target));

    const currentXp = cumulativeXp(level, trait) + current.currentXp;
    const targetXp = cumulativeXp(target, trait);
    return {
      key: trait.key,
      label: trait.label,
      level,
      target,
      max: trait.max,
      currentXp,
      targetXp,
      cost: Math.max(0, targetXp - currentXp),
    };
  });

  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const owned = options.ownedEssence != null ? options.ownedEssence : parsed.ownedEssence;
  const remaining = owned == null ? total : Math.max(0, total - owned);

  const labels = [];
  if (options.all != null) labels.push('ALL ' + targetValue(options.all, 0, TRAITS[0]) + (String(options.all).startsWith('+') ? ' (relatif)' : ''));
  for (const [key, value] of Object.entries(targets)) {
    labels.push((TRAIT_BY_KEY.get(key)?.label || key) + ' ' + value);
  }
  const targetLabel = labels.length ? labels.join(', ') : 'MAX ALL';

  return { rows, total, owned, remaining, targetLabel, parsed, options };
}

function formatDuration(hours) {
  if (!Number.isFinite(hours) || hours < 0) return '(tidak tersedia)';
  const totalMinutes = Math.ceil(hours * 60);
  const days = Math.floor(totalMinutes / 1440);
  const rest = totalMinutes % 1440;
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  if (days) return days + ' hari ' + h + ' jam';
  if (h) return h + ' jam ' + m + ' menit';
  return m + ' menit';
}

function equivalents(total, parsed) {
  const auto = parsed.autohunt;
  if (!auto || !(auto.essence > 0)) {
    return {
      hunts: null,
      animals: null,
      lucent: null,
      hours: parsed.gainPerHour > 0 ? total / parsed.gainPerHour : null,
      cowoncy: parsed.cowoncyEssence > 0 ? total / parsed.cowoncyEssence : null,
    };
  }
  const hunts = total === 0 ? 0 : Math.ceil(total / auto.essence);
  return {
    hunts,
    animals: hunts * auto.animals,
    lucent: hunts * auto.lucent,
    hours: parsed.gainPerHour > 0 ? total / parsed.gainPerHour : null,
    cowoncy: parsed.cowoncyEssence > 0 ? total / parsed.cowoncyEssence : null,
  };
}

function chunkLines(lines, max = 1800) {
  const pages = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const text = String(line);
    if (text.length > max) {
      if (current.length) { pages.push(current.join('\n')); current = []; size = 0; }
      for (let offset = 0; offset < text.length; offset += max) pages.push(text.slice(offset, offset + max));
      continue;
    }
    if (size + text.length + 1 > max && current.length) {
      pages.push(current.join('\n'));
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length + 1;
  }
  if (current.length) pages.push(current.join('\n'));
  return pages.length ? pages : [''];
}

function buildCalculationEmbeds(calc) {
  const rows = calc.rows.map(row => [
    row.label.padEnd(11),
    String(row.level).padStart(4),
    String(row.target).padStart(6),
    formatNumber(row.cost).padStart(16),
  ].join(' '));
  const eq = equivalents(calc.total, calc.parsed);
  const lines = [
    '**Target:** ' + calc.targetLabel,
    '```text',
    'Trait        Lvl Target            Butuh',
    ...rows,
    '```',
    '**Total:** ' + formatNumber(calc.total) + ' essence',
    '**Dimiliki:** ' + (calc.owned == null ? '(tidak tersedia)' : formatNumber(calc.owned) + ' essence'),
    '**Sisa:** ' + formatNumber(calc.remaining) + ' essence',
    '',
    '**Ekuivalen**',
  ];
  if (eq.hunts == null) {
    lines.push('🐾 Hewan/hunt: (data Max Autohunt tidak ditemukan)');
  } else {
    lines.push('🐾 Hewan: **' + formatNumber(eq.animals) + '** (' + formatNumber(eq.hunts) + ' hunt)');
    lines.push('💎 Lucent: **' + formatNumber(eq.lucent) + '**');
  }
  lines.push('🕒 Waktu: **' + formatDuration(eq.hours) + '**' + (calc.parsed.gainPerHour ? ' (gain ' + formatNumber(calc.parsed.gainPerHour) + ' essence/jam)' : ''));
  lines.push('🐮 Cowoncy: ' + (eq.cowoncy == null ? '(tidak tersedia)' : '**' + formatNumber(eq.cowoncy) + '**'));
  if (calc.options?.animals && calc.parsed.autohunt) {
    const auto = calc.parsed.autohunt;
    lines.push('-# 1 hunt = ' + formatNumber(auto.animals) + ' hewan, ' + formatNumber(auto.essence) + ' essence, ' + formatNumber(auto.xp) + ' xp, ' + formatNumber(auto.lucent) + ' lucent');
  }

  const pages = chunkLines(lines);
  return pages.map((description, index) => new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(index === 0 ? '📊 HuntBot Calculator' : '📊 HuntBot Calculator — lanjutan')
    .setDescription(description)
    .setFooter({ text: pages.length > 1 ? 'Halaman ' + (index + 1) + '/' + pages.length : 'MAX ALL = 451.002.857.406 essence' }));
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 HuntBot Calculator')
    .setDescription([
      'Hitung kebutuhan essence HuntBot sampai MAX ALL atau target level tertentu.',
      '',
      '**Sumber pesan**',
      'Balas pesan HuntBot, kirim link/ID pesan, atau kosongkan untuk pesan HuntBot terakhir di channel.',
      '',
      '**Opsi**',
      '`all=100` — target semua trait ke level 100',
      '`radar=250` — target Radar ke level 250',
      '`radar=+25` — tambah 25 level dari level Radar sekarang',
      '`essence=1000000` — timpa owned essence dari embed',
      '`animals` — tampilkan rincian 1 hunt (hewan/essence/xp/lucent)',
      'Reaksi 📊 pada pesan HuntBot juga langsung menghitung MAX ALL.',
      '`help` — panduan ini',
      '',
      'Contoh: `!hbcalc`, `!hbcalc radar=250`, `!hbcalc all=100`, `!hbcalc radar=+25`',
    ].join('\n'));
}

function parseCommand(content, prefix) {
  const text = String(content || '');
  const prefixes = [...new Set([prefix, '!'].filter(Boolean))];
  for (const candidate of prefixes) {
    if (!text.toLowerCase().startsWith(String(candidate).toLowerCase())) continue;
    const rest = text.slice(String(candidate).length).trim();
    const match = rest.match(/^hbcalc(?:\s+(.*))?$/i);
    if (match) return { args: (match[1] || '').trim().split(/\s+/).filter(Boolean) };
  }
  return null;
}

function parseOptions(args = []) {
  const options = { targets: {}, all: null, ownedEssence: null, animals: false, help: false, source: null };
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === 'help') { options.help = true; continue; }
    if (lower === 'animals') { options.animals = true; continue; }
    if (/^\d{17,20}$/.test(arg)) { options.source = { type: 'id', id: arg }; continue; }
    const link = arg.match(/^<?https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)>?$/i);
    if (link) { options.source = { type: 'link', guildId: link[1], channelId: link[2], messageId: link[3] }; continue; }
    const pair = arg.match(/^([a-z]+)=(.+)$/i);
    if (!pair) return { error: 'Opsi tidak dikenal: `' + arg + '`. Gunakan `hbcalc help`.' };
    const key = pair[1].toLowerCase();
    const value = pair[2];
    if (key === 'all') { options.all = value; continue; }
    if (key === 'essence') {
      const n = numberFrom(value);
      if (n == null) return { error: 'Nilai essence tidak valid.' };
      options.ownedEssence = n;
      continue;
    }
    const traitKey = TRAIT_ALIASES[key];
    if (traitKey) { options.targets[traitKey] = value; continue; }
    return { error: 'Opsi tidak dikenal: `' + arg + '`. Gunakan `hbcalc help`.' };
  }
  return options;
}

async function getChannel(client, channelId) {
  if (!client?.channels) return null;
  if (client.channels.cache?.get) {
    const cached = client.channels.cache.get(channelId);
    if (cached) return cached;
  }
  if (client.channels.fetch) return client.channels.fetch(channelId).catch(() => null);
  return null;
}

async function fetchMessage(channel, messageId) {
  if (!channel?.messages?.fetch) return null;
  try { return await channel.messages.fetch(messageId); }
  catch { return null; }
}

async function fetchRecent(channel) {
  if (!channel?.messages?.fetch) return null;
  try { return await channel.messages.fetch({ limit: 50 }); }
  catch { return null; }
}

async function resolveSource(message, options) {
  const source = options.source;
  if (source?.type === 'link') {
    const channel = await getChannel(message.client, source.channelId);
    const found = await fetchMessage(channel, source.messageId);
    return found ? { message: found, via: 'link' } : null;
  }
  if (source?.type === 'id') {
    const found = await fetchMessage(message.channel, source.id);
    return found ? { message: found, via: 'id' } : null;
  }
  if (message.reference?.resolved) return { message: message.reference.resolved, via: 'reply' };
  if (message.reference?.messageId) {
    const found = await fetchMessage(message.channel, message.reference.messageId);
    if (found) return { message: found, via: 'reply' };
  }
  const collection = await fetchRecent(message.channel);
  if (!collection) return null;
  const messages = typeof collection.values === 'function' ? [...collection.values()] : Object.values(collection);
  for (const candidate of messages) {
    if (candidate?.id === message.id) continue;
    const parsed = parseHuntBotMessage(candidate);
    if (parsed) return { message: candidate, via: 'channel' };
  }
  return null;
}

function strictPayload(payload) {
  return { ...payload, allowedMentions: { parse: [], repliedUser: false } };
}

async function sendPages(target, embeds) {
  if (!embeds.length) return;
  const first = strictPayload({ embeds: [embeds[0]] });
  if (target?.reply) await target.reply(first);
  else if (target?.channel?.send) await target.channel.send(first);
  for (const embed of embeds.slice(1)) {
    if (target?.channel?.send) await target.channel.send(strictPayload({ embeds: [embed] }));
  }
}

async function sendText(target, content) {
  const payload = strictPayload({ content });
  if (target?.reply) await target.reply(payload);
  else if (target?.channel?.send) await target.channel.send(payload);
}

async function handleMessage(message) {
  if (!message || message.author?.bot) return false;
  const prefix = (message.guildId && getGuildSettings(message.guildId).prefix) || DEFAULT_PREFIX;
  const command = parseCommand(message.content, prefix);
  if (!command) return false;

  const options = parseOptions(command.args);
  if (options.error) { await sendText(message, options.error); return true; }
  if (options.help) { await sendPages(message, [helpEmbed()]); return true; }

  const source = await resolveSource(message, options);
  if (!source) {
    await sendText(message, 'Pesan HuntBot tidak ditemukan. Balas pesan HuntBot, kirim link/ID, atau jalankan di channel yang punya pesan HuntBot.');
    return true;
  }
  const parsed = parseHuntBotMessage(source.message);
  if (!parsed) {
    await sendText(message, 'Pesan sumber bukan kartu HuntBot yang bisa dibaca.');
    return true;
  }
  const calc = calculate(parsed, options);
  await sendPages(message, buildCalculationEmbeds(calc));
  return true;
}

async function autoReact(message) {
  if (!message || message.author?.id !== LUCY_BOT_ID) return false;
  if (!parseHuntBotMessage(message)) return false;
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
  const parsed = parseHuntBotMessage(message);
  if (!parsed) return false;
  const calc = calculate(parsed, {});
  await sendPages(message, buildCalculationEmbeds(calc));
  return true;
}

module.exports = {
  REACTION, LUCY_BOT_ID, TRAITS, MAX_ALL, cumulativeXp, parseHuntBotMessage,
  calculate, equivalents, buildCalculationEmbeds, helpEmbed, parseCommand, parseOptions,
  resolveSource, handleMessage, autoReact, handleReaction,
};
