// Render teks untuk tim kustom & hasil simulasi.
//
// Sengaja memakai teks biasa (bukan embed) agar bisa dipakai di DM, prefix, dan
// slash tanpa duplikasi, dan supaya mudah diuji.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const data = require('../data/owoBattle');
const sim = require('../services/battleSim');

const TEAM_BUTTON = 'battle_team_pick';
const ID_SEP = ':';

const STAT_ORDER = ['hp', 'att', 'pr', 'wp', 'mag', 'mr'];

function statLine(coeffs) {
  return STAT_ORDER.map(k => `${sim.STAT_LABELS[k]} ${coeffs[k] ?? 0}`).join(' · ');
}

function weaponName(id) {
  if (!id) return null;
  const weapon = data.weapons().find(w => w.id === id);
  return weapon ? weapon.name : `#${id}`;
}

function renderTeam(team, { prefix = 'd' } = {}) {
  if (!team) return 'Tim tidak ditemukan.';
  const lines = [`**${team.name}** — ${team.slots.length}/3 slot terisi`];
  for (let slot = 1; slot <= 3; slot++) {
    const entry = team.slots.find(s => s.slot === slot);
    if (!entry) { lines.push(`\`${slot}\` — kosong`); continue; }
    const name = entry.label || entry.animalKey || 'custom';
    const weapon = weaponName(entry.weaponId);
    const coeffs = entry.custom || null;
    lines.push(`\`${slot}\` **${name}** lv${entry.level}` +
      (weapon ? ` · ${weapon}` : '') +
      (coeffs ? `\n    ${statLine(coeffs)}` : ''));
  }
  lines.push('', `Isi slot: \`${prefix} team add <slot> <hewan|stat>\` · Simulasi: \`${prefix} sim\``);
  return lines.join('\n');
}

function renderTeamList(teams, active, prefix = 'd') {
  if (!teams.length) {
    return `Belum ada tim. Buat dengan \`${prefix} team new <nama>\`.`;
  }
  const lines = ['**Tim kamu**'];
  for (const team of teams) {
    const mark = active && active.id === team.id ? ' ← aktif' : '';
    lines.push(`• **${team.name}**${mark} — ${team.slots.length}/3 slot`);
  }
  lines.push('', `Pilih tim: \`${prefix} team pick <nama>\` · Lihat isi: \`${prefix} team show\``);
  return lines.join('\n');
}

function bar(value, max, size = 10) {
  if (!max) return '▱'.repeat(size);
  const filled = Math.max(0, Math.min(size, Math.round((value / max) * size)));
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

// Ringkasan hasil batch simulasi.
function renderSimulation(result, { playerLabel = 'Tim kamu', enemyLabel = 'Lawan', seed } = {}) {
  const lines = [
    `**Simulasi battle** — ${result.runs}x`,
    `**${playerLabel}** vs **${enemyLabel}**`,
    '',
    `Menang ${bar(result.tally.player, result.runs)} ${result.tally.player} (${result.winRate}%)`,
    `Kalah  ${bar(result.tally.enemy, result.runs)} ${result.tally.enemy} (${result.lossRate}%)`,
    `Seri   ${bar(result.tally.tie, result.runs)} ${result.tally.tie} (${result.tieRate}%)`,
    '',
    `Durasi: rata-rata ${result.turns.avg} turn · tercepat ${result.turns.min} · terlama ${result.turns.max}`,
  ];
  if (result.timeouts) {
    lines.push(`⚠️ ${result.timeouts} pertarungan melewati batas ${data.limits.maxTurns} turn (dihitung seri).`);
  }
  lines.push('', `Seed: \`${seed ?? result.seed}\` — pakai \`seed=\` yang sama untuk mengulang hasil ini.`);
  return lines.join('\n');
}

// Perbandingan singkat komposisi kedua tim.
function renderMatchup(playerSpecs, enemySpecs) {
  const describe = specs => specs.map(s => {
    const label = s.label || 'custom';
    const weapon = s.weapon ? ` + ${weaponName(s.weapon.id)}` : '';
    return `${label} lv${s.level}${weapon}`;
  }).join(', ');
  return `Kamu: ${describe(playerSpecs)}\nLawan: ${describe(enemySpecs)}`;
}

// Tombol pemilih tim. customId memuat userId + index tim (bukan nama, karena
// nama bisa mengandung karakter yang tidak aman untuk customId).
function teamButtons(teams, active, userId) {
  if (!teams.length) return [];
  const rows = [];
  let row = new ActionRowBuilder();
  teams.slice(0, 15).forEach((team, index) => {
    const isActive = active && active.id === team.id;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${TEAM_BUTTON}${ID_SEP}${userId}${ID_SEP}${index}`)
        .setLabel(`${isActive ? '✓ ' : ''}${team.name}`.slice(0, 80))
        .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    // Discord membatasi 5 tombol per baris.
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
  });
  if (row.components.length) rows.push(row);
  return rows;
}

function isTeamButton(customId) {
  return typeof customId === 'string' && customId.startsWith(`${TEAM_BUTTON}${ID_SEP}`);
}

function parseTeamButton(customId) {
  const parts = String(customId || '').split(ID_SEP);
  if (parts.length !== 3 || parts[0] !== TEAM_BUTTON) return { ok: false };
  const index = Number(parts[2]);
  if (!Number.isInteger(index) || index < 0) return { ok: false };
  return { ok: true, userId: parts[1], index };
}

module.exports = {
  renderTeam, renderTeamList, renderSimulation, renderMatchup, statLine, weaponName, bar, STAT_ORDER,
  teamButtons, isTeamButton, parseTeamButton, TEAM_BUTTON,
};
