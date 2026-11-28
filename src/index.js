require('dotenv').config();
const { Client, GatewayIntentBits, Events, MessageFlags, Partials } = require('discord.js');
const command = require('./commands/boss');
const { handlePrefixCommand, isDeveloper } = require('./commands/prefix');
const serverPrefix = require('./commands/serverPrefix');
const donation = require('./commands/donation');
const steal = require('./commands/steal');
const battleTeam = require('./commands/battleTeam');
const battleSim = require('./commands/battleSim');
const teamPanel = require('./ui/teamPanel');
const battlePanel = require('./ui/battlePanel');
const { BossTracker } = require('./services/bossTracker');
const { getGuildSettings, DEFAULT_PREFIX } = require('./utils/storage');
const logBuffer = require('./utils/logBuffer');
const { startDashboard } = require('./dashboard/server');
const lucyCounter = require('./services/lucyCounter');
const family100 = require('./services/family100');
const mathRace = require('./services/mathRace');
const lucyReminder = require('./services/lucyReminder');
const bossRewards = require('./services/bossRewardNotifications');
const bossRaidAuto = require('./services/bossRaidAuto');
const bossRaidCopy = require('./services/bossRaidCopy');
const animalDex = require('./services/animalDex');
const battleEmoji = require('./services/battleEmoji');
const reminders = require('./services/reminders');
const lucyTeamImport = require('./services/lucyTeamImport');
const teamXpPanel = require('./services/teamXpPanel');
const huntbotCalc = require('./services/huntbotCalc');
const blackjackHint = require('./services/blackjackHint');
const minesHint = require('./services/minesHint');

logBuffer.install();
if (!process.env.DISCORD_TOKEN || !process.env.LUCY_BOT_ID) {
  console.error('Set DISCORD_TOKEN and LUCY_BOT_ID in .env');
  process.exit(1);
}
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
const tracker = new BossTracker(client);
animalDex.setClient(client);

// Prefix berbeda per server; label bantuan pada tombol/panel harus memakai
// prefix server tempat interaksi terjadi, bukan `d` bawaan.
function prefixForGuild(guildId) {
  return (guildId ? getGuildSettings(guildId).prefix : null) || DEFAULT_PREFIX;
}

// Emoji statistik milik Lucy perlu di-mirror ke aplikasi bot agar bisa dirender;
// jalankan sekali saat start supaya dex langsung tampil lengkap.
async function syncAnimalDexEmojis() {
  try { await animalDex.mirrorEmojiTokens(animalDex.allEmojiTokens()); }
  catch (e) { console.error('[AnimalDex] mirror emoji:', e.message); }
  // Emoji senjata & pasif battle berasal dari aplikasi OwO, jadi perlu
  // di-mirror juga agar `d team` dan `d sim` tampil dengan ikon.
  try { await battleEmoji.syncEmojis(); }
  catch (e) { console.error('[Battle] mirror emoji:', e.message); }
}

async function handleAutoThreadRep(message) {
  if (message.author?.bot || !message.guildId) return;
  const config = getGuildSettings(message.guildId).autoThreadRep;
  if (!config.enabled || !config.channelId || message.channelId !== config.channelId) return;
  const targetId = config.targetUserId;
    if (!targetId || !message.content?.match(new RegExp('rep\\s+<@!?' + targetId + '>', 'i'))) return;
  //if (!targetId || !message.content?.match(new RegExp('\\rep\\s+<@!?' + targetId + '>'))) return;
  if (!message.mentions.users.has(targetId) || message.hasThread) return;
  try {
    const thread = await message.startThread({
      name: (config.threadNamePrefix + ' - ' + message.author.username).slice(0, 100),
      autoArchiveDuration: config.autoArchiveDuration
    });
      
   await thread.send({
  content: `\`lucy give ${config.amount} <@${message.author.id}>\``,
  allowedMentions: { parse: [] }
});
    //await thread.send({ content: 'lucy give ' + config.amount + ' ' + message.author.id, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[AutoThreadRep] Gagal membuat thread atau mengirim command teks:', error);
  }
}

// Tangkap kartu "Informasi animal" dari bot Lucy (raw JSON Components V2) ke dex.
function captureAnimalDex(message) {
  if (message.author?.id !== process.env.LUCY_BOT_ID) return;
  try { animalDex.captureMessage(message); }
  catch (e) { console.error('[AnimalDex]', e); }
}

async function handlePrefixMessage(message) {
  return handlePrefixCommand(message, tracker, {
    send: (m, payload) => m.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } })
  });
}
client.once(Events.ClientReady, async c => {
  console.log('Logged in as ' + c.user.tag);
  await tracker.restoreSchedules();
  syncAnimalDexEmojis();
  // Pangkas kejadian aksi yang melewati retensi sekali per start, bukan tiap aksi.
  try {
    const removed = require('./utils/lucyActionStorage').pruneEvents();
    if (removed) console.log('[LucyStats] ' + removed + ' kejadian lama dihapus (retensi ' + require('./utils/lucyActionStorage').RETENTION_DAYS + ' hari).');
  } catch (e) { console.warn('[LucyStats] Gagal memangkas kejadian:', e.message); }
});
client.on(Events.MessageCreate, async message => {
  lucyCounter.handleMessage(message, {
    onCounted: (m, name) => {
      // Pengiriman pengingat ada di engine lucyReminder (menghormati pingMode dan
      // durasi tiap kategori). Jangan tambah pengirim kedua di sini: itu membuat
      // pesan terkirim dua kali.
      lucyReminder.onLucyCounted(m, name);
    }
  })
    .catch(e => console.error('[LucyCounter]', e));
  lucyReminder.handleMessage(message).catch(e => console.error('[LucyReminder]', e));
  family100.handleMessage(message).catch(e => console.error('[Family100]', e));
  mathRace.handleMessage(message).catch(e => console.error('[MathRace]', e));
  reminders.handleMessage(message).catch(e => console.error('[Reminders]', e));
  tracker.handleMessage(message).catch(console.error);
  bossRewards.enqueue(message);
  bossRaidAuto.handleMessage(message).catch(e => console.error('[BossRaidAuto]', e));
  captureAnimalDex(message);
  lucyTeamImport.prepareLucyTeamMessage(message).catch(e => console.error('[LucyTeamImport] prepare:', e));
  huntbotCalc.autoReact(message).catch(e => console.error('[HuntBotCalc] react:', e));
  huntbotCalc.handleMessage(message).catch(e => console.error('[HuntBotCalc]', e));
  blackjackHint.autoReact(message).catch(e => console.error('[BlackjackHint] react:', e));
  blackjackHint.handleMessage(message).catch(e => console.error('[BlackjackHint]', e));
  minesHint.autoReact(message).catch(e => console.error('[MinesHint] react:', e));
  minesHint.handleMessage(message).catch(e => console.error('[MinesHint]', e));
  handlePrefixMessage(message).catch(e => {
    console.error('[PrefixCommand]', e);
    message.reply({ content: 'Terjadi kesalahan saat menjalankan perintah.' }).catch(() => {});
  });
  handleAutoThreadRep(message).catch(e => console.error('[AutoThreadRep]', e));
});
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    const result = await lucyTeamImport.handleReaction(reaction, user);
    if (result?.team && reaction.message?.channel?.send) {
      const prefix = prefixForGuild(reaction.message.guildId);
      await reaction.message.channel.send({
        content: `✅ Tim **${result.team.name}** berhasil diimpor (${result.imported} slot). Gunakan \`${prefix} team show ${result.team.name}\` untuk melihatnya.`,
        allowedMentions: { parse: [] },
      });
    } else if (result?.error && reaction.message?.channel?.send) {
      await reaction.message.channel.send({ content: `ℹ️ ${result.error}`, allowedMentions: { parse: [] } });
    }
  } catch (e) { console.error('[LucyTeamImport] reaction:', e); }
  try { await huntbotCalc.handleReaction(reaction, user); }
  catch (e) { console.error('[HuntBotCalc] reaction:', e); }
  try { await blackjackHint.handleReaction(reaction, user); }
  catch (e) { console.error('[BlackjackHint] reaction:', e); }
  try { await minesHint.handleReaction(reaction, user); }
  catch (e) { console.error('[MinesHint] reaction:', e); }
});
client.on(Events.MessageUpdate, async (_old, message) => {
  try {
    if (message.partial) message = await message.fetch();
    await tracker.handleMessage(message);
    bossRewards.enqueue(message);
    bossRaidAuto.handleMessage(message).catch(e => console.error('[BossRaidAuto]', e));
    captureAnimalDex(message);
    huntbotCalc.autoReact(message).catch(e => console.error('[HuntBotCalc] update react:', e));
    blackjackHint.autoReact(message).catch(e => console.error('[BlackjackHint] update react:', e));
    minesHint.autoReact(message).catch(e => console.error('[MinesHint] update react:', e));
  } catch (e) { console.error('[MessageUpdate]', e.message); }
});
client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isButton() && teamXpPanel.isPanelButton(i.customId)) { await teamXpPanel.handleButton(i); return; }
    if (i.isModalSubmit() && teamXpPanel.isPanelModal(i.customId)) { await teamXpPanel.handleModal(i); return; }
    if (i.isChatInputCommand() && i.commandName === 'boss') { await command.execute(i, tracker); return; }
    if (i.isChatInputCommand() && i.commandName === 'prefix') { await serverPrefix.execute(i); return; }
    if (i.isChatInputCommand() && i.commandName === 'donasi') { await donation.execute(i); return; }
    if (i.isChatInputCommand() && i.commandName === 'steal') { await steal.execute(i, { isDeveloper }); return; }
    if (i.isButton() && bossRaidCopy.isCopyButton(i.customId)) { await bossRaidCopy.handleButton(i); return; }
    if (i.isButton() && lucyCounter.isLucyNav(i.customId)) { await lucyCounter.handleNavigation(i); return; }
    if (i.isButton() && lucyReminder.isLeaderboardNav(i.customId)) { await lucyReminder.handleLeaderboardNav(i); return; }
    if (i.isButton() && family100.isF100Nav(i.customId)) { await family100.handleNavigation(i); return; }
    if (i.isButton() && mathRace.isMathNav(i.customId)) { await mathRace.handleNavigation(i); return; }
    if (i.isButton() && lucyReminder.isReminderNav(i.customId)) { await lucyReminder.handleComponent(i); return; }
    if (i.isButton() && reminders.isPanelNav(i.customId)) { await reminders.handleComponent(i); return; }
    if (i.isButton() && battleTeam.isTeamButton(i.customId)) { await battleTeam.handleTeamButton(i, { prefix: prefixForGuild(i.guildId) }); return; }
    if (i.isButton() && battlePanel.isGlobalLossButton(i.customId)) { await battleSim.handleGlobalLossButton(i, { prefix: prefixForGuild(i.guildId), isDeveloper }); return; }
    if (i.isButton() && battlePanel.isGlobalLossPageButton(i.customId)) { await battleSim.handleGlobalLossPageButton(i, { prefix: prefixForGuild(i.guildId), isDeveloper }); return; }
    if (i.isButton() && battlePanel.isRepeatButton(i.customId)) { await battleSim.handleRepeatButton(i, { prefix: prefixForGuild(i.guildId) }); return; }
    if (i.isButton() && steal.isStealPanelButton(i.customId)) { await steal.handleStealPanelButton(i, { isDeveloper }); return; }
    if ((i.isButton() || i.isStringSelectMenu()) && teamPanel.isTeamPanelNav(i.customId)) {
      await battleTeam.handleTeamPanelNav(i, { prefix: prefixForGuild(i.guildId) });
      return;
    }
    if (i.isButton() || i.isStringSelectMenu()) { await command.handleComponent(i, tracker); return; }
  } catch (e) {
    console.error(e);
    const data = { content: 'Terjadi kesalahan saat menjalankan perintah.', flags: MessageFlags.Ephemeral };
    if (i.replied || i.deferred) await i.followUp(data).catch(() => {}); else await i.reply(data).catch(() => {});
  }
});
client.on(Events.Error, console.error);
startDashboard(client, tracker);
client.login(process.env.DISCORD_TOKEN);
  
