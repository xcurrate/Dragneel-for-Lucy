// Tombol salin command blueprint. Discord tidak mengizinkan bot menulis ke
// clipboard, jadi tombol mengirim command sebagai code block ephemeral: satu
// klik lagi pada ikon copy di code block untuk menyalin.
const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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
      .setLabel('📋 Salin command')
      .setStyle(ButtonStyle.Secondary)
  );
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
    content: `\`\`\`\n${entry.command}\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  createButtonRow,
  isCopyButton,
  handleButton,
  PREFIX,
};
