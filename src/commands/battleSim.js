// Perintah simulasi battle.
//
//   dsim [lawan] [opsi]      simulasi tim aktif vs tim lain / stat manual
//   dsim -m 500              jumlah pertarungan (default 100, tanpa batas atas)
//   dsim -s 1234             seed (default acak)
//   dsim -qp 80 -qe 50       quality senjata pemain / lawan
//   dsim -lawan hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=60
const store = require('../utils/battleTeamStorage');
const dexStore = require('../utils/animalDexStorage');
const animalDex = require('../services/animalDex');
const sim = require('../services/battleSim');
const data = require('../data/owoBattle');
const { simEmbed, simProgressEmbed, renderMatchup, usageEmbed, errorEmbed, warnEmbed } = require('../ui/battlePanel');
const { parseOptions } = require('./battleTeam');

// Jeda minimum antar-edit pesan progres; Discord membatasi edit pesan.
const PROGRESS_EDIT_MS = 1000;

// Cooldown perintah simulasi per user. Simulasi bisa berjalan detik-an dan
// memakai CPU bot, jadi satu user tidak boleh menumpuknya.
const SIM_COOLDOWN_MS = 5000;
const SIM_COOLDOWN_ACTION = 'sim';

function usage(prefix = 'd') {
  return [
    `\`${prefix} sim\` — tim aktif vs tim lain milikmu (atau mirror)`,
    `\`${prefix} sim <id>\` — lawan tim lain milikmu menurut ID (lihat \`${prefix} tm\`)`,
    `\`${prefix} sim <nama-tim>\` — sama, tapi memakai nama tim`,
    `\`${prefix} sim hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=60\` — lawan stat manual`,
    `\`${prefix} sim <hewan> level=60\` — lawan dari hewan dex`,
    '',
    'Opsi: `-m <jumlah>` (default 100, tanpa batas atas), `-s <seed>`, `-qp <0-100>`, `-qe <0-100>`',
    '',
    'Level: `lvl100` (kedua sisi 100), `lvl100/60` (kita 100, lawan 60), `lvl/40` (kita tetap, lawan 40)',
  ].join('\n');
}

// Semua unit di satu sisi memakai level yang sama saat flag `lvl` dipakai.
function withLevel(specs, level) {
  if (level == null) return specs;
  return specs.map(spec => ({ ...spec, level }));
}

// Level untuk satu sisi: angka = pakai itu, kosong = pakai level yang sudah ada.
function levelOf(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= data.MAX_LEVEL ? n : null;
}

// `lvl100` (kedua sisi), `lvl100/60` (kita 100, lawan 60), `lvl/40`
// (kita tetap, lawan 40). Tanpa `lvl`, level tiap sisi tidak diubah.
const LEVEL_PREFIX = /^-?lvl/;
const LEVEL_PATTERN = /^-?lvl(\d*)(?:\/(\d*))?$/;

function parseLevels(arg) {
  if (!arg) return { player: undefined, enemy: undefined, invalid: false };
  const player = levelOf(arg.player);
  const enemy = levelOf(arg.enemy);
  if (player === null || enemy === null) return { invalid: true };
  // `lvl` tanpa angka sama sekali tidak mengubah apa pun, jadi dianggap salah.
  if (player === undefined && enemy === undefined) return { invalid: true };
  // Satu angka saja berarti kedua sisi memakai level itu.
  if (player !== undefined && enemy === undefined && arg.enemy === undefined) {
    return { player, enemy: player, invalid: false };
  }
  return { player, enemy, invalid: false };
}

// Opsi berbentuk flag: `-m 500`, `-s 42`, `-qp 80`, `-qe 50`, `lvl100/60`.
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]).toLowerCase();
    if (['-m', '-n', '-runs', '-s', '-seed', '-qp', '-qe'].includes(arg)) {
      flags[arg] = args[i + 1];
      i++;
      continue;
    }
    // Token berawalan `lvl` selalu dianggap flag level, supaya bentuk yang
    // salah tidak diam-diam jadi nama lawan.
    if (LEVEL_PREFIX.test(arg)) {
      const level = LEVEL_PATTERN.exec(arg);
      flags.lvl = level ? { player: level[1], enemy: level[2] } : { malformed: arg };
      continue;
    }
    rest.push(args[i]);
  }
  return { flags, rest };
}

async function handleSimCommand(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  const userId = message.author.id;

  // `help` tidak kena cooldown: perintah bantuan tidak menjalankan simulasi.
  if ((args[0] || '').toLowerCase() === 'help' || (args[0] || '').toLowerCase() === 'bantuan') {
    return send(message, usageEmbed('⚔️ Simulasi Battle', usage(prefix)));
  }

  const team = store.getActiveTeam(userId);
  if (!team) {
    return send(message, errorEmbed(`Belum ada tim aktif. Buat dulu: \`${prefix} team new <nama>\` lalu \`${prefix} team add 1 <hewan>\`.`));
  }
  if (!team.slots.length) {
    return send(message, errorEmbed(`Tim **${team.name}** masih kosong. Isi dengan \`${prefix} team add 1 <hewan>\`.`));
  }

  const { flags, rest } = parseFlags(args);
  const levels = parseLevels(flags.lvl);
  if (levels.invalid || flags.lvl?.malformed) {
    return send(message, errorEmbed(`Format level salah. Contoh: \`${prefix} sim lvl100\`, \`${prefix} sim lvl100/60\`, \`${prefix} sim lvl/40\`.`));
  }
  const runs = flags['-m'] ?? flags['-n'] ?? flags['-runs'] ?? 100;
  const runCount = Number(runs);
  if (!Number.isSafeInteger(runCount) || runCount < 1) {
    return send(message, errorEmbed('Jumlah simulasi harus bilangan bulat 1 atau lebih. Contoh: `d sim -m 500`.'));
  }
  const seed = flags['-s'] ?? flags['-seed'];
  if (seed != null && !Number.isFinite(Number(seed))) return send(message, errorEmbed('Seed harus angka.'));

  const quality = value => {
    if (value == null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
  };
  const playerQuality = quality(flags['-qp']);
  const enemyQuality = quality(flags['-qe']);

  const player = resolveTeamSpecs(team);
  if (player.error) return send(message, errorEmbed(`❌ ${player.error}`));

  const enemy = resolveEnemy(userId, rest, levels.enemy);
  if (enemy.error) return send(message, errorEmbed(`❌ ${enemy.error}`));

  // Flag `lvl` menimpa level tersimpan, tanpa mengubah tim di database.
  const playerSpecs = withLevel(player.specs, levels.player);
  const enemySpecs = withLevel(enemy.specs, levels.enemy);

  // Simulasi besar bisa berjalan lama. Kirim pesan progres lebih dulu, perbarui
  // berkala, lalu timpa dengan hasil akhir di pesan yang sama supaya channel
  // tidak dibanjiri pesan.
  const labels = { playerLabel: teamLabel(team), enemyLabel: enemy.label };
  let progressMessage = null;
  let progressDisabled = false;
  let lastEdit = 0;
  let editing = false;

  const publishProgress = async progress => {
    if (progressDisabled) return;
    const embed = simProgressEmbed(progress, labels);

    if (!progressMessage) {
      const sent = await send(message, embed);
      // Pengirim tanpa objek Message (mis. tes) tidak bisa diedit: cukup satu
      // pesan, sisanya dilewati supaya channel tidak dibanjiri.
      if (!sent?.edit) { progressDisabled = true; return; }
      progressMessage = sent;
      lastEdit = Date.now();
      return;
    }

    // Discord membatasi edit pesan; satu edit per detik cukup untuk menunjukkan
    // progres tanpa kena rate limit.
    if (editing || Date.now() - lastEdit < PROGRESS_EDIT_MS) return;
    editing = true;
    try {
      await progressMessage.edit({ embeds: [embed] });
      lastEdit = Date.now();
    } catch {
      progressDisabled = true;
      progressMessage = null;
    } finally {
      editing = false;
    }
  };

  // Gerbang cooldown dipasang setelah validasi: perintah yang salah ketik tetap
  // dapat pesan errornya sendiri, dan tidak menghabiskan jatah user. Yang mahal
  // hanya simulasi, jadi itu yang dibatasi.
  const waiting = store.cooldownRemaining(userId, SIM_COOLDOWN_ACTION);
  if (waiting > 0) {
    return send(message, warnEmbed(
      `⏳ Tunggu **${(waiting / 1000).toFixed(1)} detik** lagi sebelum simulasi berikutnya.`
    ));
  }
  // Ditandai dua kali: sebelum jalan supaya simulasi yang panjang tidak bisa
  // ditumpuk, dan sesudah selesai supaya cooldown dihitung dari akhir simulasi.
  store.setCooldown(userId, SIM_COOLDOWN_ACTION, Date.now() + SIM_COOLDOWN_MS);

  const result = await sim.simulate(playerSpecs, enemySpecs, {
    runs: runCount,
    seed: seed != null ? Number(seed) : undefined,
    playerQuality,
    enemyQuality,
    onProgress: publishProgress,
  });
  store.setCooldown(userId, SIM_COOLDOWN_ACTION, Date.now() + SIM_COOLDOWN_MS);

  // Ringkasan matchup memuat emoji hewan; siapkan dulu seperti `d dex`.
  await animalDex.ensureAnimalEmojis([
    ...playerSpecs.map(spec => spec.animal),
    ...enemySpecs.map(spec => spec.animal),
  ]);

  const finalEmbed = simEmbed(result, {
    ...labels,
    matchup: renderMatchup(playerSpecs, enemySpecs),
  });

  if (progressMessage) {
    try {
      await progressMessage.edit({ embeds: [finalEmbed] });
      return progressMessage;
    } catch {
      // Gagal mengedit (pesan dihapus / rate limit): kirim hasil sebagai pesan baru.
    }
  }
  return send(message, finalEmbed);
}

// Tim aktif → spec engine, dengan stat diambil dari dex bila perlu.
function resolveTeamSpecs(team) {
  const slots = team.slots.map(slot => ({
    ...slot,
    dexAnimal: slot.animalKey ? dexStore.resolveAnimal(slot.animalKey) : null,
  }));
  return sim.toSpecs({ slots });
}

// Nama tim selalu ditampilkan dengan ID agar cocok dengan angka di `dtm`.
function teamLabel(team) {
  if (!team) return '-';
  return team.slotId != null ? `[${team.slotId}] ${team.name}` : team.name;
}

// Menentukan lawan: tim lain, hewan dex, atau stat manual.
function resolveEnemy(userId, args, overrideLevel) {
  const { options, rest } = parseOptions(args);
  const raw = rest.join(' ').trim();

  // Tanpa argumen: pakai tim aktif lain milik user, kalau tidak ada pakai
  // stat seimbang dari tim pemain agar simulasi tetap bermakna.
  if (!raw) {
    const others = store.listTeams(userId);
    const active = store.getActiveTeam(userId);
    const other = others.find(t => active && t.id !== active.id && t.slots.length);
    if (other) {
      const specs = resolveTeamSpecs(other);
      if (specs.error) return { error: specs.error };
      return { specs: specs.specs, label: teamLabel(other) };
    }
    const own = resolveTeamSpecs(active);
    if (own.error) return { error: own.error };
    // Cermin harus benar-benar identik (termasuk senjata), supaya hasilnya
    // jadi pembanding netral ~50%, bukan tim tanpa senjata.
    return {
      specs: own.specs.map(s => ({ ...s, label: `${s.label} (mirror)` })),
      label: 'mirror',
    };
  }

  // `d sim blitz` / `d sim 1 vs blitz` → lawan tim milik user sendiri.
  // Dicek sebelum stat manual karena nama tim bisa berupa angka ("1").
  // `d sim 3` memilih tim lewat ID; nama tim tetap diterima untuk kompatibilitas.
  const enemyName = raw.includes(' vs ') ? raw.split(/\s+vs\s+/i).pop().trim() : raw;
  const ownTeam = enemyName ? store.findTeam(userId, enemyName) : null;
  if (ownTeam) {
    if (!ownTeam.slots.length) {
      return { error: `Tim **${teamLabel(ownTeam)}** masih kosong. Isi dulu dengan \`d team add 1 <hewan>\`.` };
    }
    const specs = resolveTeamSpecs(ownTeam);
    if (specs.error) return { error: specs.error };
    return { specs: specs.specs, label: teamLabel(ownTeam) };
  }

  // `level=` eksplisit menang atas flag `lvl`, karena lebih spesifik.
  const level = options.level ? Number(options.level) : (overrideLevel ?? 60);
  const looksLikeStats = raw.includes('=') || /^[\d\s,-]+$/.test(raw);
  if (looksLikeStats) {
    const parsed = sim.parseCustomStats(raw);
    if (parsed.error) return { error: parsed.error };
    return { specs: [{ slot: 1, coeffs: parsed.custom, level, label: 'lawan' }], label: 'stat manual' };
  }

  const animal = dexStore.resolveAnimal(raw) || dexStore.searchAnimals(raw)[0];
  if (!animal) return { error: `Lawan \`${raw}\` tidak dikenal. Pakai nama tim (lihat \`d team list\`), hewan dex, atau stat manual.` };
  const coeffs = sim.dexStatsToCustom(animal);
  if (!coeffs) return { error: `Stat \`${animal.name}\` tidak lengkap di dex.` };
  return { specs: [{ slot: 1, coeffs, level, label: animal.name, animal }], label: animal.name };
}

module.exports = { handleSimCommand, parseFlags, resolveEnemy, resolveTeamSpecs, usage };
