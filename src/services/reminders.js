// Custom Reminder: perintah, siklus pemberian (award) oleh developer, dan
// runtime pengiriman.
//
// Distribusi rilis ini MANUAL dan dikendalikan developer — TIDAK ada giveaway
// otomatis, voting, atau pembayaran. Pemberian memakai `awardReminder()` yang
// generik: sumber ('manual' sekarang, 'giveaway' nanti) dicatat di kolom
// source/source_ref, dan UNIQUE(source, source_ref, recipient) membuat pemberian
// dari sumber yang sama idempoten. Jadi integrasi giveaway bisa ditambah nanti
// tanpa mengubah model kepemilikan.
//
// Otorisasi developer memakai ulang isDeveloper() yang sudah ada di
// commands/prefix.js (env DEVELOPER_IDS + pemilik aplikasi + pemilik server).
// Tidak ada daftar developer kedua.
const { getGuildSettings, updateGuildSettings, matchPrefix, DEFAULT_PREFIX } = require('../utils/storage');
const store = require('../utils/reminderStorage');
const validate = require('../utils/reminderValidate');
const variables = require('../utils/reminderVariables');
const { isDeveloper } = require('../commands/prefix');
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// Konfirmasi tindakan destruktif/transfer. Disimpan di memori karena hanya
// berlaku singkat; yang penting (kepemilikan) tetap di SQLite.
const CONFIRM_TTL_MS = 60000;
const CONFIRM_COMMANDS = new Set(['confirm', 'konfirmasi', 'ya', 'yes']);
const CANCEL_COMMANDS = new Set(['cancel', 'batal', 'tidak', 'no']);
// Jeda minimum antar pengiriman reminder aktif ke pengguna yang sama.
const DELIVERY_COOLDOWN_MS = 60000;
const pendingConfirms = new Map();
const lastDelivery = new Map();

function confirmKey(message) { return message.guildId + ':' + message.channelId + ':' + message.author.id; }

function rememberConfirm(message, action) {
  pendingConfirms.set(confirmKey(message), { action, at: Date.now() });
}
function takeConfirm(message) {
  const key = confirmKey(message);
  const entry = pendingConfirms.get(key);
  if (!entry) return null;
  pendingConfirms.delete(key);
  if (Date.now() - entry.at > CONFIRM_TTL_MS) return null;
  return entry.action;
}
function clearConfirm(message) { return pendingConfirms.delete(confirmKey(message)); }

function isAdmin(message) {
  return Boolean(message.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}
function isOwner(message, reminder) {
  return Boolean(reminder && reminder.ownerId === message.author?.id);
}
// Pemilik reminder, admin server, atau developer boleh mengelola.
function canManage(message, reminder) {
  return isOwner(message, reminder) || isAdmin(message) || isDeveloper(message);
}

async function send(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}
async function sendText(message, content) {
  return send(message, { content });
}

function parseUserArg(arg) {
  const match = String(arg || '').match(/^<@!?(\d{17,20})>$/);
  return match ? match[1] : null;
}

function prefixOf(message) {
  return getGuildSettings(message.guildId).prefix || DEFAULT_PREFIX;
}

// Bangun konteks variabel dari objek pengguna/guild Discord.
function contextFor(message, user, guild) {
  const settings = getGuildSettings(message.guildId);
  const member = message.member;
  return variables.createRenderContext({
    guildId: message.guildId,
    settings,
    user: {
      id: user.id,
      name: user.username,
      displayName: member?.displayName || user.globalName || user.username,
      nickname: member?.nickname || null,
      mention: '<@' + user.id + '>',
      avatarUrl: user.displayAvatarURL?.({ size: 256 }) || user.avatarURL?.({ size: 256 }) || null,
      serverAvatarUrl: member?.displayAvatarURL?.({ size: 256 }) || null
    },
    guild: guild ? { name: guild.name, iconUrl: guild.iconURL?.({ size: 256 }) || null } : null
  });
}

function reminderEmbed(reminder, context) {
  const rendered = variables.render(reminder.message || '', context);
  const embed = new EmbedBuilder().setColor(0x5865F2).setDescription(rendered || '\u200b');
  if (reminder.embed) {
    const config = variables.renderEmbed(reminder.embed, context);
    if (config.title) embed.setTitle(config.title);
    if (config.color != null) embed.setColor(config.color);
    if (config.url) embed.setURL(config.url);
    if (config.footer) embed.setFooter(config.footer);
    if (config.author) embed.setAuthor(config.author);
    if (config.image) embed.setImage(config.image.url);
    if (config.thumbnail) embed.setThumbnail(config.thumbnail.url);
    if (config.timestamp) embed.setTimestamp(new Date(config.timestamp));
    if (config.fields) embed.addFields(config.fields);
    if (config.description) embed.setDescription(variables.render(config.description, context));
  }
  return embed;
}

function collectibleSuffix(reminder) {
  return reminder.collectible ? ' • 🏅 ' + reminder.collectible : '';
}

// ------------------------------------------------------------------ runtime --
// Adapter runtime. Titik integrasi activity/grinding Lucy ada di
// lucyCounter.handleMessage -> callback `onCounted` (lihat index.js). Pengiriman
// reminder aktif dipanggil dari sana, jadi tidak ada event grinding yang
// dikarang. Bila guild tidak punya reminder aktif, fungsi ini tidak melakukan
// apa-apa.
async function deliverForActivity({ client, guildId, userId, channelId, now = Date.now() }) {
  if (!client || !guildId || !userId) return { delivered: 0, skipped: 'invalid' };
  const key = guildId + ':' + userId;
  const previous = lastDelivery.get(key) || 0;
  if (now - previous < DELIVERY_COOLDOWN_MS) return { delivered: 0, skipped: 'cooldown' };
  let reminders;
  try { reminders = store.listRemindersByOwner(userId, { activeOnly: true }); }
  catch { return { delivered: 0, skipped: 'storage' }; }
  if (!reminders.length) return { delivered: 0, skipped: 'none' };

  let channel = null;
  try {
    channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (typeof channel?.send !== 'function') return { delivered: 0, skipped: 'no-channel' };
  } catch { return { delivered: 0, skipped: 'no-channel' }; }

  const guild = client.guilds?.cache?.get?.(guildId) || null;
  let user = null;
  try { user = await client.users.fetch(userId); } catch { user = null; }
  if (!user) return { delivered: 0, skipped: 'no-user' };

  const context = variables.createRenderContext({
    guildId,
    settings: getGuildSettings(guildId),
    user: {
      id: user.id, name: user.username, displayName: user.globalName || user.username,
      nickname: null, mention: '<@' + user.id + '>',
      avatarUrl: user.displayAvatarURL?.({ size: 256 }) || null, serverAvatarUrl: null
    },
    guild: guild ? { name: guild.name, iconUrl: guild.iconURL?.({ size: 256 }) || null } : null,
    now
  });

  let delivered = 0;
  for (const reminder of reminders) {
    try {
      await channel.send({
        content: variables.render(reminder.message || '', context),
        embeds: [reminderEmbed(reminder, context)],
        allowedMentions: { parse: [] }
      });
      store.updateReminder(reminder.reminderId, { lastDeliveredAt: now }, { now });
      delivered++;
    } catch (error) {
      console.error('[Reminders] gagal mengirim', reminder.reminderId, error.message);
    }
  }
  if (delivered) lastDelivery.set(key, now);
  return { delivered, skipped: null };
}

// --------------------------------------------------------------- award flow --
// Beri reminder kepada penerima. Idempoten bila sourceRef diisi.
function awardReminder({ templateId, recipientId, issuerId = null, source = 'manual', sourceRef = null, expiresAt = null, now = Date.now() }) {
  const template = store.getTemplate(templateId);
  if (!template) return { ok: false, errors: ['Template ' + templateId + ' tidak ditemukan.'] };
  if (!template.available) return { ok: false, errors: ['Template ' + templateId + ' sudah tidak tersedia.'] };
  if (!store.isValidUserId(recipientId)) return { ok: false, errors: ['ID penerima tidak valid.'] };
  const { award, created } = store.createAward({
    templateId: template.templateId, recipientId, issuerId, source, sourceRef, expiresAt, now
  });
  return { ok: true, award, created, template };
}

// Redeem oleh penerima. Atomik: klaim ganda ditolak oleh guard di SQL.
function redeemAward({ claimId, userId, now = Date.now() }) {
  if (!store.isValidClaimId(claimId)) return { ok: false, errors: ['Format claim ID tidak valid (contoh: C-ABC123).'] };
  const id = store.normalizeId(claimId);
  const award = store.getAward(id);
  if (!award) return { ok: false, errors: ['Award ' + id + ' tidak ditemukan.'] };
  if (award.recipientId !== userId) return { ok: false, errors: ['Award ini bukan milikmu.'] };
  if (award.status === 'redeemed') return { ok: false, errors: ['Award ini sudah diklaim sebelumnya (reminder ' + award.reminderId + ').'], reminderId: award.reminderId };
  if (award.status === 'revoked') return { ok: false, errors: ['Award ini sudah dicabut oleh developer.'] };
  if (award.expiresAt && award.expiresAt <= now) return { ok: false, errors: ['Award ini sudah kedaluwarsa.'] };

  const template = store.getTemplate(award.templateId);
  if (!template) return { ok: false, errors: ['Template sumber tidak ditemukan lagi.'] };

  return store.inTransaction(() => {
    const reminder = store.createReminder({
      ownerId: userId, templateId: template.templateId, message: template.message,
      embed: template.embed, collectible: template.collectible, active: false, now
    });
    const won = store.markAwardRedeemed({ claimId: id, recipientId: userId, reminderId: reminder.reminderId, now });
    if (!won) throw new Error('CLAIM_RACE');
    return { ok: true, reminder, template };
  });
}

// ------------------------------------------------------------ confirmation --
async function askConfirm(message, prefix, action, prompt) {
  rememberConfirm(message, action);
  return sendText(message, prompt + '\nKonfirmasi dengan `' + prefix + ' r confirm` atau batalkan dengan `' + prefix + ' r cancel` (berlaku 60 detik).');
}

// ----------------------------------------------------------------- commands --
function helpText(prefix) {
  return [
    '**Custom Reminder** — reminder pribadi dengan variabel dinamis.',
    '',
    '**Punya sendiri**',
    '`' + prefix + ' r inventory` — daftar reminder milikmu',
    '`' + prefix + ' r redeem <CLAIM_ID>` — klaim award dari developer (contoh: `' + prefix + ' r redeem C-ABC123`)',
    '`' + prefix + ' r view <ID>` — pratinjau reminder',
    '`' + prefix + ' r info <ID>` — detail reminder (pemilik, status, collectible, sumber)',
    '`' + prefix + ' r active` — daftar reminder aktifmu',
    '',
    '**Ubah milikmu**',
    '`' + prefix + ' r update <ID> <pesan>` — ubah pesan',
    '`' + prefix + ' r embed <ID> <JSON>` — atur embed (contoh: `{"title":"Halo {USER}","color":"#5865F2"}`)',
    '`' + prefix + ' r setcollectible <ID> <tipe>` — atur tipe collectible',
    '`' + prefix + ' r reset <ID>` — kembalikan ke bawaan template (perlu konfirmasi)',
    '`' + prefix + ' r enable <ID>` / `' + prefix + ' r disable <ID>` — aktifkan/matikan',
    '`' + prefix + ' r send <@user> <ID>` — hadiahkan reminder ke orang lain (perlu konfirmasi)',
    '',
    '**Utilitas**',
    '`' + prefix + ' r tenor <URL>` — ubah URL Tenor jadi URL GIF langsung',
    '`' + prefix + ' r variables` — daftar variabel',
    '`' + prefix + ' r help` — bantuan ini',
    '',
    '**Developer saja**',
    '`' + prefix + ' r create <nama> | <pesan> [| <embed JSON>]` — buat template',
    '`' + prefix + ' r templates` — daftar template',
    '`' + prefix + ' r give <@user> <TEMPLATE_ID>` — beri reminder ke user',
    '`' + prefix + ' r awards` — daftar award & status klaim',
    '`' + prefix + ' r revoke <CLAIM_ID>` — cabut award yang belum diklaim (perlu konfirmasi)'
  ].join('\n');
}

function variablesText() {
  const rows = variables.variableReference().map(v => '`' + v.name + '` — ' + v.description);
  return ['**Variabel** (bisa dipakai di pesan dan embed)', ...rows,
    '',
    'Contoh timestamp relatif: `Halo {USER}, reset <t:{DAILY_TOMORROW}:R>`'].join('\n');
}

// Handler utama. Mengembalikan true bila pesan ini adalah perintah reminder.
async function handleMessage(message, deps = {}) {
  if (!message?.guildId || message.author?.bot || !message.content) return false;
  const prefix = prefixOf(message);
  const matched = matchPrefix(message.content, prefix);
  if (matched === null) return false;
  const parts = matched.trim().split(/\s+/);
  const head = (parts[0] || '').toLowerCase();
  if (!['reminder', 'r'].includes(head)) return false;
  const sub = (parts[1] || 'help').toLowerCase();
  const args = parts.slice(2);
  const dev = (deps.isDeveloper || isDeveloper)(message);
  const client = message.client;

  // --- konfirmasi / batal ---
  if (CONFIRM_COMMANDS.has(sub) || CANCEL_COMMANDS.has(sub)) {
    if (CANCEL_COMMANDS.has(sub)) {
      const had = clearConfirm(message);
      await sendText(message, had ? '❌ Dibatalkan.' : 'Tidak ada tindakan yang menunggu konfirmasi.');
      return true;
    }
    const action = takeConfirm(message);
    if (!action) { await sendText(message, 'Tidak ada tindakan yang menunggu konfirmasi (atau sudah kedaluwarsa).'); return true; }
    return runConfirmed(message, prefix, action, deps);
  }

  if (sub === 'help' || sub === 'bantuan') { await sendText(message, helpText(prefix)); return true; }
  if (sub === 'variables' || sub === 'variabel') { await sendText(message, variablesText()); return true; }

  // --- inventory / active ---
  if (sub === 'inventory' || sub === 'inv' || sub === 'daftar') {
    const list = store.listRemindersByOwner(message.author.id);
    if (!list.length) { await sendText(message, 'Kamu belum punya reminder. Klaim award dari developer dengan `' + prefix + ' r redeem <CLAIM_ID>`.'); return true; }
    const lines = list.map(r => '`' + r.reminderId + '` ' + (r.active ? '🟢' : '⚪') + ' ' + r.message.slice(0, 60) + collectibleSuffix(r));
    await sendText(message, '**Reminder milikmu (' + list.length + ')**\n' + lines.join('\n'));
    return true;
  }

  if (sub === 'active' || sub === 'aktif') {
    const list = store.listRemindersByOwner(message.author.id, { activeOnly: true });
    if (!list.length) { await sendText(message, 'Tidak ada reminder aktif. Aktifkan dengan `' + prefix + ' r enable <ID>`.'); return true; }
    await sendText(message, '**Reminder aktif (' + list.length + ')**\n' + list.map(r => '`' + r.reminderId + '` ' + r.message.slice(0, 60)).join('\n'));
    return true;
  }

  // --- redeem ---
  if (sub === 'redeem' || sub === 'klaim') {
    const result = redeemAward({ claimId: args[0], userId: message.author.id });
    if (!result.ok) { await sendText(message, '⚠️ ' + result.errors.join(' ')); return true; }
    await sendText(message, '✅ Award diklaim! Reminder kamu: `' + result.reminder.reminderId + '` (dari template `' + result.template.name + '`).\n' +
      'Lihat dengan `' + prefix + ' r view ' + result.reminder.reminderId + '`, aktifkan dengan `' + prefix + ' r enable ' + result.reminder.reminderId + '`.');
    return true;
  }

  // --- view / info ---
  if (sub === 'view' || sub === 'lihat' || sub === 'info') {
    if (!store.isValidReminderId(args[0])) { await sendText(message, 'Format: `' + prefix + ' r ' + sub + ' <ID>` — contoh `' + prefix + ' r view R-ABC123`.'); return true; }
    const reminder = store.getReminder(args[0]);
    if (!reminder) { await sendText(message, 'Reminder `' + store.normalizeId(args[0]) + '` tidak ditemukan.'); return true; }
    if (!canManage(message, reminder)) { await sendText(message, 'Reminder itu bukan milikmu.'); return true; }
    if (sub === 'info') {
      const template = store.getTemplate(reminder.templateId);
      await sendText(message, [
        '**Info ' + reminder.reminderId + '**',
        'Pemilik: <@' + reminder.ownerId + '>',
        'Status: ' + (reminder.active ? '🟢 aktif' : '⚪ nonaktif'),
        'Collectible: ' + (reminder.collectible || '(belum diatur)'),
        'Sumber: template `' + reminder.templateId + '`' + (template ? ' (' + template.name + ')' : ''),
        'Dibuat: <t:' + Math.floor(reminder.createdAt / 1000) + ':R>',
        'Diperbarui: <t:' + Math.floor(reminder.updatedAt / 1000) + ':R>'
      ].join('\n'));
      return true;
    }
    const user = await client.users.fetch(reminder.ownerId).catch(() => null);
    const context = contextFor(message, user || message.author, message.guild);
    await send(message, { content: '🔎 Pratinjau `' + reminder.reminderId + '`', embeds: [reminderEmbed(reminder, context)] });
    return true;
  }

  // --- customization ---
  if (sub === 'update' || sub === 'ubah') {
    const id = args[0];
    const newMessage = args.slice(1).join(' ');
    if (!store.isValidReminderId(id) || !newMessage) { await sendText(message, 'Format: `' + prefix + ' r update <ID> <pesan baru>`. Pakai variabel seperti {USER}.'); return true; }
    const reminder = store.getReminder(id);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu hanya bisa mengubah reminder milikmu sendiri.'); return true; }
    if (newMessage.length > validate.LIMITS.totalEmbed) { await sendText(message, 'Pesan terlalu panjang (maks ' + validate.LIMITS.totalEmbed + ' karakter).'); return true; }
    store.updateReminder(id, { message: newMessage });
    await sendText(message, '✅ Pesan `' + store.normalizeId(id) + '` diperbarui.');
    return true;
  }

  if (sub === 'embed') {
    const id = args[0];
    const json = args.slice(1).join(' ');
    if (!store.isValidReminderId(id) || !json) { await sendText(message, 'Format: `' + prefix + ' r embed <ID> <JSON>` — contoh `{"title":"Halo {USER}","color":"#5865F2"}`.'); return true; }
    const reminder = store.getReminder(id);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu hanya bisa mengubah reminder milikmu sendiri.'); return true; }
    const result = validate.parseAndValidateEmbed(json);
    if (!result.ok) { await sendText(message, '❌ Embed ditolak:\n• ' + result.errors.join('\n• ')); return true; }
    store.updateReminder(id, { embed: result.value });
    await sendText(message, '✅ Embed `' + store.normalizeId(id) + '` tersimpan.');
    return true;
  }

  if (sub === 'setcollectible' || sub === 'collectible') {
    const id = args[0];
    if (!store.isValidReminderId(id) || !args[1]) {
      await sendText(message, 'Format: `' + prefix + ' r setcollectible <ID> <tipe>`. Pilihan: ' + validate.collectibleRegistry(getGuildSettings(message.guildId)).join(', ') + '.');
      return true;
    }
    const reminder = store.getReminder(id);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu hanya bisa mengubah reminder milikmu sendiri.'); return true; }
    const result = validate.validateCollectible(args[1], getGuildSettings(message.guildId));
    if (!result.ok) { await sendText(message, '❌ ' + result.errors.join(' ')); return true; }
    store.updateReminder(id, { collectible: result.value });
    await sendText(message, '✅ Collectible `' + store.normalizeId(id) + '` disetel ke **' + result.value + '**.');
    return true;
  }

  if (sub === 'reset' || sub === 'aturulang') {
    const id = args[0];
    if (!store.isValidReminderId(id)) { await sendText(message, 'Format: `' + prefix + ' r reset <ID>`. Perlu konfirmasi.'); return true; }
    const reminder = store.getReminder(id);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu hanya bisa mengubah reminder milikmu sendiri.'); return true; }
    const template = store.getTemplate(reminder.templateId);
    if (!template) { await sendText(message, 'Template sumber tidak ditemukan, tidak bisa reset.'); return true; }
    return askConfirm(message, prefix, { kind: 'reset', reminderId: store.normalizeId(id) },
      '⚠️ Reset `' + store.normalizeId(id) + '` akan mengembalikan pesan, embed, dan collectible ke bawaan template `' + template.name + '`.');
  }

  // --- enable / disable ---
  if (sub === 'enable' || sub === 'aktifkan' || sub === 'disable' || sub === 'matikan') {
    const enable = sub === 'enable' || sub === 'aktifkan';
    const id = args[0];
    if (!store.isValidReminderId(id)) { await sendText(message, 'Format: `' + prefix + ' r ' + (enable ? 'enable' : 'disable') + ' <ID>`.'); return true; }
    const reminder = store.getReminder(id);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Hanya pemilik yang bisa mengubah status reminder ini.'); return true; }
    store.updateReminder(id, { active: enable, activatedAt: enable ? Date.now() : reminder.activatedAt });
    await sendText(message, enable
      ? '🟢 Reminder `' + store.normalizeId(id) + '` diaktifkan. Akan tampil saat kamu melakukan aktivitas Lucy.'
      : '⚪ Reminder `' + store.normalizeId(id) + '` dimatikan.');
    return true;
  }

  // --- send (transfer) ---
  if (sub === 'send' || sub === 'kirim' || sub === 'gift') {
    const targetId = parseUserArg(args[0]);
    const id = args[1];
    if (!targetId || !store.isValidReminderId(id)) { await sendText(message, 'Format: `' + prefix + ' r send <@user> <ID>`.'); return true; }
    if (targetId === message.author.id) { await sendText(message, 'Kamu sudah memiliki reminder itu.'); return true; }
    const reminder = store.getReminder(id);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu hanya bisa menghadiahkan reminder milikmu sendiri.'); return true; }
    return askConfirm(message, prefix, { kind: 'transfer', reminderId: store.normalizeId(id), toUserId: targetId },
      '⚠️ Kirim `' + store.normalizeId(id) + '` ke <@' + targetId + '>? Ini **memindahkan kepemilikan** — kamu tidak bisa lagi mengubahnya.');
  }

  // --- tenor ---
  if (sub === 'tenor') {
    const result = await validate.resolveTenor(args[0]);
    if (!result.ok) { await sendText(message, '❌ ' + result.errors.join(' ')); return true; }
    await sendText(message, '✅ URL GIF: ' + result.value);
    return true;
  }

  // --- developer ---
  if (sub === 'create' || sub === 'buat') {
    if (!dev) { await sendText(message, 'Hanya developer bot yang bisa membuat template.'); return true; }
    const raw = matched.trim().slice(parts[0].length + parts[1].length + 2).trim();
    const segments = raw.split('|').map(s => s.trim());
    const [name, templateMessage, embedJson] = segments;
    if (!name || !templateMessage) {
      await sendText(message, 'Format: `' + prefix + ' r create <nama> | <pesan default> [| <embed JSON>]`.');
      return true;
    }
    let embed = null;
    if (embedJson) {
      const result = validate.parseAndValidateEmbed(embedJson);
      if (!result.ok) { await sendText(message, '❌ Embed ditolak:\n• ' + result.errors.join('\n• ')); return true; }
      embed = result.value;
    }
    const template = store.createTemplate({ name, message: templateMessage, embed, creatorId: message.author.id });
    await sendText(message, '✅ Template dibuat: `' + template.templateId + '` (**' + template.name + '**). Beri ke user dengan `' + prefix + ' r give @user ' + template.templateId + '`.');
    return true;
  }

  if (sub === 'templates' || sub === 'template') {
    if (!dev) { await sendText(message, 'Hanya developer bot yang bisa melihat daftar template.'); return true; }
    const list = store.listTemplates({ includeUnavailable: true });
    if (!list.length) { await sendText(message, 'Belum ada template. Buat dengan `' + prefix + ' r create <nama> | <pesan>`.') ; return true; }
    await sendText(message, '**Template (' + list.length + ')**\n' + list.map(t =>
      '`' + t.templateId + '` ' + (t.available ? '🟢' : '🔴') + ' **' + t.name + '**' + (t.collectible ? ' • ' + t.collectible : '') + '\n   ' + t.message.slice(0, 80)
    ).join('\n'));
    return true;
  }

  if (sub === 'give' || sub === 'beri') {
    if (!dev) { await sendText(message, 'Hanya developer bot yang bisa memberi reminder.'); return true; }
    const targetId = parseUserArg(args[0]);
    const templateId = args[1];
    if (!targetId || !store.isValidTemplateId(templateId)) {
      await sendText(message, 'Format: `' + prefix + ' r give <@user> <TEMPLATE_ID>` — contoh `' + prefix + ' r give @user T-ABC123`.');
      return true;
    }
    const result = awardReminder({ templateId, recipientId: targetId, issuerId: message.author.id });
    if (!result.ok) { await sendText(message, '❌ ' + result.errors.join(' ')); return true; }
    const { award, created } = result;
    if (!created) {
      await sendText(message, 'ℹ️ Award untuk <@' + targetId + '> dari template ini sudah ada: `' + award.claimId + '` (status: ' + award.status + ').');
      return true;
    }
    const dm = await dmAward(client, targetId, award, result.template, prefix);
    await sendText(message, dm.ok
      ? '✅ Award dibuat: `' + award.claimId + '` untuk <@' + targetId + '>. DM terkirim berisi instruksi klaim.'
      : '✅ Award dibuat: `' + award.claimId + '` untuk <@' + targetId + '>.\n⚠️ DM gagal (' + dm.error + '). Sampaikan claim ID ini secara manual: `' + award.claimId + '`');
    return true;
  }

  if (sub === 'awards') {
    if (!dev) { await sendText(message, 'Hanya developer bot yang bisa melihat daftar award.'); return true; }
    const list = store.listAwards({ limit: 50 });
    if (!list.length) { await sendText(message, 'Belum ada award.'); return true; }
    const icon = { pending: '⏳', redeemed: '✅', revoked: '🚫' };
    await sendText(message, '**Award terakhir (' + list.length + ')**\n' + list.map(a =>
      (icon[a.status] || '•') + ' `' + a.claimId + '` → <@' + a.recipientId + '> • ' + a.status + ' • `' + a.templateId + '` • <t:' + Math.floor(a.createdAt / 1000) + ':R>'
    ).join('\n'));
    return true;
  }

  if (sub === 'revoke' || sub === 'cabut') {
    if (!dev) { await sendText(message, 'Hanya developer bot yang bisa mencabut award.'); return true; }
    const id = args[0];
    if (!store.isValidClaimId(id)) { await sendText(message, 'Format: `' + prefix + ' r revoke <CLAIM_ID>`. Perlu konfirmasi.'); return true; }
    const award = store.getAward(id);
    if (!award) { await sendText(message, 'Award tidak ditemukan.'); return true; }
    if (award.status !== 'pending') { await sendText(message, 'Award `' + store.normalizeId(id) + '` berstatus **' + award.status + '**, hanya award `pending` yang bisa dicabut.'); return true; }
    return askConfirm(message, prefix, { kind: 'revoke', claimId: store.normalizeId(id) },
      '⚠️ Cabut award `' + store.normalizeId(id) + '` milik <@' + award.recipientId + '>?');
  }

  await sendText(message, 'Subperintah tidak dikenal. Gunakan `' + prefix + ' r help`.');
  return true;
}

// Jalankan tindakan yang sudah dikonfirmasi.
async function runConfirmed(message, prefix, action, deps) {
  if (action.kind === 'transfer') {
    const reminder = store.getReminder(action.reminderId);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan lagi.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu bukan lagi pemilik reminder itu.'); return true; }
    const moved = store.transferReminder({ reminderId: action.reminderId, fromUserId: message.author.id, toUserId: action.toUserId });
    if (!moved) { await sendText(message, 'Transfer gagal — kepemilikan mungkin sudah berubah.'); return true; }
    await sendText(message, '✅ `' + action.reminderId + '` kini milik <@' + action.toUserId + '>. Kamu tidak bisa lagi mengubahnya.');
    return true;
  }
  if (action.kind === 'reset') {
    const reminder = store.getReminder(action.reminderId);
    if (!reminder) { await sendText(message, 'Reminder tidak ditemukan lagi.'); return true; }
    if (!isOwner(message, reminder)) { await sendText(message, 'Kamu bukan lagi pemilik reminder itu.'); return true; }
    const template = store.getTemplate(reminder.templateId);
    if (!template) { await sendText(message, 'Template sumber tidak ditemukan.'); return true; }
    store.updateReminder(action.reminderId, { message: template.message, embed: template.embed, collectible: template.collectible });
    await sendText(message, '✅ `' + action.reminderId + '` dikembalikan ke bawaan template `' + template.name + '`.');
    return true;
  }
  if (action.kind === 'revoke') {
    const dev = (deps.isDeveloper || isDeveloper)(message);
    if (!dev) { await sendText(message, 'Hanya developer bot yang bisa mencabut award.'); return true; }
    const revoked = store.revokeAward({ claimId: action.claimId, actorId: message.author.id });
    await sendText(message, revoked
      ? '🚫 Award `' + action.claimId + '` dicabut.'
      : 'Award itu sudah tidak berstatus pending.');
    return true;
  }
  await sendText(message, 'Tindakan tidak dikenal.');
  return true;
}

// Kirim DM berisi claim ID + instruksi. Kegagalan DM tidak fatal: pemanggil
// memberi tahu developer supaya claim ID bisa disampaikan manual.
async function dmAward(client, recipientId, award, template, prefix) {
  try {
    const user = await client.users.fetch(recipientId);
    await user.send({
      content: [
        '🎁 **Kamu menerima Custom Reminder!**',
        'Template: **' + template.name + '**',
        'Claim ID: `' + award.claimId + '`',
        '',
        'Klaim dengan: `' + prefix + ' r redeem ' + award.claimId + '`',
        'Setelah diklaim, lihat dengan `' + prefix + ' r inventory`.'
      ].join('\n')
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'tidak diketahui' };
  }
}

// Hook yang bisa dipanggil dari alur giveaway di masa depan tanpa mengubah model
// kepemilikan. Belum dipakai rilis ini (distribusi manual), tapi disediakan agar
// integrasi otomatis tidak memerlukan perancangan ulang.
async function onGiveawayWinner({ client, guildId, giveawayId, winnerId, templateId, prefix = DEFAULT_PREFIX }) {
  const result = awardReminder({
    templateId, recipientId: winnerId, issuerId: null, source: 'giveaway', sourceRef: giveawayId
  });
  if (!result.ok) return result;
  if (result.created) await dmAward(client, winnerId, result.award, result.template, prefix);
  return { ok: true, award: result.award, created: result.created };
}

module.exports = {
  handleMessage, awardReminder, redeemAward, deliverForActivity, onGiveawayWinner,
  helpText, variablesText, reminderEmbed, contextFor, dmAward,
  isAdmin, isOwner, canManage,
  // untuk pengujian
  pendingConfirms, lastDelivery, CONFIRM_TTL_MS, DELIVERY_COOLDOWN_MS
};
