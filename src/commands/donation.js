const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const donationStore = require('../utils/donationStorage');

const PLATFORMS = [
  { key: 'saweria', label: 'Saweria', emoji: '☕' },
  { key: 'trakteer', label: 'Trakteer', emoji: '🍰' },
  { key: 'kofi', label: 'Ko-fi', emoji: '🩵' },
  { key: 'paypal', label: 'PayPal', emoji: '💳' },
  { key: 'qris', label: 'QRIS', emoji: '📱' },
];

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

function formatRupiah(value) {
  return rupiah.format(Math.max(0, Number(value) || 0));
}

function progressBar(current, goal, size = 10) {
  if (!(goal > 0)) return '';
  const percent = Math.min(100, Math.max(0, Math.round((current / goal) * 100)));
  const filled = Math.round((percent / 100) * size);
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} ${percent}%`;
}

function buildDonationPayload(settings = donationStore.getDonation()) {
  if (!settings.enabled) {
    return {
      embeds: [new EmbedBuilder()
        .setColor(0xEB459E)
        .setTitle('💖 Donasi Dragneel')
        .setDescription('Fitur donasi belum diaktifkan oleh developer.')],
    };
  }

  const embed = new EmbedBuilder()
    .setColor(0xEB459E)
    .setTitle(settings.title)
    .setDescription(settings.description);

  if (settings.goal > 0) {
    embed.addFields({
      name: '🎯 Target donasi',
      value: `${progressBar(settings.collected, settings.goal)}\n${formatRupiah(settings.collected)} / ${formatRupiah(settings.goal)}`,
    });
  } else if (settings.collected > 0) {
    embed.addFields({ name: '💝 Donasi tercatat', value: formatRupiah(settings.collected) });
  }

  if (settings.qrisImageUrl) embed.setImage(settings.qrisImageUrl);
  embed.setFooter({ text: 'Donasi dicatat manual. Daftar donatur dikelola lewat dashboard; role tidak diberikan otomatis.' });

  const buttons = PLATFORMS
    .filter(platform => settings.links?.[platform.key])
    .map(platform => new ButtonBuilder()
      .setLabel(platform.label)
      .setEmoji(platform.emoji)
      .setStyle(ButtonStyle.Link)
      .setURL(settings.links[platform.key]));

  return {
    embeds: [embed],
    components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
  };
}

const data = new SlashCommandBuilder()
  .setName('donasi')
  .setDescription('Cara mendukung bot Dragneel');

async function execute(interaction) {
  return interaction.reply(buildDonationPayload());
}

module.exports = {
  data,
  execute,
  buildDonationPayload,
  PLATFORMS,
  formatRupiah,
  progressBar,
};
