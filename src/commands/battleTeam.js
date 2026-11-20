// Perintah tim kustom untuk simulasi battle.
//
// Semua perintah memakai prefix server (`d` bawaan) dan hanya menyentuh data
// milik user di guild yang sama:
//   dteam list                  daftar tim
//   dteam new <nama>            buat tim
//   dteam pick <nama>           jadikan tim aktif
//   dteam show [nama]           lihat isi tim
//   dteam del <nama>            hapus tim
//   dteam rename <lama> <baru>  ganti nama
//   dteam add <slot> <hewan|stat> [level=N] [weapon=senjata] [label=teks]
//   dteam set ...               sama dengan add (menimpa slot)
//   dteam clear <slot>          kosongkan slot
const { MessageFlags } = require('discord.js');
const store = require('../utils/battleTeamStorage');
const dexStore = require('../utils/animalDexStorage');
const sim = require('../services/battleSim');
const data = require('../data/owoBattle');
const { DEFAULT_LEVEL, MAX_LEVEL } = data;
const {
  teamEmbed, teamListEmbed, usageEmbed, errorEmbed, okEmbed, warnEmbed,
  teamButtons, isTeamButton, parseTeamButton,
} = require('../ui/battlePanel');

function usage(prefix = 'd') {
  return [
    `\`${prefix} team list\` — daftar tim kamu`,
    `\`${prefix} team new <nama>\` — buat tim baru`,
    `\`${prefix} team pick <nama>\` — jadikan tim aktif`,
    `\`${prefix} team show [nama]\` — lihat isi tim`,
    `\`${prefix} team add <slot> <hewan|stat> [opsi]\` — isi slot 1-3`,
    `\`${prefix} team clear <slot>\` — kosongkan slot`,
    `\`${prefix} team del <nama>\` / \`${prefix} team rename <lama> <baru>\``,
    '',
    'Opsi slot: `level=50` (default 50), `weapon=gsword`, `quality=80`, `passive=1,12`, `label=tank`',
    'Stat manual: `hp=14,att=6,pr=2,wp=3,mag=0,mr=1` atau `14,6,2,3,0,1`',
  ].join('\n');
}

// Mencari hewan di dex: nama persis dulu, lalu pencarian longgar.
function findDexAnimal(query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key) return null;
  const exact = dexStore.getAnimal(key);
  if (exact) return exact;
  const found = dexStore.searchAnimals(key);
  return found.length ? found[0] : null;
}

// Argumen `kunci=nilai` yang dikenal pada `dteam add`.
function parseOptions(args) {
  const options = {};
  const rest = [];
  for (const arg of args) {
    const m = /^([a-zA-Z]+)=(.+)$/.exec(arg);
    if (!m) { rest.push(arg); continue; }
    const key = m[1].toLowerCase();
    if (!['level', 'weapon', 'quality', 'passive', 'passives', 'label'].includes(key)) { rest.push(arg); continue; }
    options[key] = m[2];
  }
  return { options, rest };
}

function parseWeapon(value) {
  if (!value) return { weaponId: null };
  const weapon = data.findWeapon(value);
  if (weapon) return { weaponId: weapon.id };

  // Nama/alias dikenal tetapi stat dan ability-nya belum ada di data battle.
  const pending = data.findPendingWeapon(value);
  if (pending) {
    return { error: `Senjata **${pending.name}** belum punya data simulasi (stat & ability). Catat dulu, tambahkan di update berikutnya.` };
  }
  const names = data.weapons().map(w => w.aliases[0]).join(', ');
  return { error: `Senjata \`${value}\` tidak dikenal. Contoh: ${names}.` };
}

// Pesan singkat ditulis sebagai teks di call site; helper ini mengubahnya jadi
// embed dengan warna sesuai isinya supaya tidak ada balasan teks polos.
function say(send, message, text) {
  const embed = text.startsWith('❌') ? errorEmbed(text)
    : text.startsWith('✅') || text.startsWith('🗑️') ? okEmbed(text)
      : warnEmbed(text);
  return send(message, embed);
}

function handleTeamCommand(message, args, prefix, deps = {}) {
  // Semua balasan memakai embed, konsisten dengan panel dan game lain.
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));

  const guildId = message.guildId;
  const userId = message.author.id;
  const sub = (args[0] || 'list').toLowerCase();
  const rest = args.slice(1);

  if (sub === 'help' || sub === 'bantuan') {
    return send(message, usageEmbed('🐾 Tim Kustom', usage(prefix)));
  }

  if (sub === 'list') {
    const teams = store.listTeams(guildId, userId);
    const active = store.getActiveTeam(guildId, userId);
    const payload = {
      embeds: [teamListEmbed(teams, active, prefix)],
      components: teamButtons(teams, active, userId),
    };
    if (deps.sendPayload) return deps.sendPayload(message, payload);
    return send(message, payload.embeds[0]);
  }

  if (sub === 'new' || sub === 'buat') {
    const name = rest.join(' ');
    if (!name) return say(send, message, `Format: \`${prefix} team new <nama>\``);
    const result = store.createTeam(guildId, userId, name);
    if (result.error) return say(send, message, `❌ ${result.error}`);
    // Tim pertama otomatis aktif supaya user bisa langsung memakainya.
    if (!store.getActiveTeam(guildId, userId)) store.setActiveTeam(guildId, userId, result.team.name);
    return say(send, message, `✅ Tim **${result.team.name}** dibuat. Isi slot dengan \`${prefix} team add 1 <hewan>\`.`);
  }

  if (sub === 'pick' || sub === 'pilih' || sub === 'use') {
    const name = rest.join(' ');
    if (!name) return say(send, message, `Format: \`${prefix} team pick <nama>\``);
    const result = store.setActiveTeam(guildId, userId, name);
    if (result.error) return say(send, message, `❌ ${result.error}`);
    return say(send, message, `✅ Tim aktif: **${result.team.name}**.`);
  }

  if (sub === 'show' || sub === 'lihat') {
    const name = rest.join(' ');
    const team = name ? store.getTeam(guildId, userId, name) : store.getActiveTeam(guildId, userId);
    if (!team) return say(send, message, name ? `❌ Tim **${name}** tidak ditemukan.` : `Belum ada tim aktif. Buat dengan \`${prefix} team new <nama>\`.`);
    const active = store.getActiveTeam(guildId, userId);
    return send(message, teamEmbed(team, { prefix, active: !!active && active.id === team.id }));
  }

  if (sub === 'del' || sub === 'hapus' || sub === 'delete') {
    const name = rest.join(' ');
    if (!name) return say(send, message, `Format: \`${prefix} team del <nama>\``);
    const result = store.deleteTeam(guildId, userId, name);
    if (result.error) return say(send, message, `❌ ${result.error}`);
    return say(send, message, `🗑️ Tim **${result.team.name}** dihapus.`);
  }

  if (sub === 'rename' || sub === 'ganti') {
    const [from, ...toParts] = rest;
    const to = toParts.join(' ');
    if (!from || !to) return say(send, message, `Format: \`${prefix} team rename <lama> <baru>\``);
    const result = store.renameTeam(guildId, userId, from, to);
    if (result.error) return say(send, message, `❌ ${result.error}`);
    return say(send, message, `✅ Tim **${from}** sekarang bernama **${result.team.name}**.`);
  }

  if (sub === 'clear' || sub === 'kosongkan') {
    const teamName = store.getActiveTeam(guildId, userId);
    if (!teamName) return say(send, message, `Belum ada tim aktif. Buat dengan \`${prefix} team new <nama>\`.`);
    const result = store.clearSlot(guildId, userId, teamName.name, rest[0]);
    if (result.error) return say(send, message, `❌ ${result.error}`);
    return say(send, message, `✅ Slot ${rest[0]} dikosongkan dari tim **${teamName.name}**.`);
  }

  if (sub === 'add' || sub === 'set' || sub === 'isi') {
    return handleAdd(message, rest, prefix, send, guildId, userId);
  }

  return send(message, usageEmbed('🐾 Tim Kustom', ['Perintah tidak dikenal.', '', usage(prefix)]));
}

function handleAdd(message, rest, prefix, send, guildId, userId) {
  const team = store.getActiveTeam(guildId, userId);
  if (!team) return say(send, message, `Belum ada tim aktif. Buat dengan \`${prefix} team new <nama>\` lalu \`${prefix} team pick <nama>\`.`);

  const slot = Number(rest[0]);
  if (!Number.isInteger(slot) || slot < 1 || slot > store.MAX_SLOTS) {
    return say(send, message, `Slot harus 1-${store.MAX_SLOTS}. Contoh: \`${prefix} team add 1 snail level=50\``);
  }

  const { options, rest: body } = parseOptions(rest.slice(1));
  if (!body.length) return say(send, message, `Sebutkan hewan dex atau stat manual. Contoh: \`${prefix} team add ${slot} snail level=50 weapon=gsword\``);

  const level = options.level ? Number(options.level) : DEFAULT_LEVEL;
  if (options.level && (!Number.isFinite(level) || level < 1 || level > MAX_LEVEL)) {
    return say(send, message, 'Level harus 1-1000.');
  }

  const quality = options.quality ? Number(options.quality) : undefined;
  if (options.quality && (!Number.isFinite(quality) || quality < 0 || quality > 100)) {
    return say(send, message, 'Quality harus 0-100.');
  }

  const weapon = parseWeapon(options.weapon);
  if (weapon.error) return say(send, message, `❌ ${weapon.error}`);

  const passives = (options.passive || options.passives)
    ? (options.passive || options.passives).split(',').map(v => Number(v.trim())).filter(Number.isInteger)
    : undefined;

  const payload = {
    level,
    label: options.label || null,
    weaponId: weapon.weaponId,
    weaponQuality: quality ?? null,
    passives: passives || null,
  };

  // Format stat manual: mengandung '=' atau tepat 6 angka.
  const raw = body.join(' ');
  const looksLikeStats = raw.includes('=') || /^[\d\s,-]+$/.test(raw);
  if (looksLikeStats) {
    const parsed = sim.parseCustomStats(raw);
    if (parsed.error) return say(send, message, `❌ ${parsed.error}`);
    const result = store.setSlot(guildId, userId, team.name, slot, { ...payload, custom: parsed.custom });
    if (result.error) return say(send, message, `❌ ${result.error}`);
    const stats = sim.STAT_KEYS.map(k => `${sim.STAT_LABELS[k]} ${parsed.custom[k]}`).join(' · ');
    return say(send, message, `✅ Slot ${slot} tim **${team.name}** diisi stat manual: ${stats} (level ${level}).`);
  }

  const animal = findDexAnimal(raw);
  if (!animal) {
    return say(send, message, `❌ Hewan \`${raw}\` belum ada di dex. Tangkap dulu lewat Lucy, atau isi stat manual:\n` +
      `\`${prefix} team add ${slot} hp=14,att=6,pr=2,wp=3,mag=0,mr=1 level=50\``);
  }
  const coeffs = sim.dexStatsToCustom(animal);
  if (!coeffs) {
    return say(send, message, `❌ Data stat \`${animal.name}\` di dex tidak lengkap. Isi stat manual saja.`);
  }
  const result = store.setSlot(guildId, userId, team.name, slot, { ...payload, animalKey: animal.nameKey });
  if (result.error) return say(send, message, `❌ ${result.error}`);
  return say(send, message, `✅ Slot ${slot} tim **${team.name}**: **${animal.name}** level ${level}` +
    (weapon.weaponId ? ` + ${data.weapons().find(w => w.id === weapon.weaponId).name}` : '') + '.');
}

// Klik tombol pemilih tim. Hanya pemilik panel yang boleh memakainya.
function handleTeamButton(i) {
  const parsed = parseTeamButton(i.customId);
  if (!parsed.ok) return i.reply({ content: 'Tombol kedaluwarsa. Jalankan `dteam list` lagi.', flags: 64 });
  const ephemeral = { embeds: [errorEmbed('Tombol ini milik orang lain. Jalankan `d team list` untuk daftar tim kamu.')], flags: MessageFlags.Ephemeral };
  if (parsed.userId !== i.user.id) return i.reply(ephemeral);

  const teams = store.listTeams(i.guildId, i.user.id);
  const team = teams[parsed.index];
  if (!team) {
    return i.reply({ embeds: [errorEmbed('Tim tidak ditemukan. Jalankan `d team list` lagi.')], flags: MessageFlags.Ephemeral });
  }

  store.setActiveTeam(i.guildId, i.user.id, team.name);
  const active = store.getActiveTeam(i.guildId, i.user.id);
  const confirmed = { embeds: [okEmbed(`✅ Tim aktif: **${team.name}**`)], flags: MessageFlags.Ephemeral };

  return i.update({
    embeds: [teamListEmbed(teams, active, 'd')],
    components: teamButtons(teams, active, i.user.id),
  }).then(() => i.followUp(confirmed))
    .catch(() => i.reply(confirmed));
}

module.exports = { handleTeamCommand, handleTeamButton, findDexAnimal, parseOptions, parseWeapon, usage, isTeamButton };
