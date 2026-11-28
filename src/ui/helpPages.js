// Halaman detail bantuan utama. Ringkasan tetap di `helpEmbed`; halaman ini
// hanya dibuka lewat select menu agar `d help` tidak membanjiri channel.
const {
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { IDS, scopedCustomId, helpEmbed } = require('./panel');
const { commandHelpEmbed } = require('./commandHelp');

const CATEGORIES = [
  { value: 'overview', label: 'Ringkasan', description: 'Semua kategori', emoji: '📋' },
  { value: 'boss', label: 'Boss Tracker', description: 'Notifikasi, status, dan panel pribadi', emoji: '🐉' },
  { value: 'battle', label: 'Tim & Battle', description: 'Tim kustom dan simulasi', emoji: '🐾' },
  { value: 'games', label: 'Game & Dex', description: 'Family 100, Cepat Tepat, Animal Dex', emoji: '🎮' },
  { value: 'lucy', label: 'Lucy & Reminder', description: 'Aksi Lucy, leaderboard, reminder', emoji: '💬' },
  { value: 'utility', label: 'Utilitas', description: 'Ping, count, bantuan', emoji: '🛠️' },
  { value: 'admin', label: 'Admin', description: 'Pengaturan server', emoji: '⚙️' },
];

const PAGES = {
  boss: {
    title: '🐉 Boss Tracker — Detail',
    description: 'Pengingat boss Lucy dan pengaturan pribadi.',
    sections: prefix => [
      {
        name: '👤 Pengguna — Slash',
        value: [
          '`/boss menu` — panel pengaturan pribadi',
          '`/boss notify mode:` — pilih DM, channel, atau keduanya',
          '`/boss warn detik:` — peringatan DM sebelum boss muncul',
          '`/boss on` / `/boss off` — aktifkan/matikan DM pribadi',
          '`/boss status` — cek status tracker & waktu boss berikutnya',
          '`/boss help` — panduan ini',
        ].join('\n'),
      },
      {
        name: '📝 Pengguna — Prefix',
        value: [
          `\`${prefix} boss menu\` — panel pengaturan pribadi`,
          `\`${prefix} boss notify dm|channel|both\` — pilih mode notifikasi`,
          `\`${prefix} boss warn <detik>\` — peringatan DM (0 = matikan)`,
          `\`${prefix} boss on\` / \`${prefix} boss off\` — aktifkan/matikan DM`,
          `\`${prefix} boss status\` — cek status tracker`,
        ].join('\n'),
      },
      {
        name: '🎛️ Panel Interaktif',
        value: [
          '**Dropdown notifikasi** — DM, tanpa DM, atau DM + channel.',
          '**Dropdown peringatan** — atur waktu peringatan DM.',
          '**Tombol DM ON/OFF** — nyalakan atau matikan DM pribadi.',
          '**Tombol bawah** — Status, Bantuan, Admin Help, dan 🔄.',
        ].join('\n'),
      },
    ],
  },
  battle: {
    title: '🐾 Tim & Battle — Detail',
    description: 'Panduan tim kustom dan simulasi battle.',
    sections: prefix => [
      {
        name: '🐾 Tim',
        value: [
          `\`${prefix} tm\` — panel tim`,
          `\`${prefix} team help\` — semua perintah tim`,
          `\`${prefix} team add <slot> <hewan|stat> [opsi]\` — isi slot`,
          `\`${prefix} team swap <slot1> <slot2>\` — tukar posisi pet`,
          `\`${prefix} team clear <slot>\` — kosongkan slot`,
        ].join('\n'),
      },
      {
        name: '⚔️ Simulasi',
        value: [
          `\`${prefix} sim\` — satu pertarungan`,
          `\`${prefix} sim -m <jumlah>\` — statistik banyak pertarungan`,
          `\`${prefix} sim global\` — melawan semua tim tersimpan`,
          `\`${prefix} sim help\` / \`${prefix} sim global help\` — detail`,
        ].join('\n'),
      },
      {
        name: '🎯 Filter & Log',
        value: [
          '`-win`, `-lose`, `-tie` — ulangi sampai hasil cocok',
          '`-log` — simpan log pertarungan (developer)',
        ].join('\n'),
      },
    ],
  },
  games: {
    title: '🎮 Game & Dex — Detail',
    description: 'Game interaktif dan Animal Dex.',
    sections: prefix => [
      {
        name: '🎲 Family 100',
        value: [
          `\`${prefix} f100\` — mulai ronde`,
          `\`${prefix} f100 clue\` — buka satu huruf`,
          `\`${prefix} f100 lb [all]\` — leaderboard`,
          `\`${prefix} f100 help\` — detail`,
        ].join('\n'),
      },
      {
        name: '🧮 Cepat Tepat',
        value: [
          `\`${prefix} math\` — mulai ronde`,
          `\`${prefix} math <jumlah>\` — atur jumlah soal`,
          `\`${prefix} math lb [all]\` — leaderboard`,
          `\`${prefix} math help\` — detail`,
        ].join('\n'),
      },
      {
        name: '📖 Animal Dex',
        value: [
          `\`${prefix} dex <nama>\` — kartu hewan`,
          `\`${prefix} dex <nama> -c\` — tabel stat ringkas`,
        ].join('\n'),
      },
    ],
  },
  lucy: {
    title: '💬 Lucy & Reminder — Detail',
    description: 'Aksi Lucy, leaderboard, dan pengingat.',
    sections: prefix => [
      {
        name: '💬 Aksi Lucy',
        value: [
          '`lucy pray` / `lpray` • `lucy curse` / `lcurse`',
          '`lucy battle` / `lb` • `lucy hunt` / `lh`',
          `\`${prefix} lreminder\` — atur pengingat aksi Lucy`,
        ].join('\n'),
      },
      {
        name: '🏆 Leaderboard & Chart',
        value: [
          `\`${prefix} top [kategori] [rentang]\` — leaderboard`,
          `\`${prefix} global\` — leaderboard lintas server`,
          `\`${prefix} lcount\` / \`${prefix} lcountall\` — leaderboard Lucy`,
          `\`${prefix} chart [user] [rentang]\` — chart "say Lucy"`,
        ].join('\n'),
      },
      {
        name: '🎁 Custom Reminder',
        value: `\`${prefix} reminder help\` — panduan Custom Reminder`,
      },
    ],
  },
  utility: {
    title: '🛠️ Utilitas — Detail',
    description: 'Perintah bantu sehari-hari.',
    sections: prefix => [
      {
        name: '🛠️ Perintah',
        value: [
          `\`${prefix} ping\` — cek latency bot`,
          `\`${prefix} count\` — counter Lucy`,
          `\`${prefix} hbcalc\` — kalkulator HuntBot (MAX ALL/target)`,
          `\`${prefix} s\` / \`${prefix} settings\` — ringkasan pengaturan server`,
          `\`${prefix} s count on|off\` — sakelar counter Lucy (admin/developer)`,
          `\`${prefix} s <aksi> set text <teks>\` — pengingat default server (admin/pemilik)`,
          `\`${prefix} s <aksi> reset\` — kembalikan pengingat ke bawaan`,
          `\`${prefix} prefix [nilai]\` — lihat/ubah prefix server (admin)`,
          '/prefix [nilai] — padanan slash command (admin)',
          `\`${prefix} help\` — panduan ini (alias: \`${prefix}\`)`,
          `\`${prefix} donasi\` — cara mendukung Dragneel`,
          `\`${prefix} dex <nama>\` — Animal Dex`,
        ].join('\n'),
      },
    ],
  },
  admin: {
    title: '⚙️ Admin — Detail',
    description: 'Khusus moderator dengan izin Manage Server atau administrator.',
    sections: prefix => [
      {
        name: '⚙️ Slash Command',
        value: [
          '`/boss setup channel:#channel role:@role` — atur channel & role',
          '`/boss server-on` / `/boss server-off` — tracker server',
          '`/prefix` — lihat/ubah prefix',
          '`/boss admin-help` — panduan moderator',
        ].join('\n'),
      },
      {
        name: '⚙️ Prefix Command',
        value: [
          `\`${prefix} boss setup #channel @role\` — atur channel & role`,
          `\`${prefix} boss server on\` / \`${prefix} boss server off\` — tracker server`,
          `\`${prefix} prefix [nilai]\` — lihat/ubah prefix`,
          `\`${prefix} boss admin-help\` — panduan moderator`,
          `\`${prefix} steal emoji <emoji> [emoji...]\` — panel emoji, simpan/download (developer)`,
          `\`${prefix} steal sticker <id>\` — ambil sticker (developer)`,
          '`/steal emoji emoji:<token>` — panel emoji, simpan/download (developer)',
          '`/steal sticker sticker:<id>` — ambil sticker (developer)',
        ].join('\n'),
      },
      {
        name: '🛠️ Pengaturan Server',
        value: [
          `\`${prefix} s\` / \`${prefix} settings\` — ringkasan pengaturan`,
          `\`${prefix} s count on|off\` — sakelar counter Lucy`,
          `\`${prefix} s <aksi> set text <teks>\` — pengingat default server`,
          `\`${prefix} s <aksi> reset\` — kembalikan ke bawaan`,
        ].join('\n'),
      },
    ],
  },
};

function categories(isAdmin = false) {
  return CATEGORIES.filter(category => category.value !== 'admin' || isAdmin);
}

function helpCategoryRow(userId, { isAdmin = false, selected = null } = {}) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(scopedCustomId(IDS.helpCategory, userId))
    .setPlaceholder('Pilih kategori bantuan...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(categories(isAdmin).map(category => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(category.label)
        .setValue(category.value)
        .setDescription(category.description)
        .setEmoji(category.emoji);
      if (category.value === selected) option.setDefault(true);
      return option;
    }));
  return new ActionRowBuilder().addComponents(menu);
}

function helpCategoryEmbed(prefix, category, { isAdmin = false } = {}) {
  const page = PAGES[category];
  if (!page || (category === 'admin' && !isAdmin)) return helpEmbed(prefix, { isAdmin });
  return commandHelpEmbed({
    title: page.title,
    description: page.description,
    sections: page.sections(prefix),
  });
}

module.exports = {
  CATEGORIES, helpCategoryRow, helpCategoryEmbed,
};
