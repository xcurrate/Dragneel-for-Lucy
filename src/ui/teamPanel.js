// Panel tim interaktif untuk `dtm`.
//
// Satu pesan menampilkan komposisi satu tim. Berpindah tim lewat tombol panah
// (◀ ▶) atau select menu, jadi tidak perlu mengetik nama tim yang panjang.
// Tombol per tim tidak dipakai karena 21 tim memenuhi semua baris komponen.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const store = require('../utils/battleTeamStorage');
const { teamToBlueprint } = require('../utils/blueprint');
const { teamEmbed, COLOR, errorEmbed } = require('./battlePanel');

const NAV_PREV = 'battle_tm_prev';
const NAV_NEXT = 'battle_tm_next';
const NAV_PICK = 'battle_tm_pick';
const NAV_DELETE = 'battle_tm_del';
const NAV_EXPORT = 'battle_tm_export';
const SEP = ':';

// `dtm:<userId>:<index>` — index adalah posisi di daftar tim terurut ID.
function navId(kind, userId, index) {
  return `${kind}${SEP}${userId}${SEP}${index}`;
}

function isTeamPanelNav(customId) {
  return typeof customId === 'string'
    && (customId.startsWith(`${NAV_PREV}${SEP}`)
      || customId.startsWith(`${NAV_NEXT}${SEP}`)
      || customId === NAV_PICK
      || customId.startsWith(`${NAV_PICK}${SEP}`)
      || customId.startsWith(`${NAV_DELETE}${SEP}`)
      || customId.startsWith(`${NAV_EXPORT}${SEP}`));
}

function parsePanelNav(customId) {
  const parts = String(customId || '').split(SEP);
  if (parts[0] === NAV_PICK && parts.length === 2) {
    return { ok: true, kind: 'pick', userId: parts[1] || null, index: null };
  }
  // Tombol konfirmasi hapus membawa bagian keempat: 'yes' atau 'no'.
  if (parts.length !== 3 && parts.length !== 4) return { ok: false };
  const index = Number(parts[2]);
  if (!Number.isInteger(index) || index < 0) return { ok: false };
  const kind = parts[0] === NAV_PREV ? 'prev'
    : parts[0] === NAV_NEXT ? 'next'
      : parts[0] === NAV_PICK ? 'pick'
        : parts[0] === NAV_DELETE ? 'delete'
          : parts[0] === NAV_EXPORT ? 'export'
            : null;
  if (!kind) return { ok: false };
  const confirm = parts.length === 4 ? parts[3] : null;
  if (confirm != null && !['yes', 'no'].includes(confirm)) return { ok: false };
  return { ok: true, kind, userId: parts[1], index, confirm };
}

// Tim diurutkan menurut ID supaya urutan panah stabil walau nama berubah.
function orderedTeams(teams) {
  return [...teams].sort((a, b) => (a.slotId ?? 99) - (b.slotId ?? 99));
}

function labelOf(team) {
  return team.slotId != null ? `[${team.slotId}] ${team.name}` : team.name;
}

function panelComponents(teams, index, userId) {
  const team = teams[index];
  const total = teams.length;
  const rows = [];

  // Select menu hanya bisa memuat 25 opsi dan teks label 100 karakter.
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${NAV_PICK}${SEP}${userId}`)
    .setPlaceholder(total ? `Pilih tim (${total}/${store.MAX_TEAM_ID})` : 'Belum ada tim')
    .setDisabled(!total);
  for (const [i, entry] of teams.slice(0, 25).entries()) {
    menu.addOptions(new StringSelectMenuOptionBuilder()
      .setLabel(labelOf(entry).slice(0, 100))
      .setValue(String(i))
      .setDescription(entry.slots.length ? `${entry.slots.length}/3 slot` : 'masih kosong')
      .setDefault(i === index));
  }
  rows.push(new ActionRowBuilder().addComponents(menu));

  // Baris navigasi selalu tampil: tombol hapus harus tersedia bahkan ketika
  // user hanya punya satu tim. Panah dinonaktifkan bila tidak ada tujuan.
  const single = total <= 1;
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(navId(NAV_PREV, userId, (index - 1 + total) % Math.max(1, total)))
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(single),
    // Tombol ini yang mengaktifkan tim yang sedang ditampilkan. Panah hanya
    // berpindah tampilan; select menu langsung memilih tim.
    new ButtonBuilder()
      .setCustomId(navId(NAV_PICK, userId, index))
      .setLabel('Pilih Tim Ini')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!team),
    new ButtonBuilder()
      .setCustomId(navId(NAV_NEXT, userId, (index + 1) % Math.max(1, total)))
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(single),
    new ButtonBuilder()
      .setCustomId(navId(NAV_EXPORT, userId, index))
      .setLabel('Ekspor')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!team),
    // Hapus tim yang sedang ditampilkan. `index` dibawa agar konfirmasi dan
    // penghapusan menyasar tim yang sama walau daftar berubah di antaranya.
    new ButtonBuilder()
      .setCustomId(navId(NAV_DELETE, userId, index))
      .setLabel('Hapus')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  ));

  return { rows, team };
}

// Embed komposisi memakai `teamEmbed` supaya isinya persis sama dengan
// `d team show`, ditambah penanda ID dan posisi di daftar.
// Balasan konfirmasi sebelum menghapus. Dua tombol membawa index yang sama
// dengan panel, jadi yang dihapus pasti tim yang sedang dilihat.
function deleteConfirmComponents(userId, index, name) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${NAV_DELETE}${SEP}${userId}${SEP}${index}${SEP}yes`)
      .setLabel(`Hapus ${name}`.slice(0, 80))
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${NAV_DELETE}${SEP}${userId}${SEP}${index}${SEP}no`)
      .setLabel('Batal')
      .setStyle(ButtonStyle.Secondary),
  )];
}

function panelEmbed(team, { prefix = 'd', index = 0, total = 1, active = false } = {}) {
  const embed = teamEmbed(team, { prefix, active });
  const id = team.slotId != null ? `[${team.slotId}]` : '[?]';
  embed.setTitle(`🐾 ${id} ${team.name}`);
  embed.setColor(active ? COLOR.ok : COLOR.info);
  embed.addFields({
    name: '📋 Panel tim',
    value: `Tim **${index + 1}/${total}** · \`${prefix} sim ${team.slotId ?? '<nama>'}\` untuk melawannya`
      + `\n${prefix} team del ${team.slotId ?? '<nama>'} · ${prefix} team rename ${team.slotId ?? '<nama>'} <nama baru>`,
    inline: false,
  });
  return embed;
}

// Embed ekspor: blueprint di dalam code block supaya bisa disalin dari Discord.
function blueprintEmbed(team, { prefix = 'd' } = {}) {
  const result = teamToBlueprint(team);
  if (result.error) return errorEmbed(`❌ ${result.error}`);
  const id = team.slotId != null ? `[${team.slotId}] ` : '';
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle(`📤 Blueprint — ${id}${team.name}`)
    .setDescription('```\n' + result.blueprint + '\n```')
    .setFooter({ text: `Salin teks di atas, lalu: ${prefix} team new <nama> | <blueprint>` });
}

// Pesan lengkap: embed + komponen. Tanpa tim, kembalikan embed ajakan membuat.
function panelPayload(teams, index, userId, { prefix = 'd', active = null } = {}) {
  const ordered = orderedTeams(teams);
  if (!ordered.length) {
    return {
      embeds: [new EmbedBuilder()
        .setColor(COLOR.warn)
        .setTitle('🐾 Tim Battle')
        .setDescription(`Belum ada tim.\nBuat dengan \`${prefix} team new <nama>\`.`)
        .setFooter({ text: `Maksimal ${store.MAX_TEAM_ID} tim, ID 1-${store.MAX_TEAM_ID}` })],
      components: [],
    };
  }
  const safeIndex = Math.max(0, Math.min(index, ordered.length - 1));
  const { rows, team } = panelComponents(ordered, safeIndex, userId);
  const isActive = active ? active.id === team.id : false;
  return {
    embeds: [panelEmbed(team, { prefix, index: safeIndex, total: ordered.length, active: isActive })],
    components: rows,
    team,
    index: safeIndex,
    total: ordered.length,
  };
}

// Indeks tim aktif di daftar terurut; 0 bila belum ada tim aktif.
function indexOfActive(teams, active) {
  if (!active) return 0;
  const index = orderedTeams(teams).findIndex(team => team.id === active.id);
  return index < 0 ? 0 : index;
}

module.exports = {
  NAV_PREV, NAV_NEXT, NAV_PICK, NAV_DELETE, NAV_EXPORT, deleteConfirmComponents,
  navId, isTeamPanelNav, parsePanelNav,
  orderedTeams, panelComponents, panelEmbed, blueprintEmbed, panelPayload, indexOfActive,
};
