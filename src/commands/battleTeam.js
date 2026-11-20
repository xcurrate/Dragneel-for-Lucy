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
const store = require('../utils/battleTeamStorage');
const dexStore = require('../utils/animalDexStorage');
const sim = require('../services/battleSim');
const data = require('../data/owoBattle');
const { renderTeam, renderTeamList, teamButtons, isTeamButton, parseTeamButton } = require('../ui/battlePanel');

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
    'Opsi slot: `level=50`, `weapon=gsword`, `quality=80`, `passive=1,12`, `label=tank`',
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
  if (!weapon) {
    const names = data.weapons().map(w => w.aliases[0]).join(', ');
    return { error: `Senjata \`${value}\` tidak dikenal. Contoh: ${names}.` };
  }
  return { weaponId: weapon.id };
}

function handleTeamCommand(message, args, prefix, deps = {}) {
  const send = deps.sendText || ((m, content) => m.reply({ content }));
  const guildId = message.guildId;
  const userId = message.author.id;
  const sub = (args[0] || 'list').toLowerCase();
  const rest = args.slice(1);

  if (sub === 'help' || sub === 'bantuan') {
    return send(message, '**Tim kustom**\n' + usage(prefix));
  }

  if (sub === 'list') {
    const teams = store.listTeams(guildId, userId);
    const active = store.getActiveTeam(guildId, userId);
    const rows = teamButtons(teams, active, userId);
    const content = renderTeamList(teams, active, prefix);
    if (!rows.length) return send(message, content);
    // `send` bawaan hanya mengirim teks; kalau pemanggil memberi `sendPayload`
    // (prefix & slash), tombol ikut dikirim.
    if (deps.sendPayload) return deps.sendPayload(message, { content, components: rows });
    return send(message, content);
  }

  if (sub === 'new' || sub === 'buat') {
    const name = rest.join(' ');
    if (!name) return send(message, `Format: \`${prefix} team new <nama>\``);
    const result = store.createTeam(guildId, userId, name);
    if (result.error) return send(message, `❌ ${result.error}`);
    // Tim pertama otomatis aktif supaya user bisa langsung memakainya.
    if (!store.getActiveTeam(guildId, userId)) store.setActiveTeam(guildId, userId, result.team.name);
    return send(message, `✅ Tim **${result.team.name}** dibuat. Isi slot dengan \`${prefix} team add 1 <hewan>\`.`);
  }

  if (sub === 'pick' || sub === 'pilih' || sub === 'use') {
    const name = rest.join(' ');
    if (!name) return send(message, `Format: \`${prefix} team pick <nama>\``);
    const result = store.setActiveTeam(guildId, userId, name);
    if (result.error) return send(message, `❌ ${result.error}`);
    return send(message, `✅ Tim aktif: **${result.team.name}**.`);
  }

  if (sub === 'show' || sub === 'lihat') {
    const name = rest.join(' ');
    const team = name ? store.getTeam(guildId, userId, name) : store.getActiveTeam(guildId, userId);
    if (!team) return send(message, name ? `❌ Tim **${name}** tidak ditemukan.` : `Belum ada tim aktif. Buat dengan \`${prefix} team new <nama>\`.`);
    return send(message, renderTeam(team, { prefix }));
  }

  if (sub === 'del' || sub === 'hapus' || sub === 'delete') {
    const name = rest.join(' ');
    if (!name) return send(message, `Format: \`${prefix} team del <nama>\``);
    const result = store.deleteTeam(guildId, userId, name);
    if (result.error) return send(message, `❌ ${result.error}`);
    return send(message, `🗑️ Tim **${result.team.name}** dihapus.`);
  }

  if (sub === 'rename' || sub === 'ganti') {
    const [from, ...toParts] = rest;
    const to = toParts.join(' ');
    if (!from || !to) return send(message, `Format: \`${prefix} team rename <lama> <baru>\``);
    const result = store.renameTeam(guildId, userId, from, to);
    if (result.error) return send(message, `❌ ${result.error}`);
    return send(message, `✅ Tim **${from}** sekarang bernama **${result.team.name}**.`);
  }

  if (sub === 'clear' || sub === 'kosongkan') {
    const teamName = store.getActiveTeam(guildId, userId);
    if (!teamName) return send(message, `Belum ada tim aktif. Buat dengan \`${prefix} team new <nama>\`.`);
    const result = store.clearSlot(guildId, userId, teamName.name, rest[0]);
    if (result.error) return send(message, `❌ ${result.error}`);
    return send(message, `✅ Slot ${rest[0]} dikosongkan dari tim **${teamName.name}**.`);
  }

  if (sub === 'add' || sub === 'set' || sub === 'isi') {
    return handleAdd(message, rest, prefix, send, guildId, userId);
  }

  return send(message, `Perintah tidak dikenal.\n` + usage(prefix));
}

function handleAdd(message, rest, prefix, send, guildId, userId) {
  const team = store.getActiveTeam(guildId, userId);
  if (!team) return send(message, `Belum ada tim aktif. Buat dengan \`${prefix} team new <nama>\` lalu \`${prefix} team pick <nama>\`.`);

  const slot = Number(rest[0]);
  if (!Number.isInteger(slot) || slot < 1 || slot > store.MAX_SLOTS) {
    return send(message, `Slot harus 1-${store.MAX_SLOTS}. Contoh: \`${prefix} team add 1 snail level=50\``);
  }

  const { options, rest: body } = parseOptions(rest.slice(1));
  if (!body.length) return send(message, `Sebutkan hewan dex atau stat manual. Contoh: \`${prefix} team add ${slot} snail level=50 weapon=gsword\``);

  const level = options.level ? Number(options.level) : 1;
  if (options.level && (!Number.isFinite(level) || level < 1 || level > 1000)) {
    return send(message, 'Level harus 1-1000.');
  }

  const quality = options.quality ? Number(options.quality) : undefined;
  if (options.quality && (!Number.isFinite(quality) || quality < 0 || quality > 100)) {
    return send(message, 'Quality harus 0-100.');
  }

  const weapon = parseWeapon(options.weapon);
  if (weapon.error) return send(message, `❌ ${weapon.error}`);

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
    if (parsed.error) return send(message, `❌ ${parsed.error}`);
    const result = store.setSlot(guildId, userId, team.name, slot, { ...payload, custom: parsed.custom });
    if (result.error) return send(message, `❌ ${result.error}`);
    const stats = sim.STAT_KEYS.map(k => `${sim.STAT_LABELS[k]} ${parsed.custom[k]}`).join(' · ');
    return send(message, `✅ Slot ${slot} tim **${team.name}** diisi stat manual: ${stats} (level ${level}).`);
  }

  const animal = findDexAnimal(raw);
  if (!animal) {
    return send(message, `❌ Hewan \`${raw}\` belum ada di dex. Tangkap dulu lewat Lucy, atau isi stat manual:\n` +
      `\`${prefix} team add ${slot} hp=14,att=6,pr=2,wp=3,mag=0,mr=1 level=50\``);
  }
  const coeffs = sim.dexStatsToCustom(animal);
  if (!coeffs) {
    return send(message, `❌ Data stat \`${animal.name}\` di dex tidak lengkap. Isi stat manual saja.`);
  }
  const result = store.setSlot(guildId, userId, team.name, slot, { ...payload, animalKey: animal.nameKey });
  if (result.error) return send(message, `❌ ${result.error}`);
  return send(message, `✅ Slot ${slot} tim **${team.name}**: **${animal.name}** level ${level}` +
    (weapon.weaponId ? ` + ${data.weapons().find(w => w.id === weapon.weaponId).name}` : '') + '.');
}

// Klik tombol pemilih tim. Hanya pemilik panel yang boleh memakainya.
function handleTeamButton(i) {
  const parsed = parseTeamButton(i.customId);
  if (!parsed.ok) return i.reply({ content: 'Tombol kedaluwarsa. Jalankan `dteam list` lagi.', flags: 64 });
  if (parsed.userId !== i.user.id) {
    return i.reply({ content: 'Tombol ini milik orang lain. Jalankan `dteam list` untuk daftar tim kamu.', flags: 64 });
  }
  const teams = store.listTeams(i.guildId, i.user.id);
  const team = teams[parsed.index];
  if (!team) return i.reply({ content: 'Tim tidak ditemukan. Jalankan `dteam list` lagi.', flags: 64 });
  store.setActiveTeam(i.guildId, i.user.id, team.name);
  const active = store.getActiveTeam(i.guildId, i.user.id);
  return i.update({
    content: renderTeamList(teams, active, 'd'),
    components: teamButtons(teams, active, i.user.id),
  }).then(() => i.followUp({ content: `✅ Tim aktif: **${team.name}**`, flags: 64 }))
    .catch(() => i.reply({ content: `✅ Tim aktif: **${team.name}**`, flags: 64 }));
}

module.exports = { handleTeamCommand, handleTeamButton, findDexAnimal, parseOptions, parseWeapon, usage, isTeamButton };
