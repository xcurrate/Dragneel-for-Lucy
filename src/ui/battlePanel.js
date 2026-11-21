// Embed untuk tim kustom & hasil simulasi.
//
// Warna mengikuti palet yang sudah dipakai bot (lihat services/reminders.js)
// supaya tampilan battle konsisten dengan panel dan game lain.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const data = require('../data/owoBattle');
const sim = require('../services/battleSim');
const engine = require('../services/battleEngine');
const { createRng } = require('../services/battleRng');
const dexStore = require('../utils/animalDexStorage');
const emoji = require('../services/battleEmoji');

const COLOR = { info: 0x5865F2, ok: 0x57F287, warn: 0xFEE75C, error: 0xED4245, panel: 0xEB459E };
const TEAM_BUTTON = 'battle_team_pick';
const ID_SEP = ':';
const MAX_SLOTS = data.limits.maxSlots;

// Seed tetap supaya stat di `d team show` tidak berubah tiap kali dibuka
// (pasif yang tidak disimpan di slot diundi dari RNG).
const DISPLAY_SEED = 1;

function weaponName(id) {
  if (!id) return null;
  const weapon = data.weapons().find(w => w.id === id);
  return weapon ? weapon.name : `#${id}`;
}

function bar(value, max, size = 12) {
  if (!max) return '▱'.repeat(size);
  const filled = Math.max(0, Math.min(size, Math.round((value / max) * size)));
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

// Ringkasan ikon satu slot: hewan, rank senjata, senjata, lalu pasif.
function slotIcon(entry) {
  const animal = entry.animalKey ? dexStore.resolveAnimal(entry.animalKey) : null;
  const parts = [emoji.animalEmoji(animal)];
  if (entry.weaponId) {
    parts.push(emoji.rankEmoji(entry.weaponQuality ?? data.DEFAULT_QUALITY));
    parts.push(emoji.weaponEmoji(entry.weaponId, entry.weaponQuality));
  }
  for (const id of entry.passives || []) parts.push(emoji.passiveEmoji(id, entry.weaponQuality));
  return parts.join('');
}

// Stat final satu slot, dihitung lewat mesin yang sama dengan simulasi supaya
// angka di `d team show` persis sama dengan yang dipakai battle.
function slotStats(entry) {
  if (!entry) return null;
  // Slot hanya menyimpan `animalKey`; objek dex-nya diambil dari storage.
  const animal = entry.animalKey ? dexStore.resolveAnimal(entry.animalKey) : null;
  const spec = {
    slot: entry.slot,
    label: entry.label || entry.animalKey || `slot${entry.slot}`,
    level: entry.level || data.DEFAULT_LEVEL,
    coeffs: entry.custom || (animal ? sim.dexStatsToCustom(animal) : null),
    finalStats: entry.finalStats || null,
    customStats: Boolean(entry.custom),
    animal,
    weapon: entry.weaponId
      ? { id: entry.weaponId, quality: entry.weaponQuality, passives: entry.passives }
      : null,
  };
  if (!spec.coeffs && !spec.finalStats) return null;
  try {
    const unit = engine.buildUnit(spec, createRng(DISPLAY_SEED), entry.weaponQuality);
    if (entry.finalStats) return { ...entry.finalStats };
    return {
      hp: Math.ceil(engine.maxHp(unit)),
      wp: Math.ceil(engine.maxWp(unit)),
      att: Math.ceil(unit.stats.att[0] + unit.stats.att[1]),
      mag: Math.ceil(unit.stats.mag[0] + unit.stats.mag[1]),
      pr: Math.round(engine.resToPercent(unit.stats.pr) * 100),
      mr: Math.round(engine.resToPercent(unit.stats.mr) * 100),
    };
  } catch {
    return null;
  }
}

// Emoji senjata + pasif beserta quality, mis. `<fabled><frstaff><fhgen> 100%`.
function weaponLine(entry) {
  if (!entry.weaponId) return '*tanpa senjata*';
  const quality = entry.weaponQuality ?? data.DEFAULT_QUALITY;
  const icons = [
    emoji.rankEmoji(quality),
    emoji.weaponEmoji(entry.weaponId, quality),
    ...(entry.passives || []).map(id => emoji.passiveEmoji(id, quality)),
  ].join('');
  return `${icons} ${quality}%`;
}

// Nama field kosong: Discord menolak nama kosong, jadi pakai karakter tak
// terlihat supaya slot kosong hanya menampilkan perintah pengisian.
const BLANK = '\u200b';

function addHint(prefix, slot) {
  return `*\`${prefix} team add ${slot} [level] <animal> [weapon]\`*`;
}

// Satu slot jadi satu field: judul `[1] L.100 <emoji> nama`, isi stat 4 baris.
function slotField(entry, slot, prefix) {
  if (!entry) return { name: BLANK, value: addHint(prefix, slot), inline: false };

  const animal = entry.animalKey ? dexStore.resolveAnimal(entry.animalKey) : null;
  const name = entry.label || animal?.name || entry.animalKey || 'custom';
  const level = entry.level || data.DEFAULT_LEVEL;
  const stats = slotStats(entry);

  const body = stats
    ? [
      `${emoji.statIcon('hp')} \`${stats.hp}\` ${emoji.statIcon('wp')} \`${stats.wp}\``,
      `${emoji.statIcon('att')} \`${stats.att}\` ${emoji.statIcon('mag')} \`${stats.mag}\``,
      `${emoji.statIcon('pr')} \`${stats.pr}%\` ${emoji.statIcon('mr')} \`${stats.mr}%\``,
      weaponLine(entry),
    ].join('\n')
    : '*stat tidak terbaca*';

  return {
    name: `[${slot}] L.${level} ${emoji.animalEmoji(animal)} ${name}`,
    value: body,
    inline: false,
  };
}

function teamEmbed(team, { prefix = 'd', active = false, slotId = null } = {}) {
  const id = slotId ?? team.slotId;
  const embed = new EmbedBuilder()
    .setColor(active ? COLOR.ok : COLOR.info)
    .setTitle(`🐾 ${id != null ? `[${id}] ` : ''}${team.name}`)
    .setFooter({
      text: `Team ${team.slots.length}/${MAX_SLOTS}${active ? ' · tim aktif' : ''}`
        + ` · Simulasi: ${prefix} sim`,
    });

  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    embed.addFields(slotField(team.slots.find(s => s.slot === slot), slot, prefix));
  }
  return embed;
}

function teamListEmbed(teams, active, prefix = 'd') {
  if (!teams.length) {
    return new EmbedBuilder()
      .setColor(COLOR.warn)
      .setTitle('🐾 Tim Battle')
      .setDescription(`Belum ada tim.\nBuat dengan \`${prefix} team new <nama>\`.`);
  }
  const lines = [...teams]
    .sort((a, b) => (a.slotId ?? 99) - (b.slotId ?? 99))
    .map(team => {
      const mark = active && active.id === team.id ? ' ✅' : '';
      const icons = team.slots.map(slot => slotIcon(slot)).join(' ');
      const detail = icons ? `\n${icons}` : '';
      const id = team.slotId != null ? `\`#${team.slotId}\` ` : '';
      return `${id}**${team.name}**${mark} — ${team.slots.length}/${MAX_SLOTS} slot${detail}`;
    });
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('🐾 Tim Battle')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Pilih lewat ${prefix} tm, atau ${prefix} team pick <id|nama>` });
}

// Warna mengikuti hasil: menang dominan hijau, kalah dominan merah, seimbang kuning.
function simColor(winRate) {
  if (winRate >= 55) return COLOR.ok;
  if (winRate <= 45) return COLOR.error;
  return COLOR.warn;
}

// Hasil sementara selama simulasi panjang masih berjalan. Angkanya dari tally
// yang sama dengan hasil akhir, jadi tidak ada hitungan ulang.
function simProgressEmbed(progress, { playerLabel = 'Tim kamu', enemyLabel = 'Lawan' } = {}) {
  const { done, total, tally } = progress;
  const percent = Math.min(100, Math.round((done / total) * 1000) / 10);
  const stats = [
    `Menang ${bar(tally.player, done)} ${tally.player} (${progress.winRate}%)`,
    `Kalah  ${bar(tally.enemy, done)} ${tally.enemy} (${progress.lossRate}%)`,
    `Seri   ${bar(tally.tie, done)} ${tally.tie} (${progress.tieRate}%)`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle('⚔️ Simulasi Battle — berjalan')
    .setDescription(`**${playerLabel}** vs **${enemyLabel}**\n\`\`\`\n${stats}\n\`\`\``)
    .addFields(
      { name: '⏳ Progres', value: `${bar(done, total)} ${percent}%`, inline: true },
      { name: '📊 Selesai', value: `**${done.toLocaleString('id-ID')}** / ${total.toLocaleString('id-ID')}`, inline: true },
      { name: '⏱️ Durasi', value: `Rata-rata **${progress.avgTurns}** turn`, inline: true }
    )
    .setFooter({ text: 'Hasil akhir menyusul.' });
}

function simEmbed(result, { playerLabel = 'Tim kamu', enemyLabel = 'Lawan', matchup = null } = {}) {
  const stats = [
    `Menang ${bar(result.tally.player, result.runs)} ${result.tally.player} (${result.winRate}%)`,
    `Kalah  ${bar(result.tally.enemy, result.runs)} ${result.tally.enemy} (${result.lossRate}%)`,
    `Seri   ${bar(result.tally.tie, result.runs)} ${result.tally.tie} (${result.tieRate}%)`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(simColor(result.winRate))
    .setTitle('⚔️ Simulasi Battle')
    .setDescription(`**${playerLabel}** vs **${enemyLabel}**\n\`\`\`\n${stats}\n\`\`\``)
    .addFields(
      { name: '📊 Total', value: `**${result.runs}** pertarungan`, inline: true },
      { name: '⏱️ Durasi', value: `Rata-rata **${result.turns.avg}** turn\nTercepat ${result.turns.min} · Terlama ${result.turns.max}`, inline: true },
      { name: '🎲 Seed', value: `\`${result.seed}\``, inline: true }
    )
    .setFooter({ text: `Pakai -s ${result.seed} untuk mengulang hasil ini` });

  if (matchup) embed.addFields({ name: '🪖 Komposisi', value: matchup, inline: false });
  if (result.timeouts) {
    embed.addFields({
      name: '⚠️ Batas turn',
      value: `${result.timeouts} pertarungan mencapai ${data.limits.maxTurns} turn dan dihitung seri.`,
      inline: false,
    });
  }
  return embed;
}

// Ringkasan komposisi kedua tim, dipakai sebagai field di embed simulasi.
function renderMatchup(playerSpecs, enemySpecs) {
  const describe = spec => {
    const label = spec.label || 'slot';
    const icon = emoji.animalEmoji(spec.animal);
    const weapon = spec.weapon
      ? ` + ${emoji.weaponEmoji(spec.weapon.id, spec.weapon.quality)} ${weaponName(spec.weapon.id) || 'senjata'}`
      : '';
    return `${icon} ${label} lv${spec.level}${weapon}`;
  };
  return [
    `**Kamu:** ${playerSpecs.map(describe).join(', ')}`,
    `**Lawan:** ${enemySpecs.map(describe).join(', ')}`,
  ].join('\n');
}

// Menerima string maupun array baris.
function usageEmbed(title, lines) {
  const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
  return new EmbedBuilder().setColor(COLOR.info).setTitle(title).setDescription(body);
}

// Pesan panduan/validasi: bukan error keras, tapi butuh perhatian.
function warnEmbed(message) {
  return new EmbedBuilder().setColor(COLOR.warn).setDescription(message);
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(COLOR.error).setDescription(message);
}

function okEmbed(message) {
  return new EmbedBuilder().setColor(COLOR.ok).setDescription(message);
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
  COLOR, TEAM_BUTTON, MAX_SLOTS,
  weaponName, bar, slotField, slotStats, slotIcon,
  teamEmbed, teamListEmbed, simEmbed, simProgressEmbed, simColor, renderMatchup, usageEmbed, errorEmbed, okEmbed, warnEmbed,
  teamButtons, isTeamButton, parseTeamButton,
};
