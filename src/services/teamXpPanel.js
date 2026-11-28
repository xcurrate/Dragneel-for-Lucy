// Panel statistik, impor, dan forecast XP dari kartu tim Lucy.
const crypto = require('crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const petXp = require('./petXp');

const PREFIX = 'xp_panel';
const PANEL_TTL_MS = 30 * 60 * 1000;
const MAX_FORECAST_LINES = 30;
const DEFAULT_SETTINGS = Object.freeze({
  battlesPerDay: 3000,
  avgHuntXp: 0,
  tieRate: 2,
  maxStreak: 0,
});

const panels = new Map();

function prune() {
  const now = Date.now();
  for (const [id, panel] of panels) {
    if (now - panel.createdAt > PANEL_TTL_MS) panels.delete(id);
  }
}

function createPanel(userId, parsed) {
  prune();
  const id = crypto.randomBytes(6).toString('hex');
  const settings = { ...DEFAULT_SETTINGS };
  panels.set(id, {
    id, userId, parsed, settings, imported: false, createdAt: Date.now(),
  });
  return panels.get(id);
}

function getPanel(id) {
  prune();
  return panels.get(id) || null;
}

function panelId(panel, action) {
  return `${PREFIX}:${panel.id}:${action}`;
}

function parseCustomId(customId) {
  const [prefix, id, action] = String(customId || '').split(':');
  if (prefix !== PREFIX || !id || !action) return null;
  return { id, action };
}

function isPanelButton(customId) {
  const parsed = parseCustomId(customId);
  return Boolean(parsed && ['stats', 'forecast', 'settings', 'import', 'info'].includes(parsed.action));
}

function isPanelModal(customId) {
  const parsed = parseCustomId(customId);
  return Boolean(parsed && parsed.action === 'settings_modal');
}

function teamMeta(panel) {
  const teamCount = Number.isFinite(panel.parsed.teamCount) && panel.parsed.teamCount > 0
    ? panel.parsed.teamCount : 1;
  const active = panel.parsed.isActive !== false;
  const streak = Number.isFinite(panel.parsed.streak) ? panel.parsed.streak : 0;
  const configuredMax = Number(panel.settings?.maxStreak);
  const streakMax = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : null;
  const highestLevel = panel.parsed.slots.reduce((max, slot) => (
    Number.isFinite(slot.level) && slot.level > max ? slot.level : max
  ), 1);
  return { teamCount, active, streak, streakMax, highestLevel };
}

function settingsOptions(panel) {
  const meta = teamMeta(panel);
  return {
    ...meta,
    tieRate: panel.settings.tieRate,
    maxStreak: null,
    battlesPerDay: panel.settings.battlesPerDay,
    extraXpPerBattle: 0,
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function formatDecimal(value) {
  return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

function formatDays(battles, perDay) {
  return String(Math.ceil(battles / Math.max(1, perDay)));
}

function clip(value, length) {
  const text = String(value == null ? '' : value);
  return text.length <= length ? text : text.slice(0, length - 1) + '…';
}

function statsPayload(panel) {
  const meta = teamMeta(panel);
  const options = settingsOptions(panel);
  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(clip('📊 Statistik XP — ' + (panel.parsed.name || 'Tim Lucy'), 256));
  const averages = [];
  for (const slot of panel.parsed.slots) {
    const est = petXp.estimate(slot, options);
    if (est?.xpPerBattle) averages.push(est.xpPerBattle);
    const multiplier = est?.multiplier ?? 1;
    let value;
    if (est?.maxed) {
      value = 'MAX';
    } else if (!est) {
      value = 'Progres XP tidak terbaca.';
    } else {
      const percent = slot.xpMax
        ? ((slot.xpCurrent / slot.xpMax) * 100).toFixed(1).replace('.', ',')
        : '—';
      value = `__Multiplier XP__: **${formatDecimal(multiplier)}**\n`
        + 'Untuk naik level:\n'
        + `🔸 **${formatNumber(est.remaining)}** XP (${percent}%)\n`
        + `🔸 Hingga **${formatNumber(est.battles)}** battle`;
    }
    embed.addFields({
      name: clip(`Lv ${slot.level ?? '?'} ${slot.label || slot.headerEmoji || 'Pet'}`, 256),
      value: clip(value, 1024),
      inline: true,
    });
  }
  const avg = averages.length
    ? averages.reduce((sum, value) => sum + value, 0) / averages.length
    : 0;
  embed.setFooter({
    text: `Streak saat ini: ${formatNumber(meta.streak)} • Rata-rata XP/battle: ${formatDecimal(avg)}`
      + `\n${formatNumber(panel.settings.battlesPerDay)} battle/hari • Seri ${formatNumber(panel.settings.tieRate)}%`
      + ` • Streak maks ${meta.streakMax == null ? '—' : formatNumber(meta.streakMax)}`
      + ` • ${meta.teamCount} tim ${meta.active ? 'aktif ceil' : 'nonaktif floor'}`,
  });
  return { embeds: [embed], components: panelComponents(panel, 'stats') };
}

function panelComponents(panel, mode = 'stats') {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(panelId(panel, 'import'))
      .setLabel('Impor')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Success)
      .setDisabled(panel.imported),
    new ButtonBuilder()
      .setCustomId(panelId(panel, 'forecast'))
      .setLabel('Prediksi')
      .setEmoji('🔮')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(mode === 'forecast'),
    new ButtonBuilder()
      .setCustomId(panelId(panel, 'settings'))
      .setLabel('Pengaturan')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(panelId(panel, 'info'))
      .setLabel('Info')
      .setEmoji('❔')
      .setStyle(ButtonStyle.Secondary),
  )];
}

function simulateForecast(panel) {
  const meta = teamMeta(panel);
  const settings = panel.settings;
  const states = panel.parsed.slots.map(slot => {
    const level = Number(slot.level) || 1;
    const max = petXp.xpForNextLevel(level);
    return {
      slot,
      level,
      xp: Number.isFinite(slot.xpCurrent) ? slot.xpCurrent : 0,
      max,
      maxed: Boolean(slot.xpMaxed),
      lastLevel: level,
    };
  });
  let streak = meta.streak;
  const tieEvery = settings.tieRate > 0
    ? Math.max(1, Math.round(100 / Number(settings.tieRate)))
    : 0;
  let maxSeen = Math.max(meta.streakMax || 0, meta.streak);
  const rows = [];
  const initial = states.map(state => ({ level: state.level, up: false }));
  rows.push({ levels: initial, battles: 0, streak, days: 0 });
  let battles = 0;
  while (rows.length < MAX_FORECAST_LINES && battles < 10_000_000) {
    battles += 1;
    const isTie = tieEvery > 0 && battles % tieEvery === 0;
    let total;
    if (isTie) {
      total = 100;
    } else {
      streak += 1;
      if (streak > maxSeen) maxSeen = streak;
      total = petXp.XP_PER_WIN + petXp.bonusXpForStreak(streak);
    }
    const share = meta.active ? Math.ceil(total / meta.teamCount) : Math.floor(total / meta.teamCount);
    const highest = states.reduce((max, state) => Math.max(max, state.level), 1);
    let leveled = false;
    const levels = states.map(state => ({ level: state.level, up: false }));
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      if (state.maxed) continue;
      const multiplier = petXp.levelMultiplier(state.level, highest);
      const gain = Math.max(1, Math.round(share * multiplier));
      state.xp += gain;
      while (state.xp >= state.max) {
        state.xp -= state.max;
        state.level += 1;
        state.max = petXp.xpForNextLevel(state.level);
        state.maxed = false;
        leveled = true;
      }
      levels[index] = { level: state.level, up: state.level !== state.lastLevel };
      state.lastLevel = state.level;
    }
    if (leveled) {
      rows.push({
        levels,
        battles,
        streak,
        days: Math.ceil(battles / Math.max(1, settings.battlesPerDay)),
      });
    }
  }
  return { rows, maxSeen };
}

function formatForecastRow(row) {
  const levels = row.levels.map(item => `${item.up ? '🆙' : '⬛'} ${item.level}`).join('⎹ ');
  return `${levels} ｜ ${String(row.battles).padEnd(6)} ｜ ${String(row.streak).padEnd(6)} ｜ ${row.days}`;
}

function forecastPayload(panel) {
  const { rows, maxSeen } = simulateForecast(panel);
  const lines = rows.map(formatForecastRow);
  const description = '```Key: Lvl ｜ Battle ｜ Streak ｜ Hari\n' + lines.join('\n') + '\n```';
  const embed = new EmbedBuilder()
    .setColor(0x1F8B4C)
    .setTitle(clip('🔮 Prediksi Level — ' + (panel.parsed.name || 'Tim Lucy'), 256))
    .setDescription(clip(description, 4096))
    .setFooter({
      text: `${rows.length} baris • ${formatNumber(panel.settings.battlesPerDay)} battle/hari`
        + ` • Seri ${formatNumber(panel.settings.tieRate)}% • Streak maks ${formatNumber(maxSeen)}`,
    });
  return { embeds: [embed], components: panelComponents(panel, 'forecast') };
}

function infoEmbed(panel) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('❔ Info Perhitungan XP')
    .setDescription(
      'XP berasal dari kartu tim Lucy.\n'
      + '• XP battle dibagi rata ke jumlah tim.\n'
      + '• Tim aktif dibulatkan ke atas, tim nonaktif ke bawah.\n'
      + '• Multiplier catch-up: `1` untuk level tertinggi, '
      + '`min(10, 2 + (tertinggi - level) / 10)` untuk level di bawahnya.\n'
      + '• XP menang: `200 + bonus streak`; bonus hanya di kelipatan 10/50/100/500/1000.\n'
      + '• Level lawan dianggap sama karena tidak ada di kartu.\n'
      + '• Multiplier Knowledge belum dihitung.\n'
      + `• Rata-rata XP/hunt adalah XP dari hunt. Hunt dan battle aksi berbeda, jadi tidak dicampur ke forecast battle: **${formatNumber(panel.settings.avgHuntXp)}**.\n`
      + '• Streak maksimum opsional; tidak diambil dari kartu. Isi sendiri dengan hasil simulasi global kalau mau.',
    );
}

function settingsModal(panel) {
  const input = (id, label, value, placeholder, required = true) => {
    const field = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setPlaceholder(placeholder);
    if (value !== '' && value != null) field.setValue(String(value));
    return field;
  };
  return new ModalBuilder()
    .setCustomId(panelId(panel, 'settings_modal'))
    .setTitle('Pengaturan XP')
    .addComponents(
      new ActionRowBuilder().addComponents(input(
        'battles_per_day', 'Battle per hari (1-5760)', panel.settings.battlesPerDay, '3000',
      )),
      new ActionRowBuilder().addComponents(input(
        'avg_xp_hunt', 'Rata-rata XP/hunt', panel.settings.avgHuntXp, '0',
      )),
      new ActionRowBuilder().addComponents(input(
        'tie_rate', 'Peluang seri (%)', panel.settings.tieRate, '2',
      )),
      new ActionRowBuilder().addComponents(input(
        'max_streak', 'Streak maksimum (opsional)', panel.settings.maxStreak || '', 'Hasil simulasi global', false,
      )),
    );
}

function parseSettings(values, panel) {
  const battlesPerDay = Number(values.battlesPerDay);
  const avgHuntXp = Number(values.avgHuntXp);
  const tieRate = Number(values.tieRate);
  const maxStreakRaw = String(values.maxStreak ?? '').trim();
  const maxStreak = maxStreakRaw === '' ? null : Number(maxStreakRaw);
  if (!Number.isInteger(battlesPerDay) || battlesPerDay < 1 || battlesPerDay > 5760) {
    return { error: 'Battle per hari harus 1-5760.' };
  }
  if (!Number.isFinite(avgHuntXp) || avgHuntXp < 0) {
    return { error: 'Rata-rata XP/hunt harus angka 0 atau lebih.' };
  }
  if (!Number.isFinite(tieRate) || tieRate < 0 || tieRate > 100) {
    return { error: 'Peluang seri harus 0-100.' };
  }
  if (maxStreak != null && (!Number.isInteger(maxStreak) || maxStreak < 0)) {
    return { error: 'Streak maksimum harus angka bulat 0 atau lebih, atau dikosongkan.' };
  }
  return { settings: { battlesPerDay, avgHuntXp, tieRate, maxStreak } };
}

async function handleButton(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return null;
  const panel = getPanel(parsed.id);
  if (!panel) {
    return interaction.reply({ content: 'Panel kedaluwarsa. Reaksi 📊 lagi di kartu tim.', flags: MessageFlags.Ephemeral });
  }
  if (panel.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Panel ini milik orang lain.', flags: MessageFlags.Ephemeral });
  }

  if (parsed.action === 'settings') {
    return interaction.showModal(settingsModal(panel));
  }
  if (parsed.action === 'forecast') {
    return interaction.update(forecastPayload(panel));
  }
  if (parsed.action === 'stats') {
    return interaction.update(statsPayload(panel));
  }
  if (parsed.action === 'info') {
    return interaction.reply({ embeds: [infoEmbed(panel)], flags: MessageFlags.Ephemeral });
  }
  if (parsed.action === 'import') {
    const lucyTeamImport = require('./lucyTeamImport');
    const result = lucyTeamImport.importLucyTeam(interaction.user.id, panel.parsed);
    if (result.error) {
      return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    }
    panel.imported = true;
    await interaction.update(statsPayload(panel));
    return interaction.followUp({
      content: `✅ Tim **${result.team.name}** berhasil diimpor (${result.imported} slot).`,
      flags: MessageFlags.Ephemeral,
    });
  }
  return null;
}

async function handleModal(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return null;
  const panel = getPanel(parsed.id);
  if (!panel) {
    return interaction.reply({ content: 'Panel kedaluwarsa. Reaksi 📊 lagi di kartu tim.', flags: MessageFlags.Ephemeral });
  }
  if (panel.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Panel ini milik orang lain.', flags: MessageFlags.Ephemeral });
  }
  const values = {
    battlesPerDay: interaction.fields.getTextInputValue('battles_per_day'),
    avgHuntXp: interaction.fields.getTextInputValue('avg_xp_hunt'),
    tieRate: interaction.fields.getTextInputValue('tie_rate'),
    maxStreak: interaction.fields.getTextInputValue('max_streak'),
  };
  const result = parseSettings(values, panel);
  if (result.error) {
    return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
  }
  panel.settings = result.settings;
  return interaction.update(statsPayload(panel));
}

module.exports = {
  PREFIX,
  DEFAULT_SETTINGS,
  createPanel,
  getPanel,
  isPanelButton,
  isPanelModal,
  statsPayload,
  forecastPayload,
  simulateForecast,
  parseSettings,
  panelComponents,
  infoEmbed,
  settingsModal,
  handleButton,
  handleModal,
};
