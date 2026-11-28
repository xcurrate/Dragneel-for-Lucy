// Tombol salin command blueprint. Discord tidak mengizinkan bot menulis ke
// clipboard, jadi tombol mengirim command sebagai inline code ephemeral:
// sentuh teksnya untuk langsung menyalin.
const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');

const PREFIX = 'boss_raid_copy';
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 1000;
const commands = new Map();

function prune() {
  const now = Date.now();
  for (const [token, entry] of commands) {
    if (entry.expires <= now) commands.delete(token);
  }
  while (commands.size >= MAX_ENTRIES) {
    commands.delete(commands.keys().next().value);
  }
}

function createButtonRow(command) {
  prune();
  const token = crypto.randomBytes(8).toString('hex');
  commands.set(token, { command, expires: Date.now() + TTL_MS });
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:${token}`)
      .setLabel('Salin Command')
      .setStyle(ButtonStyle.Secondary)
  );
}

// Susun satu pesan: tombol Salin Command di atas, template damage di bawah.
// Content biasa selalu dirender di atas action row, jadi urutan ini butuh
// Components V2. TextDisplay dipakai langsung tanpa Container agar tidak ada
// kotak pembungkus.
function createBlueprintPayload(command, section) {
  const row = createButtonRow(command);
  if (!section) {
    return { components: [row], allowedMentions: { parse: [] } };
  }
  return {
    components: [row, new TextDisplayBuilder().setContent(section)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function isCopyButton(customId) {
  return typeof customId === 'string' && customId.startsWith(`${PREFIX}:`);
}

async function handleButton(interaction) {
  const token = String(interaction.customId || '').slice(PREFIX.length + 1);
  const entry = commands.get(token);
  if (!entry || entry.expires <= Date.now()) {
    commands.delete(token);
    return interaction.reply({
      content: 'Command sudah kedaluwarsa. Jalankan blueprint lagi.',
      flags: MessageFlags.Ephemeral,
    });
  }
  return interaction.reply({
    content: `\`${entry.command}\``,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  createButtonRow,
  createBlueprintPayload,
  isCopyButton,
  handleButton,
  PREFIX,
};
