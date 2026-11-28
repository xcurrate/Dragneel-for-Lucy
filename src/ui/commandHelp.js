// Panel bantuan perintah dengan kategori. Dipakai oleh panduan yang isinya
// lebih dari satu kelompok perintah supaya tidak menumpuk di satu description.
const { EmbedBuilder } = require('discord.js');

const DEFAULT_COLOR = 0x5865F2;
const MAX_FIELDS = 25;
const MAX_FIELD_VALUE = 1024;
const MAX_TOTAL_CHARS = 5900;

function commandHelpEmbed({
  title, description = '', sections = [], color = DEFAULT_COLOR, footer = null,
} = {}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(String(title || 'Bantuan').slice(0, 256));
  if (description) embed.setDescription(String(description).slice(0, 4096));

  let used = (embed.data.title || '').length + (embed.data.description || '').length;
  const fields = [];
  for (const section of sections) {
    if (fields.length >= MAX_FIELDS) break;
    const name = String(section?.name || '').slice(0, 256);
    let value = String(section?.value || '').trim();
    if (!name || !value) continue;

    const remaining = MAX_TOTAL_CHARS - used - name.length;
    if (remaining < 40) break;
    if (value.length > MAX_FIELD_VALUE) value = value.slice(0, MAX_FIELD_VALUE - 1) + '…';
    if (value.length > remaining) value = value.slice(0, remaining - 1) + '…';
    fields.push({ name, value, inline: false });
    used += name.length + value.length;
  }
  if (fields.length) embed.addFields(fields);
  if (footer) embed.setFooter({ text: String(footer).slice(0, 2048) });
  return embed;
}

module.exports = { commandHelpEmbed };
