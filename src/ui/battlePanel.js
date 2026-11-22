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

const COLOR = { info: 0x5865F2, ok: 0x57F287, warn: 0xFEE75C, error: 0xED4245, panel: 0xEB459E, blue: 0x3498DB, tie: 0x95A5A6 };
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

// Hasil sementara selama simulasi panjang masih berjalan. Angkanya dari tally
// yang sama dengan hasil akhir, jadi tidak ada hitungan ulang.
function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} menit ${seconds % 60} detik`;
}

function simProgressEmbed(progress, { playerLabel = 'Tim kamu', enemyLabel = 'Lawan', title = null, mode = null } = {}) {
  const { done, total, tally } = progress;
  const percent = Math.min(100, Math.round((done / total) * 1000) / 10);

  return new EmbedBuilder()
    .setColor(mode === 'global' ? COLOR.blue : COLOR.warn)
    .setTitle(title || `${playerLabel} vs. ${enemyLabel}`)
    .setDescription(`⏳ **Berjalan** — ${percent}%\n\`${bar(done, total)}\``)
    .addFields(
      { name: `🏆 **${tally.player.toLocaleString('id-ID')}** menang (${progress.winRate}%)`, value: `\`${bar(tally.player, done)}\``, inline: false },
      { name: '📊 Selesai', value: `**${done.toLocaleString('id-ID')}** / ${total.toLocaleString('id-ID')}`, inline: true },
      {
        name: '⏱️ Perkiraan',
        // `etaMs` hanya ada pada simulasi global; simulasi duel memakai rata-rata
        // turn. Saat global belum punya satu pun sampel, ETA belum bisa dihitung.
        value: progress.queued
          ? 'Menunggu antrean…'
          : progress.etaMs != null
            ? `Sisa ~**${formatDuration(progress.etaMs)}**`
            : mode === 'global' ? 'Menghitung…' : `Rata-rata **${progress.avgTurns}** turn`,
        inline: true,
      }
    )
    .setFooter({ text: 'Hasil akhir menyusul.' });
}

// Warna mengikuti dominasi hasil: menang hijau, kalah merah, seri abu-abu.
function simColor(winRate, lossRate = null, tieRate = null) {
  if (lossRate != null && tieRate != null) {
    if (winRate > lossRate && winRate > tieRate) return COLOR.ok;
    if (lossRate > winRate && lossRate > tieRate) return COLOR.error;
    return COLOR.tie;
  }
  if (winRate >= 55) return COLOR.ok;
  if (winRate <= 45) return COLOR.error;
  return COLOR.warn;
}

// "0s", "12s", "1m 5s" — durasi simulasi di footer.
function shortDuration(ms) {
  const seconds = Math.max(0, Math.round((ms || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// Distribusi turn ringkas: "16 (×4), 17 (×10), 18 (×14)".
// Bila terlalu banyak baris, sisanya diringkas agar field tidak terpotong.
function turnDistribution(histogram, limit = 12) {
  if (!histogram || !histogram.length) return '-';
  const shown = histogram.slice(0, limit)
    .map(({ turns, count }) => `${turns} (×${count.toLocaleString('id-ID')})`);
  const rest = histogram.length - limit;
  return shown.join(', ') + (rest > 0 ? `, +${rest} lain` : '');
}

// Satu baris komposisi satu sisi: level, hewan, senjata, pasif, quality.
function sideLine(spec) {
  const icons = [emoji.animalEmoji(spec.animal)];
  if (spec.weapon) {
    // `spec.displayQuality` = hasil akhir dari flag -qp/-qe yang menimpa
    // kualitas slot. Tanpa ini komposisi menampilkan tier database, bukan tier
    // yang benar-benar dipakai simulasi (dan tombol 🔁 jadi berbeda).
    const quality = spec.displayQuality ?? spec.weapon.quality ?? data.DEFAULT_QUALITY;
    icons.push(emoji.rankEmoji(quality), emoji.weaponEmoji(spec.weapon.id, quality));
    for (const id of spec.weapon.passives || []) icons.push(emoji.passiveEmoji(id, quality));
    icons.push(`${quality}%`);
  }
  const name = spec.label ? ` ${spec.label}` : '';
  return `**\`L.${spec.level}\`**${name} ${icons.join('')}`.trimEnd();
}

// Satu blok komposisi: nama tim sebagai judul, lalu isi slot di bawahnya.
function sideBlock(label, specs) {
  const rows = specs.map((spec, i) => `> \`${i + 1}\` ${sideLine(spec)}`);
  return [`**${label}**`, ...rows].join('\n');
}

// Ringkasan komposisi kedua tim, dipakai sebagai isi description embed.
// Nama tim dipakai sebagai pemisah karena keduanya tampil berurutan.
function renderMatchup(playerSpecs, enemySpecs, { playerLabel = 'Tim kamu', enemyLabel = 'Lawan' } = {}) {
  return [sideBlock(playerLabel, playerSpecs), sideBlock(enemyLabel, enemySpecs)].join('\n');
}

// Satu unit versi ringkas untuk hasil satu pertarungan: baris pertama kondisi
// akhir HP/WP, baris kedua senjata bila ada.
function duelUnitLines(unit) {
  const maxHpValue = Math.ceil(engine.maxHp(unit));
  const maxWpValue = Math.ceil(engine.maxWp(unit));
  const hp = Math.max(0, Math.ceil(unit.stats.hp[0]));
  const wp = Math.max(0, Math.ceil(unit.stats.wp[0]));
  const head = `> ${emoji.statIcon('hp')} \`${hp}/${maxHpValue}\` ${emoji.statIcon('wp')} \`${wp}/${maxWpValue}\``;
  const body = `> **L.${unit.level}** ${emoji.animalEmoji(unit.animal)} ${unit.nickname}`;
  if (!unit.weapon) return `${body}\n${head}`;
  const quality = unit.weapon.quality ?? data.DEFAULT_QUALITY;
  const icons = [emoji.rankEmoji(quality), emoji.weaponEmoji(unit.weapon.id, quality)];
  return `${body}\n${head}\n> ${icons.join('')} ${quality}%`;
}

// Satu field per tim. Nama tim dipakai sebagai pemisah supaya jelas sisi mana
// yang menang dan mana yang kalah.
function duelTeamField(label, units) {
  return {
    name: `**${label}**`,
    value: units.map(duelUnitLines).join('\n'),
    inline: false,
  };
}

// Hasil satu pertarungan: kondisi akhir tiap unit, bukan statistik agregat.
//
// `stats` = hasil agregat `sim.simulate` untuk matchup yang sama (opsional).
// Kalau ada, footer menampilkan rekap menang/seri/kalah sekaligus supaya user
// tidak perlu menjalankan `-m` terpisah hanya untuk tahu rasio akhirnya.
function duelEmbed(battle, {
  playerLabel = 'Tim kamu', enemyLabel = 'Lawan', elapsedMs = 0, seed = null, stats = null,
} = {}) {
  const { units, winner, turns, timeout } = battle;
  const color = winner === 'player' ? COLOR.ok : winner === 'enemy' ? COLOR.error : COLOR.tie;
  const verdict = winner === 'player' ? 'Menang' : winner === 'enemy' ? 'Kalah' : 'Seri';
  const icon = winner === 'player' ? '🏆' : winner === 'enemy' ? '💀' : '⚖️';

  // Footer tidak mendukung markdown: `**tebal**` akan tampil sebagai tanda bintang
  // mentah di Discord, jadi teks footer sengaja tanpa penanda apa pun.
  const footer = stats
    ? `${icon} kamu ${verdict.toLowerCase()} dalam ${turns} turn${timeout ? ' (batas turn)' : ''}`
      + ` | 🎲 ${stats.tally.player} win, ${stats.tally.enemy} lose, ${stats.tally.tie} tie`
    : `1 pertarungan | ${shortDuration(elapsedMs)} ⚡${seed != null ? ` | seed ${seed}` : ''}`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${playerLabel} vs. ${enemyLabel}`)
    .setDescription(`${icon} **${verdict}** dalam ${turns} turn${timeout ? ' (batas turn)' : ''}`)
    .addFields([
      duelTeamField(playerLabel, units.player),
      duelTeamField(enemyLabel, units.enemy),
    ])
    .setFooter({ text: footer });
}

function simEmbed(result, { playerLabel = 'Tim kamu', enemyLabel = 'Lawan', matchup = null } = {}) {
  const { tally, runs } = result;
  const color = simColor(result.winRate, result.lossRate, result.tieRate);
  const turns = `**Turns:** ${turnDistribution(result.turnHistogram)}`;

  // Hasil utama selalu tampil; kalah dan seri hanya bila ada, supaya embed
  // tidak penuh field kosong saat satu sisi mendominasi.
  const fields = [
    {
      name: `🏆 **${tally.player.toLocaleString('id-ID')}** menang (${result.winRate}%)`,
      value: turns,
      inline: false,
    },
  ];
  if (tally.enemy) {
    fields.push({
      name: `💀 **${tally.enemy.toLocaleString('id-ID')}** kalah (${result.lossRate}%)`,
      value: `\`${bar(tally.enemy, runs)}\``,
      inline: false,
    });
  }
  if (tally.tie) {
    fields.push({
      name: `⚖️ **${tally.tie.toLocaleString('id-ID')}** seri (${result.tieRate}%)`,
      value: `\`${bar(tally.tie, runs)}\``
        + (result.timeouts ? `\n${result.timeouts} mencapai batas ${data.limits.maxTurns} turn` : ''),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${playerLabel} vs. ${enemyLabel}`)
    .addFields(fields)
    .setFooter({
      text: `Hasil dari ${runs.toLocaleString('id-ID')} simulasi`
        + ` | ${shortDuration(result.elapsedMs)} ⚡ | seed ${result.seed}`,
    });

  // Discord menolak description kosong, jadi hanya dipasang bila ada isinya.
  if (matchup) embed.setDescription(matchup);
  return embed;
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

// Tombol "lihat kekalahan" pada hasil simulasi global. customId membawa userId
// supaya hasil milik orang lain tidak bisa dibuka, dan `token` supaya tombol
// lama tidak menampilkan data dari simulasi yang sudah digantikan.
const GLOBAL_BUTTON = 'battle_global_losses';
// Tombol 🔁 pada hasil satu pertarungan: ulangi sebagai `-m <runs>`.
const REPEAT_BUTTON = 'battle_sim_repeat';

function globalLossButton(userId, token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GLOBAL_BUTTON}${ID_SEP}${userId}${ID_SEP}${token}`)
      .setLabel('Lihat kekalahan')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Danger)
  );
}

function isGlobalLossButton(customId) {
  return typeof customId === 'string' && customId.startsWith(`${GLOBAL_BUTTON}${ID_SEP}`);
}

function parseGlobalLossButton(customId) {
  const parts = String(customId || '').split(ID_SEP);
  if (parts.length !== 3 || parts[0] !== GLOBAL_BUTTON) return { ok: false };
  return { ok: true, userId: parts[1], token: parts[2] };
}

// Tombol ulang: `battle_sim_repeat:<userId>:<token>`.
function repeatButton(userId, token, runs) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${REPEAT_BUTTON}${ID_SEP}${userId}${ID_SEP}${token}`)
      .setLabel(String(runs))
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary)
  );
}

function isRepeatButton(customId) {
  return typeof customId === 'string' && customId.startsWith(`${REPEAT_BUTTON}${ID_SEP}`);
}

function parseRepeatButton(customId) {
  const parts = String(customId || '').split(ID_SEP);
  if (parts.length !== 3 || parts[0] !== REPEAT_BUTTON) return { ok: false };
  return { ok: true, userId: parts[1], token: parts[2] };
}

function percent(value) {
  return `${Number(value || 0).toLocaleString('id-ID')}%`;
}

// Komposisi tim pemain pada simulasi global. Senjata dan pasif sengaja tidak
// ditampilkan: yang dibutuhkan di sini hanya gambaran pet dan levelnya.
function teamCompLines(specs) {
  if (!specs || !specs.length) return '*Tim kosong.*';
  return specs.map((spec, index) => {
    const slot = spec.slot || index + 1;
    const label = spec.label || `slot${slot}`;
    return `\`${slot}\` L.${spec.level} ${emoji.animalEmoji(spec.animal)} ${label}`;
  }).join('\n');
}

// Satu kelompok level pada laporan: jumlah tim, rata-rata level, dan hasil.
function bucketLines(bucket) {
  if (!bucket.teams) {
    return `*Tidak ada tim lawan di kelompok ini.*`;
  }
  const { tally } = bucket;
  return [
    `**${tally.player.toLocaleString('id-ID')}** menang · **${tally.tie.toLocaleString('id-ID')}** seri · **${tally.enemy.toLocaleString('id-ID')}** kalah`,
    `-# ${bucket.teams.toLocaleString('id-ID')} tim · rata-rata L.**${bucket.avgLevel}** · ${bucket.battles.toLocaleString('id-ID')} pertarungan`,
  ].join('\n');
}

// Hasil simulasi global. Angka utama ditaruh di description mengikuti gaya
// laporan yang sudah dipakai bot lain, lalu rincian per kelompok level.
function globalSimEmbed(result, { playerLabel = 'Tim kamu', prefix = 'd', playerSpecs = null, skipped = [], totals = null } = {}) {
  const seconds = (result.durationMs / 1000).toFixed(2);
  const low = result.buckets.low;
  const high = result.buckets.high;

  const embed = new EmbedBuilder()
    .setColor(COLOR.blue)
    .setTitle('🌍 Simulasi Global')
    .setDescription([
      `### Hasil Simulasi Global (${seconds}s)`,
      `**Tim kamu:** ${playerLabel}`,
      `**Lawan:** ${result.opponents.toLocaleString('id-ID')} tim · ${result.battles.toLocaleString('id-ID')} pertarungan (${result.runs.toLocaleString('id-ID')}× per tim)`,
      ...(totals
        ? [`-# ${totals.all.toLocaleString('id-ID')} tim di \`${prefix}tm\` · `
          + `1 sedang dipilih (tidak diadu) · `
          + `${(skipped.length).toLocaleString('id-ID')} dilewati`]
        : []),
      `-# ${result.workers || 1} worker · ${Math.round(result.battles / Math.max(1, result.durationMs / 1000)).toLocaleString('id-ID')} pertarungan/detik`,
    ].join('\n'))
    .addFields(
      {
        name: '🪖 Komposisi tim kamu',
        value: teamCompLines(playerSpecs),
        inline: false,
      },
      {
        name: `🔅 ${low.label}`,
        value: bucketLines(low),
        inline: false,
      },
      {
        name: `🔆 ${high.label}`,
        value: bucketLines(high),
        inline: false,
      },
      {
        name: '📊 Rekap',
        value: [
          `Menang **${result.tally.player.toLocaleString('id-ID')}** (${percent(result.winRate)})`,
          `Seri **${result.tally.tie.toLocaleString('id-ID')}** (${percent(result.tieRate)})`,
          `Kalah **${result.tally.enemy.toLocaleString('id-ID')}** (${percent(result.lossRate)})`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🔥 Streak',
        value: [
          `Rata-rata **${result.streak.avg.toLocaleString('id-ID')}**`,
          `Terpanjang **${result.streak.max.toLocaleString('id-ID')}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📉 Kalah per tim',
        value: `Rata-rata **${result.avgLosses.toLocaleString('id-ID')}**`,
        inline: true,
      },
    )
    .setFooter({ text: `Seed ${result.seed} · hasil bisa berbeda karena RNG · cooldown ${prefix} sim global 10 detik` });

  if (!result.tally.enemy) {
    embed.addFields({ name: '🏆 Tanpa kekalahan', value: 'Tidak ada tim lawan yang berhasil mengalahkan tim kamu.' });
  }
  // Tim yang tidak bisa diadu tetap disebutkan supaya selisih jumlah dengan
  // `dtm` bisa dijelaskan, bukan terlihat seperti bug.
  if (skipped.length) {
    const describe = item => (typeof item === 'string' ? item : `${item.label} (${item.reason})`);
    const names = skipped.slice(0, 5).map(describe).join(', ');
    const more = skipped.length > 5 ? `, +${skipped.length - 5} lain` : '';
    embed.addFields({
      name: '⚠️ Tim dilewati',
      value: `${skipped.length} tim tidak diadu: ${names}${more}.\n`
        + '-# Isi slot kosong dan lengkapi stat agar tim ikut simulasi.',
    });
  }
  return embed;
}

// Ikon senjata disembunyikan saat membuka daftar kekalahan: lawan tidak perlu
// tahu senjata apa yang dipakai tim yang mengalahkan kamu.
const HIDDEN_WEAPON = '❓';

// Slot tanpa senjata tidak diberi tanda tanya: itu akan menyiratkan ada senjata
// yang disembunyikan padahal memang kosong.
function hiddenSpecLine(spec, index) {
  const label = spec.label || `slot${spec.slot || index + 1}`;
  const weapon = spec.weapon ? ` ${HIDDEN_WEAPON}` : '';
  return `\`${spec.slot || index + 1}\` L.${spec.level} ${emoji.animalEmoji(spec.animal)} ${label}${weapon}`;
}

// Daftar tim yang mengalahkan pemain, dipakai sebagai balasan ephemeral.
function globalLossesEmbed(result, { playerLabel = 'Tim kamu' } = {}) {
  const embed = new EmbedBuilder()
    .setColor(COLOR.error)
    .setTitle('🔍 Tim yang mengalahkan kamu');

  if (!result.losses.length) {
    return embed.setDescription(
      `**${playerLabel}** tidak kalah dari satu tim pun dalam simulasi ini. 🏆`
    );
  }

  embed.setDescription(
    `**${playerLabel}** kalah dari **${result.losses.length}** tim`
    + ` (total ${result.tally.enemy.toLocaleString('id-ID')} kekalahan).\n`
    + '-# Senjata lawan disembunyikan.'
  );

  // Discord membatasi jumlah field; sisanya diringkas dalam satu baris.
  const shown = result.losses.slice(0, 20);
  for (const loss of shown) {
    const { tally } = loss;
    const detail = [
      `Kalah **${tally.enemy.toLocaleString('id-ID')}**× · seri ${tally.tie.toLocaleString('id-ID')}× · menang ${tally.player.toLocaleString('id-ID')}×`,
      ...loss.specs.map((spec, i) => hiddenSpecLine(spec, i)),
    ].join('\n');
    embed.addFields({
      name: `${loss.label} · L.${loss.level}`.slice(0, 256),
      value: detail.slice(0, 1024),
      inline: false,
    });
  }
  if (result.losses.length > shown.length) {
    embed.setFooter({ text: `…dan ${result.losses.length - shown.length} tim lain tidak ditampilkan.` });
  }
  return embed;
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
  teamEmbed, teamListEmbed, simEmbed, simProgressEmbed, simColor, teamCompLines, renderMatchup, usageEmbed, errorEmbed, okEmbed, warnEmbed,
  turnDistribution, sideLine, shortDuration, duelEmbed, duelUnitLines, duelTeamField,
  teamButtons, isTeamButton, parseTeamButton,
  GLOBAL_BUTTON, globalSimEmbed, globalLossesEmbed, globalLossButton, isGlobalLossButton, parseGlobalLossButton,
  REPEAT_BUTTON, repeatButton, isRepeatButton, parseRepeatButton,
};
