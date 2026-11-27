// Deteksi otomatis kartu boss Lucy dan kirim blueprint `d sim` tanpa command.
const { EmbedBuilder } = require('discord.js');
const { getGuildSettings, DEFAULT_PREFIX } = require('../utils/storage');
const {
  parseBossRaidImage,
  buildBossBlueprint,
  findRaidImageUrl,
} = require('./bossRaidBlueprint');

const processed = new Set();
const inFlight = new Set();
const attempts = new Map();
const MAX_ATTEMPTS = 3;
const MAX_REMEMBERED = 1000;

function rawMessage(message) {
  return typeof message?.toJSON === 'function' ? message.toJSON() : message;
}

function collectText(value, out, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) collectText(child, out, seen);
    return;
  }
  for (const key of ['content', 'text', 'title']) {
    if (typeof value[key] === 'string') out.push(value[key]);
  }
  for (const child of Object.values(value)) collectText(child, out, seen);
}

function isBossSpawn(message) {
  const raw = rawMessage(message);
  const text = [];
  collectText(raw?.components, text, new Set());
  collectText(raw?.embeds, text, new Set());
  if (typeof raw?.content === 'string') text.push(raw.content);
  const combined = text.join('\n');
  return /boss\s+telah\s+muncul/i.test(combined)
    && !/boss\s+(?:telah\s+)?(?:dikalahkan|kabur)/i.test(combined);
}

function cardLines(card) {
  const parts = [];
  if (card.name) parts.push(card.name);
  if (card.weapon) parts.push(card.weapon.name);
  if (card.passives.length) parts.push(card.passives.map(passive => passive.name).join(', '));
  if (card.stats) {
    const s = card.stats;
    parts.push(`HP ${s.hpCurrent}/${s.hpMax} · ATT ${s.att} · PR ${s.pr} · WP ${s.wp} · MAG ${s.mag} · MR ${s.mr}`);
  }
  return parts.join(' · ') || 'tidak terbaca';
}

function blueprintEmbed(parsed, built) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🖼️ Blueprint Boss Otomatis')
    .setDescription([
      `**Blueprint musuh**\n\`\`\`\n${built.blueprint}\n\`\`\``,
      `**Jalankan**\n\`\`\`\n${built.command}\n\`\`\``,
      'Ganti `<tim>` dengan timmu. `-eboss` menandai ketiga unit sebagai boss (Giant Slayer).',
      ...(built.warnings.length ? [`⚠️ ${built.warnings.join('\n⚠️ ')}`] : []),
    ].join('\n\n'))
    .setFooter({ text: 'Dibuat otomatis dari kartu boss Lucy' });
  for (const card of parsed.cards) {
    embed.addFields({ name: `Kartu ${card.slot}`, value: cardLines(card).slice(0, 1024) });
  }
  return embed;
}

async function downloadImage(url, fetchImpl = global.fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
    throw new Error('Ukuran gambar raid tidak valid.');
  }
  return bytes;
}

function remember(id) {
  processed.add(id);
  if (processed.size > MAX_REMEMBERED) processed.delete(processed.values().next().value);
}

async function handleMessage(message, deps = {}) {
  if (!message?.guildId) return null;
  const lucyBotId = deps.lucyBotId || process.env.LUCY_BOT_ID;
  if (!lucyBotId || message.author?.id !== lucyBotId) return null;
  const channelId = deps.channelId || process.env.LUCY_CHANNEL_ID;
  if (channelId && message.channelId !== channelId) return null;
  if (!isBossSpawn(message)) return null;

  const id = message.id;
  if (!id || processed.has(id) || inFlight.has(id)) return null;
  if ((attempts.get(id) || 0) >= MAX_ATTEMPTS) return null;
  const imageUrl = findRaidImageUrl(message);
  if (!imageUrl) return null;

  inFlight.add(id);
  try {
    const bytes = await downloadImage(imageUrl, deps.fetch);
    const parsed = await parseBossRaidImage(bytes);
    if (parsed.error) throw new Error(parsed.error);
    const prefix = (getGuildSettings(message.guildId).prefix || DEFAULT_PREFIX);
    const built = buildBossBlueprint(parsed.cards, { prefix });
    if (built.error) throw new Error(built.error);
    const embed = blueprintEmbed(parsed, built);
    if (deps.send) await deps.send(message, embed);
    else if (typeof message.reply === 'function') {
      await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
    } else {
      await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    remember(id);
    return { parsed, built };
  } catch (error) {
    attempts.set(id, (attempts.get(id) || 0) + 1);
    console.warn('[BossRaidAuto] Gagal membuat blueprint:', error.message);
    return null;
  } finally {
    inFlight.delete(id);
  }
}

function resetAutoState() {
  processed.clear();
  inFlight.clear();
  attempts.clear();
}

module.exports = {
  handleMessage,
  isBossSpawn,
  blueprintEmbed,
  downloadImage,
  resetAutoState,
};
