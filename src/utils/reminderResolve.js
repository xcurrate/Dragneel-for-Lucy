// Layer resolusi pesan Custom Reminder.
//
// Dipakai OLEH engine pengingat yang sudah ada (src/services/lucyReminder.js)
// saat akan mengirim pengingat. Modul ini tidak mendeteksi aksi, tidak memasang
// timer, dan tidak mengirim pesan sendiri — hanya memutuskan KONFIGURASI pesan
// mana yang dipakai, sesuai urutan:
//
//   1. Reminder milik user yang aktif & cocok kategorinya (override pribadi).
//   2. Pengaturan default server untuk aksi itu.
//   3. null  -> pemanggil memakai bawaan Dragneel (perilaku lama).
//
// Karena disabled/ineligible jatuh ke langkah 2 lalu 3, mematikan Custom
// Reminder otomatis mengembalikan user ke Server Default (tanpa perintah tambahan).
const { EmbedBuilder } = require('discord.js');
const store = require('./reminderStorage');
const categories = require('./reminderCategories');
const variables = require('./reminderVariables');

// Bangun EmbedBuilder dari konfigurasi embed yang sudah divalidasi. Dipakai
// engine pengingat maupun perintah `r view`/`r info` supaya render embed hanya
// ada di satu tempat.
function buildEmbed(config, fallbackDescription = null) {
  const embed = new EmbedBuilder();
  const description = config?.description || fallbackDescription;
  embed.setDescription(description || '\u200b');
  if (config?.title) embed.setTitle(config.title);
  if (config?.color != null) embed.setColor(config.color);
  if (config?.url) embed.setURL(config.url);
  if (config?.footer) embed.setFooter(config.footer);
  if (config?.author) embed.setAuthor(config.author);
  if (config?.image) embed.setImage(config.image.url);
  if (config?.thumbnail) embed.setThumbnail(config.thumbnail.url);
  if (config?.timestamp) embed.setTimestamp(new Date(config.timestamp));
  if (config?.fields) embed.addFields(config.fields);
  return embed;
}

// Token gaya lama yang dipakai engine lucyReminder, tetap didukung supaya
// balasan server yang sudah ada tidak rusak.
const LEGACY_RE = /\{(user|mention|kind|durasi|count)\}/g;

function renderLegacy(text, vars) {
  return String(text ?? '').replace(LEGACY_RE, (_, key) => (vars?.[key] ?? ''));
}

// Render gabungan: token lama dulu, lalu registry variabel baru. Variabel baru
// tidak dipindai ulang (lihat reminderVariables.render), jadi tidak ada ekspansi
// rekursif walaupun nilai lama mengandung pola variabel.
function renderMessage(text, { legacyVars = {}, context = null } = {}) {
  return variables.render(renderLegacy(text, legacyVars), context || variables.createRenderContext({}));
}

// Reminder milik user yang aktif untuk kategori ini. Bila ada beberapa, dipilih
// yang paling awal dibuat (created_at menaik, lalu reminder_id) supaya
// deterministik dan tidak ada pengiriman ganda. Semua reminder tetap tersimpan
// di inventory — tidak ada yang dibuang atau digabung.
function pickActiveOwned(guildId, userId, category) {
  let list = [];
  try { list = store.listRemindersByOwner(userId, { activeOnly: true }); }
  catch { return null; }
  const matches = list.filter(r => r.category === category);
  if (!matches.length) return null;
  matches.sort((a, b) => a.createdAt - b.createdAt || String(a.reminderId).localeCompare(String(b.reminderId)));
  return matches[0];
}

// Hasil resolusi: { source, format, message, embed, reminder?, guildSetting? }
function resolveForAction({ guildId, userId, action }) {
  const category = categories.categoryForAction(action);
  if (!category) return { source: 'builtin', format: 'NORMAL', message: null, embed: null, category: null };

  const owned = pickActiveOwned(guildId, userId, category);
  if (owned) {
    return {
      source: 'owned', category, format: owned.format,
      message: owned.message, embed: owned.embed, reminder: owned
    };
  }

  const setting = store.getGuildReminderSetting(guildId, action);
  if (setting) {
    return {
      source: 'guild', category, format: setting.format,
      message: setting.message, embed: setting.embed, guildSetting: setting
    };
  }

  return { source: 'builtin', category, format: 'NORMAL', message: null, embed: null };
}

// Resolusi + render sekaligus, dipakai engine saat mengirim. Mengembalikan
// null bila tidak ada override (pemanggil memakai teks bawaannya).
function resolveRendered({ guildId, userId, action, legacyVars = {}, context = null }) {
  const resolved = resolveForAction({ guildId, userId, action });
  if (resolved.source === 'builtin') return { ...resolved, content: null, renderedEmbed: null };
  const ctx = context || variables.createRenderContext({ guildId, user: { id: userId } });
  return {
    ...resolved,
    content: resolved.message ? renderMessage(resolved.message, { legacyVars, context: ctx }) : null,
    renderedEmbed: resolved.embed ? variables.renderEmbed(resolved.embed, ctx) : null
  };
}

module.exports = {
  LEGACY_RE, renderLegacy, renderMessage, buildEmbed,
  pickActiveOwned, resolveForAction, resolveRendered
};
