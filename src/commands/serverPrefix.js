// `/prefix` berdiri sendiri, terpisah dari kategori `/boss`.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
  getGuildSettings, updateGuildSettings, DEFAULT_PREFIX, normalizePrefix,
} = require('../utils/storage');

function validPrefix(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 10 && !/\s/.test(value);
}

const data = new SlashCommandBuilder()
  .setName('prefix')
  .setDescription('Lihat atau ubah prefix perintah server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName('nilai')
    .setDescription('Prefix baru, 1–10 karakter tanpa spasi')
    .setRequired(false)
    .setMaxLength(10));

async function execute(i) {
  if (!i.guildId) {
    return i.reply({ content: 'Gunakan perintah ini di server.', flags: MessageFlags.Ephemeral });
  }
  if (!i.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
    return i.reply({ content: 'Pengaturan prefix hanya bisa digunakan moderator/admin.', flags: MessageFlags.Ephemeral });
  }

  const current = getGuildSettings(i.guildId).prefix || DEFAULT_PREFIX;
  const value = i.options.getString('nilai');
  if (value === null) {
    return i.reply({ content: 'Prefix server saat ini: `' + current + '`', flags: MessageFlags.Ephemeral });
  }
  if (!validPrefix(value)) {
    return i.reply({ content: 'Prefix harus 1–10 karakter dan tidak boleh mengandung spasi.', flags: MessageFlags.Ephemeral });
  }

  const normalized = normalizePrefix(value);
  updateGuildSettings(i.guildId, s => ({ ...s, prefix: normalized }));
  return i.reply({
    content: '✅ Prefix server diubah menjadi `' + normalized + '`. Contoh: `' + normalized + ' boss status`',
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute, validPrefix };
