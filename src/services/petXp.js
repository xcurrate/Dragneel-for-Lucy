// Estimasi XP pet dari kartu tim Lucy.
//
// Kartu tim menampilkan `Lvl 83 [6,602,130/47,459,321]`. Angka di dalam
// kurung adalah XP sekarang / XP yang dibutuhkan untuk level berikutnya.
const { EmbedBuilder } = require('discord.js');

const XP_PER_WIN = 200;
const BATTLES_PER_DAY = 3000;
const MAX_SIMULATED_BATTLES = 10_000_000;

function xpForNextLevel(level) {
  const value = Number(level);
  if (!Number.isFinite(value) || value < 1) return null;
  return 1000 + Math.pow(value, 4);
}

// Bonus streak dari OwO: hanya di kelipatan 10/50/100/500/1000.
function bonusXpForStreak(streak) {
  const value = Math.max(0, Math.floor(Number(streak) || 0));
  let bonus = 0;
  if (value > 0 && value % 1000 === 0) bonus = 25 * (Math.sqrt(value / 100) * 100 + 500);
  else if (value > 0 && value % 500 === 0) bonus = 10 * (Math.sqrt(value / 100) * 100 + 500);
  else if (value > 0 && value % 100 === 0) bonus = 5 * (Math.sqrt(value / 100) * 100 + 500);
  else if (value > 0 && value % 50 === 0) bonus = 3 * (Math.sqrt(value / 100) * 100 + 500);
  else if (value > 0 && value % 10 === 0) bonus = Math.sqrt(value / 100) * 100 + 500;
  return Math.min(100000, Math.round(bonus));
}

// Total XP satu battle untuk kemenangan. Level lawan dianggap sama karena
// kartu tim tidak membawa level lawan.
function winXpForNextBattle(streak) {
  return XP_PER_WIN + bonusXpForStreak(streak + 1);
}

// Multiplier catch-up OwO: pet dengan level lebih rendah mendapat XP lebih banyak.
function levelMultiplier(level, highestLevel) {
  const value = Number(level);
  const highest = Number(highestLevel);
  if (!Number.isFinite(value) || !Number.isFinite(highest) || value >= highest) return 1;
  return Math.min(10, 2 + (highest - value) / 10);
}

function parseNumber(value) {
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

// Membaca bracket XP pada baris `Lvl`. Bracket lain seperti `[1/2]` bukan XP,
// jadi hasilnya hanya dipakai kalau nilai maksimum cocok dengan rumus level.
function parseProgress(text, level) {
  const match = String(text || '').match(/Lvl\s+\d+[^\n]*?\[([^\]]+)\]/i);
  if (!match) return { current: null, max: null, maxed: false };
  const raw = match[1].trim();
  if (/^MAX$/i.test(raw)) return { current: null, max: null, maxed: true };
  const pair = raw.match(/^([\d,]+)\s*\/\s*([\d,]+)$/);
  if (!pair) return { current: null, max: null, maxed: false };
  const current = parseNumber(pair[1]);
  const max = parseNumber(pair[2]);
  const expected = xpForNextLevel(level);
  if (current == null || max == null || expected == null || max !== expected) {
    return { current: null, max: null, maxed: false };
  }
  return { current, max, maxed: false };
}

function simulateBattles(remaining, {
  streak = 0,
  teamCount = 1,
  active = true,
  multiplier = 1,
  battlesPerDay = BATTLES_PER_DAY,
  tieRate = 0,
  maxStreak = null,
  extraXpPerBattle = 0,
  xpMultiplier = 1,
} = {}) {
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { battles: 0, gained: 0, xpPerBattle: 0, days: 0, streakAfter: Number(streak) || 0 };
  }
  const count = Math.max(1, Math.floor(Number(teamCount) || 1));
  let currentStreak = Math.max(0, Math.floor(Number(streak) || 0));
  const cap = Number.isFinite(maxStreak) && maxStreak > 0 ? Math.floor(maxStreak) : Infinity;
  const tieEvery = tieRate > 0 ? Math.max(1, Math.round(100 / Number(tieRate))) : 0;
  let gained = 0;
  let battles = 0;
  while (gained < remaining && battles < MAX_SIMULATED_BATTLES) {
    battles += 1;
    const isTie = tieEvery > 0 && battles % tieEvery === 0;
    let total;
    if (isTie) {
      total = 100;
    } else {
      currentStreak = Math.min(cap, currentStreak + 1);
      total = XP_PER_WIN + bonusXpForStreak(currentStreak);
    }
    const boosted = Math.round(total * (Number(xpMultiplier) || 1));
    const share = active ? Math.ceil(boosted / count) : Math.floor(boosted / count);
    const perPet = Math.max(1, Math.round((share + extraXpPerBattle) * multiplier));
    gained += perPet;
  }
  return {
    battles,
    gained,
    xpPerBattle: battles ? gained / battles : 0,
    days: battles / battlesPerDay,
    streakAfter: currentStreak,
  };
}

function estimate(slot, {
  teamCount = 1,
  active = true,
  streak = 0,
  highestLevel = slot?.level,
  battlesPerDay = BATTLES_PER_DAY,
  tieRate = 0,
  maxStreak = null,
  extraXpPerBattle = 0,
  xpMultiplier = 1,
} = {}) {
  if (slot?.xpMaxed) return { maxed: true, remaining: 0, battles: 0, days: 0, xpPerBattle: null };
  if (!Number.isFinite(slot?.xpCurrent) || !Number.isFinite(slot?.xpMax)) return null;
  const remaining = Math.max(0, slot.xpMax - slot.xpCurrent);
  const multiplier = levelMultiplier(slot.level, highestLevel);
  const simulated = simulateBattles(remaining, {
    streak,
    teamCount,
    active,
    multiplier,
    battlesPerDay,
    tieRate,
    maxStreak,
    extraXpPerBattle,
    xpMultiplier,
  });
  return {
    maxed: false,
    remaining,
    multiplier,
    xpPerBattle: simulated.xpPerBattle,
    battles: simulated.battles,
    days: simulated.days,
    streakAfter: simulated.streakAfter,
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function formatDecimal(value) {
  return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

function formatDays(value) {
  if (value <= 0) return '0';
  return String(Math.ceil(value));
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function clip(value, length) {
  const text = String(value == null ? '' : value);
  return text.length <= length ? text : text.slice(0, length - 1) + '…';
}

function buildEmbed(parsed) {
  const teamCount = Number.isFinite(parsed.teamCount) && parsed.teamCount > 0 ? parsed.teamCount : 1;
  const active = parsed.isActive !== false;
  const streak = Number.isFinite(parsed.streak) ? parsed.streak : null;
  const highestLevel = parsed.slots.reduce((max, slot) => (
    Number.isFinite(slot.level) && slot.level > max ? slot.level : max
  ), 1);
  const rows = parsed.slots.map(slot => {
    const est = estimate(slot, {
      teamCount,
      active,
      streak: streak == null ? 0 : streak,
      highestLevel,
    });
    return {
      slot: String(slot.slot),
      name: clip(slot.label || slot.headerEmoji || '—', 18),
      level: String(slot.level ?? '?'),
      remaining: est?.maxed ? 'MAX' : est ? formatNumber(est.remaining) : '—',
      xpPerBattle: est?.maxed ? '—' : est ? formatDecimal(est.xpPerBattle) : '—',
      battles: est?.maxed ? '—' : est ? formatNumber(est.battles) : '—',
      days: est?.maxed ? '—' : est ? formatDays(est.days) : '—',
    };
  });
  const hasXp = parsed.slots.some(slot => slot.xpMaxed || estimate(slot, {
    teamCount,
    active,
    streak: streak == null ? 0 : streak,
    highestLevel,
  }));
  const header = [
    pad('#', 2), pad('Hewan', 18), pad('Lvl', 4),
    pad('Sisa XP', 14), pad('XP/battle', 9), pad('Battle', 9), 'Hari',
  ].join(' ');
  const lines = rows.map(row => [
    pad(row.slot, 2), pad(row.name, 18), pad(row.level, 4),
    pad(row.remaining, 14), pad(row.xpPerBattle, 9), pad(row.battles, 9), row.days,
  ].join(' '));
  const table = [header, ...lines].join('\n');
  const description = hasXp
    ? '```text\n' + table + '\n```'
    : 'Kartu ini tidak menampilkan progres XP pet.';
  const notes = [];
  if (parsed.teamCount == null) notes.push('jumlah tim tidak terbaca, dianggap 1');
  if (streak == null) notes.push('streak tidak terbaca, dianggap 0');
  if (parsed.isActive == null) notes.push('status tim tidak terbaca, dianggap aktif');
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(clip('📊 Estimasi XP — ' + (parsed.name || 'Lucy team'), 256))
    .setDescription(description)
    .setFooter({
      text: `Exact OwO: 200 + bonus ${streak == null ? 'streak (tidak terbaca)' : 'streak ' + formatNumber(streak)}, `
        + `level lawan dianggap sama, tim ${active ? 'aktif ceil' : 'nonaktif floor'} dibagi ${teamCount}, `
        + `${BATTLES_PER_DAY.toLocaleString('id-ID')} battle/hari.`
        + (notes.length ? ` ⚠️ ${notes.join('; ')}.` : ''),
    });
}

module.exports = {
  XP_PER_WIN,
  BATTLES_PER_DAY,
  xpForNextLevel,
  bonusXpForStreak,
  winXpForNextBattle,
  levelMultiplier,
  parseProgress,
  simulateBattles,
  estimate,
  buildEmbed,
};
