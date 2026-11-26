const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');

const IDS = {
  notifyMode: 'boss_notify_mode',
  on: 'boss_dm_on',
  off: 'boss_dm_off',
  warn: 'boss_warn_select',
  help: 'boss_panel_help',
  helpCategory: 'boss_help_select',
  status: 'boss_panel_status',
  adminHelp: 'boss_panel_admin_help',
  refresh: 'boss_panel_refresh'
};

const MODE_VALUES = ['dm', 'channel', 'both'];
const WARN_VALUES = ['0', '10', '30', '60', '120', '300', '600', '900'];
const ID_SEP = ':';

// Scoped customId → "base:userId", sehingga komponen hanya sah untuk pemilik panel.
function scopedCustomId(base, userId) {
  return base + ID_SEP + userId;
}

// Baca balik customId. Return { base, userId, ok } ; ok=false jika format invalid.
function parseCustomId(customId) {
  if (typeof customId !== 'string') return { ok: false, base: null, userId: null };
  const idx = customId.lastIndexOf(ID_SEP);
  if (idx <= 0) return { ok: false, base: null, userId: null };
  const base = customId.slice(0, idx);
  const userId = customId.slice(idx + 1);
  if (!base || !userId) return { ok: false, base: null, userId: null };
  return { ok: true, base, userId };
}

function modeLabel(mode) {
  return {
    dm: 'DM pribadi (channel server tetap aktif)',
    channel: 'Channel server tanpa DM',
    both: 'DM pribadi + channel server'
  }[mode] || 'Channel server tanpa DM';
}

function warnLabel(seconds) {
  if (!seconds) return 'Tidak ada peringatan';
  if (seconds % 60 === 0) return seconds / 60 + ' menit sebelum boss';
  return seconds + ' detik sebelum boss';
}

function notifySelect(settings, userId) {
  const current = settings.userModes?.[userId] ||
    ((settings.dmUsers || []).includes(userId) ? 'both' : 'channel');
  const options = [
    { name: 'DM saja', value: 'dm', desc: 'DM pribadi saat boss muncul (channel server tetap aktif)' },
    { name: 'Tanpa DM', value: 'channel', desc: 'Matikan DM, pantau channel notifikasi server' },
    { name: 'DM dan channel', value: 'both', desc: 'DM pribadi sekaligus pantau channel server' }
  ].map(o => new StringSelectMenuOptionBuilder()
    .setLabel(o.name)
    .setValue(o.value)
    .setDescription(o.desc)
    .setDefault(o.value === current));
  return new StringSelectMenuBuilder()
    .setCustomId(scopedCustomId(IDS.notifyMode, userId))
    .setPlaceholder('Pilih pengingat pribadi')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
}

function warnSelect(settings, userId) {
  const current = String(settings.userWarnSeconds?.[userId] ?? 0);
  const options = WARN_VALUES.map(v => new StringSelectMenuOptionBuilder()
    .setLabel(warnLabel(Number(v)))
    .setValue(v)
    .setDefault(v === current));
  return new StringSelectMenuBuilder()
    .setCustomId(scopedCustomId(IDS.warn, userId))
    .setPlaceholder('DM peringatan berapa detik sebelum boss muncul?')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
}

function panelEmbed(settings, userId, extra = {}) {
  const mode = settings.userModes?.[userId] ||
    ((settings.dmUsers || []).includes(userId) ? 'both' : 'channel');
  const warnSeconds = settings.userWarnSeconds?.[userId] ?? 0;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🐉 Boss Tracker — Pengaturan Pribadi')
    .setDescription('Atur notifikasi boss Lucy dengan menu di bawah.')
    .addFields(
      { name: '📣 Mode notifikasi', value: modeLabel(mode), inline: true },
      { name: '⏰ DM peringatan', value: warnLabel(warnSeconds), inline: true }
    );
  if (extra.status) embed.addFields({ name: '📡 Status & bos berikutnya', value: extra.status, inline: false });
  if (extra.tip) embed.setFooter({ text: extra.tip });
  return embed;
}

function dmRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(scopedCustomId(IDS.on, userId)).setLabel('DM ON').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(scopedCustomId(IDS.off, userId)).setLabel('DM OFF').setStyle(ButtonStyle.Danger)
  );
}

function warnRow(settings, userId) {
  return new ActionRowBuilder().addComponents(warnSelect(settings, userId));
}

function notifyRow(settings, userId) {
  return new ActionRowBuilder().addComponents(notifySelect(settings, userId));
}

function footerRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(scopedCustomId(IDS.status, userId)).setLabel('Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedCustomId(IDS.help, userId)).setLabel('Bantuan').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedCustomId(IDS.adminHelp, userId)).setLabel('Admin Help').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedCustomId(IDS.refresh, userId)).setLabel('🔄 Perbarui').setStyle(ButtonStyle.Primary)
  );
}

function personalPanel(settings, userId, extra = {}) {
  const rows = [notifyRow(settings, userId), warnRow(settings, userId), dmRow(userId)];
  if (extra.includeFooter) rows.push(footerRow(userId));
  return { embeds: [panelEmbed(settings, userId, extra)], components: rows };
}

function statusText(settings, userId) {
  const ts = settings.lastBossTimestamp;
  const mode = settings.userModes?.[userId] ||
    ((settings.dmUsers || []).includes(userId) ? 'both' : 'channel');
  const warnSeconds = settings.userWarnSeconds?.[userId] ?? 0;
  // Timestamp pakai :t → hanya menampilkan jam (tanpa tanggal/bulan/tahun).
  return [
    '**Notifikasi server:** ' + (settings.enabled ? '✅ Aktif' : '🔕 Nonaktif'),
    '**Bos berikutnya:** ' + (ts ? '<t:' + ts + ':t> (<t:' + ts + ':R>)' : 'Belum terdeteksi dari pesan Lucy.'),
    '',
    modeLabel(mode) + (warnSeconds ? ' · ⏰ DM peringatan ' + warnLabel(warnSeconds) : '')
  ].join('\n');
}

// Status ditampilkan sebagai teks biasa (bukan embed).
function statusEmbed(settings, userId) {
  return '📡 **Status Boss Tracker**\n' + statusText(settings, userId);
}

function helpEmbed(prefix, { isAdmin = false } = {}) {
  const fields = [
    {
      name: '🐉 Boss Tracker',
      value: [
        '`/boss menu` — panel pengaturan pribadi',
        '`/boss notify mode:` / `/boss warn detik:` — atur notifikasi & peringatan',
        '`/boss on` / `/boss off` / `/boss status` — DM & status',
        `\`${prefix} boss menu\` · \`${prefix} boss notify dm|channel|both\` · \`${prefix} boss status\``,
      ].join('\n'),
      inline: false,
    },
    {
      name: '🐾 Tim & Battle',
      value: [
        `\`${prefix} tm\` — panel tim`,
        `\`${prefix} team help\` — semua perintah tim (add/set/clear/swap/blueprint)`,
        `\`${prefix} sim help\` — simulasi battle`,
        `\`${prefix} sim global help\` — simulasi melawan semua tim`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '🎮 Game & Dex',
      value: [
        `\`${prefix} f100 help\` — Family 100`,
        `\`${prefix} math help\` — Cepat Tepat`,
        `\`${prefix} dex <nama>\` — Animal Dex`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '💬 Lucy & Reminder',
      value: [
        `\`${prefix} lreminder\` — pengingat aksi Lucy`,
        `\`${prefix} top\` / \`${prefix} global\` / \`${prefix} chart\` — leaderboard & chart`,
        `\`${prefix} reminder help\` — Custom Reminder`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '🛠️ Utilitas',
      value: [
        `\`${prefix} ping\` — cek latency bot`,
        `\`${prefix} count\` — counter Lucy`,
        `\`${prefix} s\` / \`${prefix} settings\` — pengaturan server (admin)`,
        `\`${prefix} help\` — panduan ini (alias: \`${prefix}\`)`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '⚙️ Admin',
      value: [
        `\`${prefix} boss admin-help\` — panduan moderator`,
        `\`${prefix} prefix\` — lihat/ubah prefix server`,
        `\`${prefix} boss setup #channel @role\` — channel & role notifikasi`,
      ].join('\n'),
      inline: false,
    },
  ];
  const embed = new EmbedBuilder().setColor(0x5865F2)
    .setTitle('🐉 Bantuan Boss Tracker')
    .setDescription('Panduan ringkas per kategori. Pilih detail lewat menu di bawah.')
    .addFields(isAdmin ? fields : fields.filter(f => !f.name.startsWith('⚙️')));
  embed.setFooter({ text: 'Mode channel server berlaku untuk seluruh server; panel ini hanya mengubah pengaturan pribadimu.' });
  return embed;
}

module.exports = {
  IDS,
  MODE_VALUES,
  WARN_VALUES,
  modeLabel,
  warnLabel,
  notifySelect,
  warnSelect,
  panelEmbed,
  dmRow,
  warnRow,
  notifyRow,
  footerRow,
  personalPanel,
  statusEmbed,
  statusText,
  helpEmbed,
  scopedCustomId,
  parseCustomId
};