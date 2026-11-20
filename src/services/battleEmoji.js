// Emoji untuk tampilan battle: hewan, senjata, pasif, dan stat.
//
// Token emoji OwO berasal dari aplikasi lain, jadi tidak bisa dirender bot ini
// sebelum di-mirror ke aplikasi bot (mekanismenya sama dengan dex, lihat
// `services/animalDex.js`). Mirror dijalankan sekali saat start; render hanya
// membaca cache supaya tetap sinkron.
const data = require('../data/owoBattle');
const passiveData = require('../data/owoPassives.json');
const dexStore = require('../utils/animalDexStorage');
const dex = require('./animalDex');

// Ambang rank OwO: 7 tingkat (common → fabled). Emoji senjata/pasif disusun
// mengikuti urutan ini, jadi index-nya ditentukan dari quality.
const RANK_THRESHOLDS = [0.2, 0.2, 0.2, 0.2, 0.14, 0.05, 0.01];
const RANK_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythical', 'Legendary', 'Fabled'];

const FALLBACK = { weapon: '⚔️', passive: '✨', animal: '🐾', stat: '•' };

function rankIndex(quality) {
  const q = Math.min(100, Math.max(0, Number(quality) || 0)) / 100;
  let acc = 0;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    acc += RANK_THRESHOLDS[i];
    if (q <= acc) return i;
  }
  return RANK_THRESHOLDS.length - 1;
}

function rankName(quality) {
  return RANK_NAMES[rankIndex(quality)];
}

// Token hasil mirror bila sudah ada, kalau belum pakai emoji unicode supaya
// tampilan tidak menampilkan teks mentah `<:nama:id>`.
function resolve(token, fallback) {
  if (!token) return fallback;
  const id = /:(\d+)>$/.exec(token);
  const mapped = id ? dexStore.getEmojiToken(id[1]) : null;
  return mapped || fallback;
}

// Tanpa quality, rank tidak diketahui (simulasi me-roll acak), jadi pakai ikon
// netral daripada menampilkan rank yang salah.
function pick(list, quality) {
  if (!Array.isArray(list) || !list.length || quality == null) return null;
  return list[rankIndex(quality)] || null;
}

function emojiFor(list, quality, fallback) {
  return resolve(pick(list, quality), fallback);
}

function weaponToken(id, quality) {
  return pick(data.weapons().find(w => w.id === Number(id))?.emojis, quality);
}

function passiveToken(id, quality) {
  return pick(passiveData.passives.find(p => p.id === Number(id))?.emojis, quality);
}

function weaponEmoji(id, quality) {
  return resolve(weaponToken(id, quality), FALLBACK.weapon);
}

function passiveEmoji(id, quality) {
  return resolve(passiveToken(id, quality), FALLBACK.passive);
}

// Hewan memakai emoji dari dex (hasil tangkapan Lucy), bukan dari data battle.
function animalEmoji(animal) {
  if (!animal) return FALLBACK.animal;
  const token = dex.animalEmoji(animal);
  return resolve(token, FALLBACK.animal);
}

// Data battle memakai kunci pendek (att/pr/wp/mag), dex memakai nama panjang.
const STAT_KEY_MAP = { hp: 'hp', att: 'attack', pr: 'protection', wp: 'wisdom', mag: 'magic', mr: 'mr' };

function statIcon(key) {
  return resolve(dex.STAT_ICONS[STAT_KEY_MAP[key] || key], FALLBACK.stat);
}

// Semua token yang perlu di-mirror agar battle tampil penuh.
function allTokens() {
  const tokens = [];
  for (const weapon of data.weapons()) tokens.push(...(weapon.emojis || []));
  for (const passive of passiveData.passives) tokens.push(...(passive.emojis || []));
  tokens.push(...Object.values(dex.STAT_ICONS));
  return [...new Set(tokens)];
}

async function syncEmojis() {
  await dex.mirrorEmojiTokens(allTokens());
}

module.exports = {
  RANK_NAMES, rankIndex, rankName,
  weaponEmoji, passiveEmoji, animalEmoji, statIcon, allTokens, syncEmojis,
  weaponToken, passiveToken,
};
