// Perintah simulasi battle.
//
//   dsim [lawan] [opsi]      satu pertarungan: sisa HP/WP tiap hewan
//   dsim -m 500              statistik dari 500 pertarungan (tanpa batas atas)
//   dsim -s 1234             seed (default acak)
//   dsim -qp 80 -qe 50       quality senjata pemain / lawan
//   dsim -lawan hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=60
const { MessageFlags } = require('discord.js');
const store = require('../utils/battleTeamStorage');
const dexStore = require('../utils/animalDexStorage');
const animalDex = require('../services/animalDex');
const sim = require('../services/battleSim');
const engine = require('../services/battleEngine');
const { averageQuality } = require('../services/battleWeapon');
const { createRng, randomSeed } = require('../services/battleRng');
const globalSim = require('../services/globalSim');
const battleLogStore = require('../utils/battleLogStorage');
const data = require('../data/owoBattle');
const {
  simEmbed, simProgressEmbed, renderMatchup, duelEmbed, usageEmbed, errorEmbed, warnEmbed,
  repeatButton, parseRepeatButton, isRepeatButton,
  globalSimEmbed, globalLossesEmbed, globalLossButton, parseGlobalLossButton,
} = require('../ui/battlePanel');
const { parseOptions } = require('./battleTeam');
const simParser = require('../utils/simParser');

// Tautan log dibuka di browser, bukan di Discord, jadi butuh URL publik
// dashboard. Tanpa `BATTLE_LOG_BASE_URL` tautan tidak dibuat: menebak domain
// akan menghasilkan link mati.
function battleLogUrl(id) {
  const base = (process.env.BATTLE_LOG_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/battle-log#${id}`;
}

// Jeda minimum antar-edit pesan progres; Discord membatasi edit pesan.
const PROGRESS_EDIT_MS = 1000;

// Cooldown perintah simulasi per user. Simulasi bisa berjalan detik-an dan
// memakai CPU bot, jadi satu user tidak boleh menumpuknya.
const SIM_COOLDOWN_MS = 5000;
const SIM_COOLDOWN_ACTION = 'sim';
const REPEAT_COOLDOWN_ACTION = 'sim_repeat';

// Jumlah pertarungan saat `-m` tidak disebut, termasuk untuk tombol 🔁.
const DEFAULT_RUNS = 50;

function usage(prefix = 'd') {
  return [
    `\`${prefix} sim\` — tim aktif vs tim lain milikmu (atau mirror)`,
    `\`${prefix} sim <id>\` — lawan tim lain milikmu menurut ID (lihat \`${prefix} tm\`)`,
    `\`${prefix} sim <nama-tim>\` — sama, tapi memakai nama tim`,
    `\`${prefix} sim hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=60\` — lawan stat manual`,
    `\`${prefix} sim <hewan> level=60\` — lawan dari hewan dex`,
    `\`${prefix} sim A vs B\` — dua tim milikmu; inline: \`${prefix} sim snail sword crit mtap, snail Aegis 100,50 sac 10,10 vs 100 snail\``,
    `\`${prefix} sim global\` — tim aktif vs **semua** tim tersimpan (lihat \`${prefix} sim global help\`)`,
    '',
    'Tanpa `-m` hasilnya **satu** pertarungan (sisa HP/WP tiap hewan).',
    `Dengan \`-m <jumlah>\` hasilnya statistik dari banyak pertarungan (default ${DEFAULT_RUNS}).`,
    'Tombol 🔁 mengulang matchup yang sama sebanyak ' + DEFAULT_RUNS + ' pertarungan (ephemeral).',
    '',
    'Opsi: `-m <jumlah>` (maks 200 untuk user biasa), `-s <seed>`, `-qp <0-100>`, `-qe <0-100>`',
    '`-log` — simpan jalannya pertarungan dan kirim tautan log lengkap (satu pertarungan; khusus developer).',
    'Filter hasil: `-win`, `-lose`, `-tie` — pertarungan diulang sampai hasilnya cocok,',
    '  lalu hasil itu yang ditampilkan. Bisa digabung `-m`, mis. `' + prefix + ' sim 2 -lose -m 20`.',
    `Rekap menang/seri/kalah ${DEFAULT_RUNS} pertarungan selalu tampil di footer.`,
    '',
    'Level: `lvl100` (kedua sisi 100), `lvl100/60` (kita 100, lawan 60), `lvl/40` (kita tetap, lawan 40)',
  ].join('\n');
}

// `A vs B` → { playerTokens: ['A'], enemyArgs: ['B'] }. Tanpa `vs`, sisi
// pemain kosong (pakai tim aktif) dan semua token menjadi argumen lawan.
function splitVs(args) {
  const tokens = args.map(a => String(a));
  const at = tokens.findIndex(token => /^vs$/i.test(token));
  if (at < 0) return { playerTokens: [], enemyArgs: tokens };
  return {
    playerTokens: tokens.slice(0, at).filter(t => !/^vs$/i.test(t)),
    enemyArgs: tokens.slice(at + 1),
  };
}

// Semua unit di satu sisi memakai level yang sama saat flag `lvl` dipakai.
function withLevel(specs, level) {
  if (level == null) return specs;
  return specs.map(spec => ({ ...spec, level }));
}

// Menulis kualitas efektif ke spec untuk ditampilkan. Urutannya sama dengan
// `buildWeapon`: kualitas slot menang atas flag global. Rank memakai rata-rata
// quality senjata + pasif, mis. Aegis 100,50 + sac 10,10 = 42,5%.
function withQuality(specs, quality) {
  return specs.map(spec => {
    if (!spec.weapon) return spec;
    const effective = spec.weapon.quality ?? quality;
    return {
      ...spec,
      displayQuality: averageQuality(effective, spec.weapon.passives),
    };
  });
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
const VALUE_FLAGS = ['-m', '-n', '-runs', '-s', '-seed', '-qp', '-qe', '-total', '-t'];
// `-win`, `-lose`, `-tie` menyaring hasil: pertarungan diulang sampai hasilnya
// cocok, lalu hasil itu yang ditampilkan. Peta ini juga dipakai untuk pesan
// bantuan supaya nama flag dan artinya tidak pernah menyimpang.
const OUTCOME_FLAGS = {
  '-win': 'player', '--win': 'player',
  '-lose': 'enemy', '--lose': 'enemy',
  '-tie': 'tie', '--tie': 'tie',
};
const OUTCOME_LABEL = { player: 'menang', enemy: 'kalah', tie: 'seri' };

function parseFlags(args) {
  const flags = {};
  const rest = [];
  // Opsi berawalan `-` yang tidak dikenal dikumpulkan terpisah. Tanpa ini
  // `d sim 2 -lose` menyatukan `2` dan `-lose` jadi nama lawan, sehingga
  // errornya menyesatkan ("Lawan `2 -lose` tidak dikenal").
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    const raw = String(args[i]);
    const arg = raw.toLowerCase();
    if (VALUE_FLAGS.includes(arg)) {
      flags[arg] = args[i + 1];
      i++;
      continue;
    }
    // Flag tanpa nilai. Dipisah supaya `-tie` tidak menelan argumen berikutnya
    // (mis. `d sim 2 -tie` jangan sampai menjadikan `2` nilai flag).
    if (OUTCOME_FLAGS[arg]) {
      flags.outcome = OUTCOME_FLAGS[arg];
      continue;
    }
    // `-log`: simpan jalannya pertarungan dan kirim tautan berbaginya.
    if (arg === '-log' || arg === '--log') { flags.log = true; continue; }
    // Token berawalan `lvl` selalu dianggap flag level, supaya bentuk yang
    // salah tidak diam-diam jadi nama lawan.
    if (LEVEL_PREFIX.test(arg)) {
      const level = LEVEL_PATTERN.exec(arg);
      flags.lvl = level ? { player: level[1], enemy: level[2] } : { malformed: arg };
      continue;
    }
    if (/^--?[a-z]/i.test(arg)) {
      unknown.push(raw);
      continue;
    }
    rest.push(args[i]);
  }
  return { flags, rest, unknown };
}

// Pesan seragam untuk opsi tak dikenal. Daftar opsinya disebut supaya user
// tidak menebak-nebak nama flag yang tidak pernah ada (mis. `-win`, `-lose`).
function unknownFlagsError(unknown, prefix) {
  return errorEmbed(
    `Opsi ${unknown.map(u => `\`${u}\``).join(', ')} tidak dikenal.`
    + `\nOpsi yang tersedia: \`-m <jumlah>\`, \`-s <seed>\`, \`-qp <0-100>\`, \`-qe <0-100>\`, \`-tie\`.`
    + `\nLihat \`${prefix} sim help\`.`
  );
}

// Cooldown simulasi global. Lebih panjang dari `dsim` karena sekali jalan
// mengadu tim melawan SEMUA tim tersimpan, jadi jauh lebih mahal.
const GLOBAL_COOLDOWN_MS = 10000;
const GLOBAL_COOLDOWN_ACTION = 'sim-global';

// Default per tim, sama dengan batas bawaan developer. Angka ini bisa diubah
// lewat `d sim global limit`, jadi yang dipakai selalu nilai tersimpan.
const DEFAULT_GLOBAL_RUNS = store.DEFAULT_MAX_GLOBAL_RUNS;

// Batas per perintah. Diukur ~240 ribu pertarungan/detik dengan 4 worker, jadi
// 10 juta kira-kira 40 detik: masih di bawah batas waktu interaksi Discord dan
// jauh di atas kebutuhan normal.
const MAX_GLOBAL_BATTLES = 10_000_000;

// Hasil simulasi global disimpan sebentar di memori supaya tombol "lihat
// kekalahan" bisa membacanya. Kunci = userId + token; token acak per simulasi
// agar tombol dari hasil lama tidak menampilkan data yang sudah basi.
const GLOBAL_RESULT_TTL_MS = 15 * 60 * 1000;
const globalResults = new Map();
// Hasil satu pertarungan disimpan sebentar supaya tombol 🔁 bisa mengulang
// matchup yang sama tanpa user mengetik ulang perintahnya.
const duelResults = new Map();
// Berapa pertarungan dicoba saat `-win`/`-lose`/`-tie` dipakai tanpa `-m`.
// Memakai DEFAULT_RUNS, angka yang sudah dipakai rekap footer, supaya tidak
// ada jumlah baru yang muncul tiba-tiba di pesan.
const OUTCOME_SEARCH_LIMIT = DEFAULT_RUNS;

// Cari satu pertarungan yang hasilnya cocok dengan filter `-win`/`-lose`/`-tie`.
// RNG di-fork per percobaan supaya hasilnya tetap deterministik untuk seed yang
// sama, dan `tried` dikembalikan agar pesan gagal bisa menyebut berapa
// pertarungan sudah diperiksa.
function findBattleWithOutcome(playerSpecs, enemySpecs, {
  wanted, seed, playerQuality, enemyQuality, log = false,
}) {
  const rng = createRng(seed == null ? randomSeed() : seed);
  for (let tried = 1; tried <= OUTCOME_SEARCH_LIMIT; tried++) {
    const battle = engine.runBattle(playerSpecs, enemySpecs, {
      rng: rng.fork(), playerQuality, enemyQuality,
    });
    if (battle.winner !== wanted) continue;
    // Percobaan yang tidak ditampilkan tidak perlu dicatat. Yang cocok dijalankan
    // ulang dengan RNG yang sama supaya hasilnya identik sekaligus berlog.
    if (log) {
      return {
        battle: engine.runBattle(playerSpecs, enemySpecs, {
          rng: rng.fork(), playerQuality, enemyQuality, log: true,
        }),
        tried,
      };
    }
    return { battle, tried };
  }
  return { battle: null, tried: OUTCOME_SEARCH_LIMIT };
}

// `-m N` bersama filter: jalankan tepat N pertarungan, lalu hitung hanya yang
// cocok. Tanpa pengali tambahan — jumlah yang dijalankan persis yang diminta
// user, jadi tidak ada angka lain yang muncul di pesan.
async function simulateMatching(playerSpecs, enemySpecs, {
  wanted, runs, seed, playerQuality, enemyQuality,
}) {
  const maxAttempts = Math.max(1, Math.floor(Number(runs) || 1));
  const startedAt = Date.now();
  // Seed selalu konkret: footer menampilkannya, jadi `undefined` tidak boleh bocor.
  const usedSeed = seed == null ? randomSeed() : Number(seed);
  const base = createRng(usedSeed);
  const tally = { player: 0, enemy: 0, tie: 0 };
  const histogram = new Uint32Array(data.limits.maxTurns + 2);
  let matched = 0;
  let attempts = 0;
  let timeouts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const battle = engine.runBattle(playerSpecs, enemySpecs, {
      rng: base.fork(), playerQuality, enemyQuality,
    });
    if (battle.winner !== wanted) continue;
    matched++;
    tally[battle.winner] += 1;
    histogram[Math.min(battle.turns, data.limits.maxTurns + 1)] += 1;
    if (battle.timeout) timeouts += 1;
    if (attempts % 500 === 0) await new Promise(r => setImmediate(r));
  }
  if (!matched) return null;

  let min = 0;
  let max = 0;
  for (let t = 0; t < histogram.length; t++) {
    if (!histogram[t]) continue;
    if (!min) min = t;
    max = t;
  }
  const turnHistogram = [];
  for (let t = 0; t < histogram.length; t++) {
    if (histogram[t]) turnHistogram.push({ turns: t, count: histogram[t] });
  }
  const rate = n => Math.round((n / matched) * 1000) / 10;

  // `runs` adalah jumlah pertarungan yang dijalankan, bukan yang cocok: itu
  // yang ditampilkan footer ("Hasil dari N simulasi") dan memang N yang diminta.
  return {
    runs: attempts,
    seed: usedSeed,
    tally,
    timeouts,
    turnHistogram,
    elapsedMs: Date.now() - startedAt,
    turns: { min, max },
    winRate: rate(tally.player),
    lossRate: rate(tally.enemy),
    tieRate: rate(tally.tie),
  };
}

const DUEL_RESULT_TTL_MS = 15 * 60 * 1000;

function rememberDuelResult(userId, token, payload) {
  const now = Date.now();
  for (const [key, entry] of duelResults) {
    if (now - entry.at > DUEL_RESULT_TTL_MS) duelResults.delete(key);
  }
  duelResults.set(`${userId}${token}`, { at: now, ...payload });
}

function getDuelResult(userId, token) {
  const entry = duelResults.get(`${userId}${token}`);
  if (!entry) return null;
  if (Date.now() - entry.at > DUEL_RESULT_TTL_MS) {
    duelResults.delete(`${userId}${token}`);
    return null;
  }
  return entry;
}

function rememberGlobalResult(userId, token, payload) {
  const now = Date.now();
  for (const [key, entry] of globalResults) {
    if (now - entry.at > GLOBAL_RESULT_TTL_MS) globalResults.delete(key);
  }
  globalResults.set(`${userId}${token}`, { at: now, ...payload });
}

function getGlobalResult(userId, token) {
  const entry = globalResults.get(`${userId}${token}`);
  if (!entry) return null;
  if (Date.now() - entry.at > GLOBAL_RESULT_TTL_MS) {
    globalResults.delete(`${userId}${token}`);
    return null;
  }
  return entry;
}

// Token pendek yang aman untuk customId (tanpa pemisah `:`).
function resultToken(seed) {
  return `${seed.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// Simulasi besar bisa berjalan lama, jadi hasil sementara ditampilkan di satu
// pesan yang diedit berkala lalu ditimpa hasil akhir. Dipakai bersama oleh
// mode biasa dan mode global supaya perilakunya sama.
//
// `sendEmbed` mengirim embed saja, `sendPayload` mengirim payload penuh
// (embed + tombol). Keduanya dipisah karena pemanggil lama hanya menyediakan
// `sendEmbed`.
function makeProgressPublisher(message, sendEmbed, sendPayload, labels, mode) {
  let progressMessage = null;
  let progressDisabled = false;
  let lastEdit = 0;
  let editing = false;

  const publish = async progress => {
    if (progressDisabled) return;
    const embed = simProgressEmbed(progress, {
      ...labels,
      mode,
      title: mode === 'global' ? '🌍 Simulasi Global — berjalan' : null,
    });

    if (!progressMessage) {
      const sent = await sendEmbed(message, embed);
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

  // Kirim (atau timpa) hasil akhir di pesan progres yang sama. Pemanggil yang
  // hanya menyediakan `sendEmbed` (tes, perintah lama) tetap dapat embed-nya.
  publish.finish = async payload => {
    if (progressMessage) {
      try {
        await progressMessage.edit(payload);
        return progressMessage;
      } catch {
        // Gagal mengedit (pesan dihapus / rate limit): kirim sebagai pesan baru.
      }
    }
    if (sendPayload) return sendPayload(message, payload);
    const embed = payload?.embeds?.[0];
    return embed ? sendEmbed(message, embed) : null;
  };

  return publish;
}

function globalUsage(prefix = 'd') {
  return [
    `\`${prefix} sim global\` — tim aktif melawan **seluruh tim tersimpan** (kecuali tim yang dipilih)`,
    `\`${prefix} sim global <blueprint>\` — blueprint melawan seluruh tim tersimpan`,
    '',
    'Hasil berisi: rata-rata streak, rata-rata kalah, dan rekap menang/seri/kalah',
    'yang dipisah antara tim lawan berlevel di bawah 35 dan 35 ke atas.',
    'Tombol **Lihat kekalahan** menampilkan tim mana saja yang mengalahkan kamu',
    '(hanya terlihat olehmu, senjata lawan disembunyikan).',
    '',
    `Opsi:`,
    `\`-m <jumlah>\` berapa kali tiap tim dilawan (default ${store.DEFAULT_MAX_GLOBAL_RUNS.toLocaleString('id-ID')})`,
    `\`-total <jumlah>\` total pertarungan, dibagi rata ke semua tim lawan`,
    `\`-qp <0-100>\` kualitas senjata tim kamu (menimpa kualitas slot)`,
    `\`-qe <0-100>\` kualitas senjata semua tim lawan`,
    `\`lvl100\` / \`lvl100/60\` / \`lvl/40\` samakan level, seperti \`${prefix} sim\``,
    `\`-s <seed>\` ulangi hasil yang sama`,
    '',
    `Batas per tim: **${store.getMaxGlobalRuns().toLocaleString('id-ID')}** pertarungan `
      + `(diatur developer lewat \`${prefix} sim global limit\`).`,
    `Batas keras: **${MAX_GLOBAL_BATTLES.toLocaleString('id-ID')}** pertarungan per perintah.`,
    'Pertarungan dibagi ke beberapa worker, jadi jutaan pertarungan selesai',
    'dalam hitungan detik sampai puluhan detik.',
    `Cooldown: **${Math.round(GLOBAL_COOLDOWN_MS / 1000)} detik** untuk selain developer.`,
  ].join('\n');
}

// Terima dua bentuk: `-m <per tim>` atau `-total <total pertarungan>`.
// Keduanya dibatasi MAX_GLOBAL_BATTLES supaya satu perintah tidak menahan bot
// terlalu lama.
function resolveRunCount(flags, opponentCount, { maxPerTeam = null, isDev = false, prefix = 'd' } = {}) {
  const perTeam = flags['-m'] ?? flags['-n'] ?? flags['-runs'];
  const total = flags['-total'] ?? flags['-t'];

  if (perTeam != null && total != null) {
    return { error: 'Pakai salah satu: `-m` (per tim) atau `-total` (total pertarungan), jangan keduanya.' };
  }

  if (total != null) {
    const value = Number(total);
    if (!Number.isSafeInteger(value) || value < 1) {
      return { error: `Total pertarungan harus bilangan bulat 1 atau lebih. Contoh: \`${prefix} sim global -total 1000000\`.` };
    }
    if (value > MAX_GLOBAL_BATTLES) {
      return { error: `Total pertarungan terlalu besar. Maksimum **${MAX_GLOBAL_BATTLES.toLocaleString('id-ID')}**.` };
    }
    // Dibulatkan ke bawah supaya total tidak melebihi yang diminta; sisa
    // pembagian tidak dijalankan.
    const perTeamValue = Math.max(1, Math.floor(value / opponentCount));
    // `-total` juga dibatasi lewat angka per tim, kalau tidak batas bisa
    // dilewati hanya dengan mengganti nama flag.
    if (!isDev && maxPerTeam != null && perTeamValue > maxPerTeam) {
      return {
        error: `Maksimum **${maxPerTeam.toLocaleString('id-ID')}** pertarungan per tim `
          + `(≈ **${(maxPerTeam * opponentCount).toLocaleString('id-ID')}** total untuk `
          + `${opponentCount} tim). Kamu meminta ${perTeamValue.toLocaleString('id-ID')} per tim.`,
      };
    }
    return { value: perTeamValue, total: value };
  }

  const runs = perTeam ?? maxPerTeam ?? DEFAULT_GLOBAL_RUNS;
  const value = Number(runs);
  if (!Number.isSafeInteger(value) || value < 1) {
    return { error: `Jumlah simulasi harus bilangan bulat 1 atau lebih. Contoh: \`${prefix} sim global -m 5000\`.` };
  }
  // Batas per tim dari developer. Developer sendiri tidak dibatasi, sama
  // seperti `d sim`.
  if (!isDev && maxPerTeam != null && value > maxPerTeam) {
    return {
      error: `Maksimum **${maxPerTeam.toLocaleString('id-ID')}** pertarungan per tim. `
        + `Kamu meminta ${value.toLocaleString('id-ID')} per tim.`,
    };
  }
  if (value * opponentCount > MAX_GLOBAL_BATTLES) {
    const maxPerTeam = Math.floor(MAX_GLOBAL_BATTLES / opponentCount);
    return {
      error: `Terlalu besar: ${value.toLocaleString('id-ID')} × ${opponentCount} tim = `
        + `${(value * opponentCount).toLocaleString('id-ID')} pertarungan, batasnya `
        + `**${MAX_GLOBAL_BATTLES.toLocaleString('id-ID')}**. `
        + `Maksimum untuk ${opponentCount} tim: \`-m ${maxPerTeam.toLocaleString('id-ID')}\`.`,
    };
  }
  return { value, total: value * opponentCount };
}

async function handleGlobalSim(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  const sendPayload = deps.sendPayload || null;
  const isDev = deps.isDeveloper ? deps.isDeveloper(message) : false;
  const userId = message.author.id;

  const { flags, rest, unknown } = parseFlags(args);
  if (unknown.length) return send(message, unknownFlagsError(unknown, prefix));

  const seed = flags['-s'] ?? flags['-seed'];
  if (seed != null && !Number.isFinite(Number(seed))) return send(message, errorEmbed('Seed harus angka.'));

  // Kualitas senjata: `-qp` untuk tim pemain, `-qe` untuk semua lawan.
  const qualityOf = value => {
    if (value == null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
  };
  const playerQuality = qualityOf(flags['-qp']);
  const enemyQuality = qualityOf(flags['-qe']);

  // Flag `lvl` sama artinya dengan `d sim`: menimpa level tanpa mengubah data.
  const levels = parseLevels(flags.lvl);
  if (levels.invalid || flags.lvl?.malformed) {
    return send(message, errorEmbed(`Format level salah. Contoh: \`${prefix} sim global lvl100\`, \`${prefix} sim global lvl/40\`.`));
  }

  // Tanpa argumen, tim aktif yang bertarung. Dengan argumen, argumen itu
  // dibaca sebagai blueprint komposisi inline (hewan/senjata/pasif).
  const blueprintText = rest.join(' ').trim();
  let team = null;
  let rawPlayerSpecs = null;
  let playerLabel = null;
  if (blueprintText) {
    const parsed = simParser.parseInlineSide(rest, {
      defaultLevel: levels.player ?? data.DEFAULT_LEVEL,
      prefix,
    });
    if (parsed.error) return send(message, errorEmbed(`❌ ${parsed.error}`));
    rawPlayerSpecs = parsed.specs;
    playerLabel = parsed.label;
  } else {
    team = store.getActiveTeam(userId);
    if (!team) {
      return send(message, errorEmbed(`Belum ada tim aktif. Buat dulu: \`${prefix} team new <nama>\` lalu \`${prefix} team add 1 <hewan>\`.`));
    }
    if (!team.slots.length) {
      return send(message, errorEmbed(`Tim **${team.name}** masih kosong. Isi dengan \`${prefix} team add 1 <hewan>\`.`));
    }
    const rawPlayer = resolveTeamSpecs(team);
    if (rawPlayer.error) return send(message, errorEmbed(`❌ ${rawPlayer.error}`));
    rawPlayerSpecs = rawPlayer.specs;
    playerLabel = teamLabel(team);
  }
  const player = { specs: withLevel(withQuality(rawPlayerSpecs, playerQuality), levels.player) };

  const opponents = [];
  // Simulasi global melawan semua tim tersimpan, termasuk tim lain milik user
  // sendiri. Hanya tim aktif yang dikecualikan saat memakai tim aktif; saat
  // memakai blueprint tidak ada tim tersimpan yang perlu dikecualikan.
  const skipped = [];
  let excluded = 0;
  const allTeams = store.listAllTeams();
  for (const other of allTeams) {
    if (team && other.id === team.id) { excluded += 1; continue; }
    if (!other.slots.length) {
      skipped.push({ label: teamLabel(other), reason: 'kosong' });
      continue;
    }
    const specs = resolveTeamSpecs(other);
    if (specs.error) {
      skipped.push({ label: teamLabel(other), reason: 'stat belum lengkap' });
      continue;
    }
    opponents.push({
      teamId: other.id,
      slotId: other.slotId,
      label: teamLabel(other),
      specs: withLevel(withQuality(specs.specs, enemyQuality), levels.enemy),
    });
  }
  if (!opponents.length) {
    return send(message, warnEmbed('Belum ada tim lawan yang bisa dipakai. Simulasi global butuh tim tersimpan selain tim yang sedang dipilih.'));
  }

  // Jumlah run baru bisa dihitung setelah jumlah lawan diketahui, karena
  // `-total` dibagi rata ke semua lawan.
  // Batas per tim mengikuti setting developer; developer bebas melewatinya.
  const maxPerTeam = isDev ? null : store.globalRunLimitFor();
  const runCount = resolveRunCount(flags, opponents.length, { maxPerTeam, isDev, prefix });
  if (runCount.error) return send(message, errorEmbed(runCount.error));

  // Gerbang cooldown dipasang setelah validasi supaya salah ketik tidak
  // menghabiskan jatah. Developer melewati cooldown untuk pengujian.
  if (!isDev) {
    const waiting = store.cooldownRemaining(userId, GLOBAL_COOLDOWN_ACTION);
    if (waiting > 0) {
      return send(message, warnEmbed(
        `⏳ Simulasi global baru bisa dipakai lagi dalam **${(waiting / 1000).toFixed(1)} detik**.`
      ));
    }
    store.setCooldown(userId, GLOBAL_COOLDOWN_ACTION, Date.now() + GLOBAL_COOLDOWN_MS);
  }

  const labels = { playerLabel };
  const publishProgress = makeProgressPublisher(message, send, sendPayload, labels, 'global');

  // Embed progres dikirim sebelum simulasi dimulai supaya user langsung melihat
  // balasan, bukan menunggu potongan pertama selesai. Kalau antrean sedang
  // dipakai, statusnya jujur menyebut "menunggu antrean".
  await publishProgress({
    done: 0,
    total: runCount.total,
    tally: { player: 0, enemy: 0, tie: 0 },
    winRate: 0,
    lossRate: 0,
    tieRate: 0,
    etaMs: null,
    avgTurns: 0,
    queued: globalSim.queueInfo().active > 0,
  });

  let result;
  try {
    result = await globalSim.runGlobalSim(player.specs, opponents, {
      runs: runCount.value,
      seed: seed != null ? Number(seed) : undefined,
      playerQuality,
      enemyQuality,
      onProgress: publishProgress,
    });
  } catch (error) {
    // Antrean penuh bukan kesalahan user: beri tahu dan lepas cooldown supaya
    // bisa langsung mencoba lagi.
    if (!isDev) store.clearCooldown(userId, GLOBAL_COOLDOWN_ACTION);
    return send(message, errorEmbed(`❌ ${error.message}`));
  }
  if (!isDev) store.setCooldown(userId, GLOBAL_COOLDOWN_ACTION, Date.now() + GLOBAL_COOLDOWN_MS);

  await animalDex.ensureAnimalEmojis([
    ...player.specs.map(spec => spec.animal),
    ...opponents.flatMap(o => o.specs.map(spec => spec.animal)),
  ]);

  const token = resultToken(result.seed);
  rememberGlobalResult(userId, token, { result, playerLabel: labels.playerLabel });

  const finalEmbed = globalSimEmbed(result, {
    playerLabel: labels.playerLabel,
    prefix,
    playerSpecs: player.specs,
    skipped,
    totals: { all: allTeams.length, excluded },
  });
  const payload = {
    embeds: [finalEmbed],
    // Tombol tetap ditampilkan walau belum ada kekalahan; saat dibuka akan
    // menjawab bahwa tidak ada tim yang menang.
    components: [globalLossButton(userId, token)],
  };

  return publishProgress.finish(payload);
}

// Tombol "lihat kekalahan": balasan ephemeral berisi tim yang mengalahkan
// pemain, dengan ikon senjata diganti tanda tanya.
//
// Ini satu-satunya tombol di lingkungan Simulasi yang boleh dipakai selain
// pemiliknya. Isinya sudah publik: nama tim, level, dan jumlah menang/kalah,
// sementara senjata lawan sengaja disembunyikan. Jadi menekannya tidak
// membuka data pribadi pemilik simulasi.
async function handleGlobalLossButton(i, deps = {}) {
  const prefix = deps.prefix || 'd';
  const parsed = parseGlobalLossButton(i.customId);
  if (!parsed.ok) {
    return i.reply({ content: `Tombol kedaluwarsa. Jalankan \`${prefix} sim global\` lagi.`, flags: MessageFlags.Ephemeral });
  }
  const entry = getGlobalResult(parsed.userId, parsed.token);
  if (!entry) {
    return i.reply({
      content: `Hasil simulasi ini sudah kedaluwarsa. Jalankan \`${prefix} sim global\` lagi.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await animalDex.ensureAnimalEmojis(
    entry.result.losses.flatMap(loss => loss.specs.map(spec => spec.animal))
  );
  return i.reply({
    embeds: [globalLossesEmbed(entry.result, { playerLabel: entry.playerLabel })],
    flags: MessageFlags.Ephemeral,
  });
}

// Tombol 🔁: jalankan ulang matchup yang sama sebagai `-m <DEFAULT_RUNS>`.
// Balasannya ephemeral supaya hasil panjang tidak membanjiri channel.
async function handleRepeatButton(i, deps = {}) {
  const prefix = deps.prefix || 'd';
  const parsed = parseRepeatButton(i.customId);
  if (!parsed.ok) {
    return i.reply({ content: `Tombol kedaluwarsa. Jalankan \`${prefix} sim\` lagi.`, flags: MessageFlags.Ephemeral });
  }
  if (parsed.userId !== i.user.id) {
    return i.reply({
      content: `Tombol ini milik orang lain. Jalankan \`${prefix} sim\` untuk hasilmu sendiri.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const entry = getDuelResult(parsed.userId, parsed.token);
  if (!entry) {
    return i.reply({
      content: `Hasil ini sudah kedaluwarsa. Jalankan \`${prefix} sim\` lagi.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Jatah terpisah dari `sim`: tombol ditekan tepat setelah `d sim`, yang sudah
  // memasang cooldown. Tanpa ini tombolnya selalu ditolak selama 5 detik.
  const waiting = store.cooldownRemaining(parsed.userId, REPEAT_COOLDOWN_ACTION);
  if (waiting > 0) {
    return i.reply({
      content: `⏳ Tunggu **${(waiting / 1000).toFixed(1)} detik** lagi sebelum mengulang.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  store.setCooldown(parsed.userId, REPEAT_COOLDOWN_ACTION, Date.now() + SIM_COOLDOWN_MS);

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await sim.simulate(entry.playerSpecs, entry.enemySpecs, {
    runs: DEFAULT_RUNS,
    playerQuality: entry.playerQuality,
    enemyQuality: entry.enemyQuality,
  });
  store.setCooldown(parsed.userId, REPEAT_COOLDOWN_ACTION, Date.now() + SIM_COOLDOWN_MS);

  await animalDex.ensureAnimalEmojis([
    ...entry.playerSpecs.map(spec => spec.animal),
    ...entry.enemySpecs.map(spec => spec.animal),
  ]);
  const embed = simEmbed(result, {
    ...entry.labels,
    matchup: renderMatchup(entry.playerSpecs, entry.enemySpecs, entry.labels),
  });
  return i.editReply({ embeds: [embed] });
}

// Batas jumlah pertarungan untuk user biasa. Tanpa argumen hanya menampilkan
// nilai sekarang; developer tetap bebas melewatinya.
function handleLimitCommand(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  const dev = deps.isDeveloper ? deps.isDeveloper(message) : false;
  const current = store.getMaxRuns();

  if (!args.length) {
    return send(message, usageEmbed(
      '⚙️ Batas Pertarungan',
      [
        `Maksimum sekarang: **${current.toLocaleString('id-ID')}** pertarungan per perintah.`,
        `Default saat \`-m\` tidak disebut: **${DEFAULT_RUNS}**.`,
        '',
        `Ubah dengan \`${prefix} sim limit <jumlah>\` (khusus developer).`,
        'Developer tidak dibatasi angka ini.',
      ].join('\n')
    ));
  }

  if (!dev) {
    return send(message, errorEmbed('Hanya developer bot yang bisa mengubah batas pertarungan.'));
  }

  const value = Number(args[0]);
  if (!Number.isSafeInteger(value) || value < 1) {
    return send(message, errorEmbed(
      'Batas harus bilangan bulat 1 atau lebih. Contoh: `' + prefix + ' sim limit 500`.'
    ));
  }
  const saved = store.setMaxRuns(value);
  if (saved == null) {
    return send(message, errorEmbed('Gagal menyimpan batas pertarungan.'));
  }
  return send(message, usageEmbed(
    '⚙️ Batas Pertarungan',
    `Maksimum per perintah sekarang **${saved.toLocaleString('id-ID')}** untuk semua user.\n`
    + `Default tanpa \`-m\` tetap **${DEFAULT_RUNS}**.`
  ));
}

// `d sim global limit [per-tim] [per-user]` (khusus developer).
// Dua angka terpisah: batas umum untuk semua user, dan batas khusus satu user
// yang menimpa batas umum. Tanpa argumen hanya menampilkan nilai sekarang.
function handleGlobalLimitCommand(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  const dev = deps.isDeveloper ? deps.isDeveloper(message) : false;

  const describe = () => [
    `Per tim untuk semua user: **${store.getMaxGlobalRuns().toLocaleString('id-ID')}**`,
    `Batas khusus user: ${store.getMaxGlobalUser() == null
      ? '_tidak ada_ (memakai batas umum)'
      : `**${store.getMaxGlobalUser().toLocaleString('id-ID')}**`}`,
    '',
    `Ubah: \`${prefix} sim global limit <per-tim>\``,
    `Batas khusus user: \`${prefix} sim global limit user <jumlah>\``,
    `Hapus batas khusus user: \`${prefix} sim global limit user 0\``,
    'Developer tidak dibatasi angka ini.',
  ].join('\n');

  if (!args.length) {
    return send(message, usageEmbed('⚙️ Batas Simulasi Global', describe()));
  }
  if (!dev) {
    return send(message, errorEmbed('Hanya developer bot yang bisa mengubah batas simulasi global.'));
  }

  const target = (args[0] || '').toLowerCase();
  const parse = raw => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
  };

  if (target === 'user') {
    // `0` menghapus batas khusus supaya user kembali mengikuti batas umum.
    if (args[1] === '0') {
      store.setMaxGlobalUser(null);
      return send(message, usageEmbed('⚙️ Batas Simulasi Global', describe()));
    }
    const value = parse(args[1]);
    if (value == null) {
      return send(message, errorEmbed(`Batas harus bilangan bulat 1 atau lebih. Contoh: \`${prefix} sim global limit user 500\`.`));
    }
    store.setMaxGlobalUser(value);
    return send(message, usageEmbed('⚙️ Batas Simulasi Global', describe()));
  }

  const value = parse(args[0]);
  if (value == null) {
    return send(message, errorEmbed(`Batas harus bilangan bulat 1 atau lebih. Contoh: \`${prefix} sim global limit 100\`.`));
  }
  store.setMaxGlobalRuns(value);
  return send(message, usageEmbed('⚙️ Batas Simulasi Global', describe()));
}

async function handleSimCommand(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  const userId = message.author.id;

  // `help` tidak kena cooldown: perintah bantuan tidak menjalankan simulasi.
  if ((args[0] || '').toLowerCase() === 'help' || (args[0] || '').toLowerCase() === 'bantuan') {
    return send(message, usageEmbed('⚔️ Simulasi Battle', usage(prefix)));
  }

  // `d sim limit [jumlah]` — developer mengatur batas pertarungan semua user.
  if ((args[0] || '').toLowerCase() === 'limit') {
    return handleLimitCommand(message, args.slice(1), prefix, deps);
  }

  // `d sim global` / `d sim g` — mode simulasi melawan semua tim tersimpan.
  const mode = (args[0] || '').toLowerCase();
  if (['global', 'g'].includes(mode)) {
    const rest = args.slice(1);
    if (['help', 'bantuan'].includes((rest[0] || '').toLowerCase())) {
      return send(message, usageEmbed('🌍 Simulasi Global', globalUsage(prefix)));
    }
    if ((rest[0] || '').toLowerCase() === 'limit') {
      return handleGlobalLimitCommand(message, rest.slice(1), prefix, deps);
    }
    return handleGlobalSim(message, rest, prefix, deps);
  }

  const { flags, rest, unknown } = parseFlags(args);
  if (unknown.length) return send(message, unknownFlagsError(unknown, prefix));
  const isDev = deps.isDeveloper ? deps.isDeveloper(message) : false;
  if (flags.log && !isDev) {
    return send(message, errorEmbed('Opsi `-log` khusus developer bot.'));
  }
  const levels = parseLevels(flags.lvl);
  if (levels.invalid || flags.lvl?.malformed) {
    return send(message, errorEmbed(`Format level salah. Contoh: \`${prefix} sim lvl100\`, \`${prefix} sim lvl100/60\`, \`${prefix} sim lvl/40\`.`));
  }

  // `d sim <tim> vs <lawan>` memilih kedua sisi. Tanpa `vs`, sisi pemain
  // adalah tim aktif dan sisa argumen menjadi lawan. Sisi dengan `vs` juga
  // boleh berupa komposisi inline, mis. `snail sword crit mtap`.
  const sides = splitVs(rest);
  let resolvedPlayerSpecs = null;
  let playerLabel = null;

  if (sides.playerTokens.length) {
    const query = sides.playerTokens.join(' ');
    const team = store.findTeam(userId, query);
    if (team) {
      if (!team.slots.length) {
        return send(message, errorEmbed(`Tim **${team.name}** masih kosong. Isi dengan \`${prefix} team add 1 <hewan>\`.`));
      }
      const player = resolveTeamSpecs(team);
      if (player.error) return send(message, errorEmbed(`❌ ${player.error}`));
      resolvedPlayerSpecs = player.specs;
      playerLabel = teamLabel(team);
    } else {
      const inline = simParser.parseInlineSide(sides.playerTokens, {
        defaultLevel: levels.player ?? data.DEFAULT_LEVEL,
        prefix,
      });
      if (!inline.error) {
        resolvedPlayerSpecs = inline.specs;
        playerLabel = inline.label;
      } else if (simParser.looksInline(sides.playerTokens) || data.findAnimal(query)) {
        return send(message, errorEmbed(`❌ ${inline.error}`));
      } else if (store.findForeignTeam(userId, query)) {
        return send(message, errorEmbed('Kamu tidak memiliki tim tersebut.'));
      } else {
        return send(message, errorEmbed(`Tim **${query}** tidak ditemukan. Lihat \`${prefix} tm\`.`));
      }
    }
  } else {
    const team = store.getActiveTeam(userId);
    if (!team) {
      return send(message, errorEmbed(`Belum ada tim aktif. Buat dulu: \`${prefix} team new <nama>\` lalu \`${prefix} team add 1 <hewan>\`.`));
    }
    if (!team.slots.length) {
      return send(message, errorEmbed(`Tim **${team.name}** masih kosong. Isi dengan \`${prefix} team add 1 <hewan>\`.`));
    }
    const player = resolveTeamSpecs(team);
    if (player.error) return send(message, errorEmbed(`❌ ${player.error}`));
    resolvedPlayerSpecs = player.specs;
    playerLabel = teamLabel(team);
  }
  // Tanpa `-m` hasilnya satu pertarungan (sisa HP/WP tiap hewan) sekaligus
  // tombol 🔁 untuk mengulanginya sebanyak `DEFAULT_RUNS`. Dengan `-m N`
  // hasilnya statistik dari N pertarungan.
  // Dicek dari keberadaan flag, bukan nilainya: `-m` tanpa angka tetap berarti
  // simulasi massal 50 pertarungan, bukan satu pertarungan.
  const singleBattle = !['-m', '-n', '-runs'].some(key => key in flags);
  const runs = flags['-m'] ?? flags['-n'] ?? flags['-runs'] ?? DEFAULT_RUNS;
  const runCount = Number(runs);
  if (!Number.isSafeInteger(runCount) || runCount < 1) {
    return send(message, errorEmbed(`Jumlah simulasi harus bilangan bulat 1 atau lebih. Contoh: \`${prefix} sim -m 500\`.`));
  }
  // Batas per perintah: user biasa mengikuti setting developer, developer bebas.
  const maxRuns = isDev ? Infinity : store.getMaxRuns();
  if (runCount > maxRuns) {
    return send(message, errorEmbed(
      `Jumlah pertarungan maksimum **${maxRuns.toLocaleString('id-ID')}** per perintah.`
      + `\nKamu meminta ${runCount.toLocaleString('id-ID')}.`
    ));
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

  const enemy = resolveEnemy(userId, sides.enemyArgs, levels.enemy, prefix);
  if (enemy.error) return send(message, errorEmbed(`❌ ${enemy.error}`));

  // Flag `lvl` menimpa level tersimpan, tanpa mengubah tim di database.
  // Kualitas efektif ikut ditulis ke spec supaya komposisi yang ditampilkan
  // sama dengan tier yang benar-benar dipakai (dan sama saat tombol 🔁 dipakai).
  const playerSpecs = withLevel(withQuality(resolvedPlayerSpecs, playerQuality), levels.player);
  const enemySpecs = withLevel(withQuality(enemy.specs, enemyQuality), levels.enemy);

  // Simulasi besar bisa berjalan lama. Kirim pesan progres lebih dulu, perbarui
  // berkala, lalu timpa dengan hasil akhir di pesan yang sama supaya channel
  // tidak dibanjiri pesan.
  const labels = { playerLabel, enemyLabel: enemy.label };
  const publishProgress = makeProgressPublisher(message, send, deps.sendPayload || null, labels, 'duel');

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

  if (singleBattle) {
    const startedAt = Date.now();
    // `-win`/`-lose`/`-tie` mencari pertarungan dengan hasil yang diminta.
    // Tanpa filter, satu pertarungan biasa sudah cukup.
    const wanted = flags.outcome || null;
    let battle = null;
    let tried = 1;
    if (wanted) {
      ({ battle, tried } = findBattleWithOutcome(playerSpecs, enemySpecs, {
        wanted,
        seed: seed != null ? Number(seed) : undefined,
        playerQuality,
        enemyQuality,
        log: Boolean(flags.log),
      }));
      if (!battle) {
        store.clearCooldown(userId, SIM_COOLDOWN_ACTION);
        // Jujur soal batas: sebut jumlah yang benar-benar dicoba, dan jangan
        // mengklaim hasil itu mustahil — sampel kecil tidak membuktikannya.
        return send(message, errorEmbed(
          `Tidak ada hasil **${OUTCOME_LABEL[wanted]}** dalam ${tried.toLocaleString('id-ID')} pertarungan yang dicoba.`
          + `\nCoba lagi, atau ubah tim/lawan.`
        ));
      }
    } else {
      battle = engine.runBattle(playerSpecs, enemySpecs, {
        seed: seed != null ? Number(seed) : undefined,
        playerQuality,
        enemyQuality,
        log: Boolean(flags.log),
      });
    }
    store.setCooldown(userId, SIM_COOLDOWN_ACTION, Date.now() + SIM_COOLDOWN_MS);
    await animalDex.ensureAnimalEmojis([
      ...playerSpecs.map(spec => spec.animal),
      ...enemySpecs.map(spec => spec.animal),
    ]);
    // Rekap menang/seri/kalah di footer dihitung dari `DEFAULT_RUNS` pertarungan
    // terpisah untuk matchup yang sama. Biayanya kecil (puluhan pertarungan)
    // dan membuat satu `d sim` langsung menjawab "tim ini bagus atau tidak",
    // tanpa perlu menjalankan `-m` lagi. `-tie` tetap diterima sebagai penegas.
    const stats = await sim.simulate(playerSpecs, enemySpecs, {
      runs: DEFAULT_RUNS,
      seed: seed != null ? Number(seed) : undefined,
      playerQuality,
      enemyQuality,
    });
    // `-log` menyimpan jalannya pertarungan lalu menautkannya di embed.
    // Gagal menyimpan tidak boleh membatalkan hasil battle yang sudah dihitung:
    // embed tetap dikirim, hanya tautannya yang tidak muncul.
    let logUrl = null;
    if (flags.log && battle.log) {
      const saved = battleLogStore.save(battle.log);
      if (saved.id) logUrl = battleLogUrl(saved.id);
      else console.error('[BattleLog]', saved.error);
    }
    const embed = duelEmbed(battle, {
      ...labels,
      elapsedMs: Date.now() - startedAt,
      seed: seed != null ? Number(seed) : null,
      stats,
      logUrl,
    });
    // Simpan spec-nya, bukan hasilnya: tombol harus menjalankan simulasi baru
    // (bukan memutar ulang hasil lama) supaya RNG tetap bergerak.
    const token = resultToken(seed != null ? Number(seed) : 1);
    rememberDuelResult(userId, token, {
      playerSpecs, enemySpecs, playerQuality, enemyQuality, labels,
    });
    const payload = { embeds: [embed], components: [repeatButton(userId, token, DEFAULT_RUNS)] };
    if (deps.sendPayload) return deps.sendPayload(message, payload);
    return send(message, embed);
  }

  // `-m N` + `-win`/`-lose`/`-tie`: hitung hanya pertarungan yang cocok, sampai
  // N terkumpul. Percobaan dibatasi supaya hasil yang mustahil tidak berputar
  // lama; kalau kurang dari N, hasilnya tetap ditampilkan apa adanya.
  const wanted = flags.outcome || null;
  let result;
  if (wanted) {
    result = await simulateMatching(playerSpecs, enemySpecs, {
      wanted, runs: runCount, seed: seed != null ? Number(seed) : undefined,
      playerQuality, enemyQuality,
    });
    if (!result) {
      store.clearCooldown(userId, SIM_COOLDOWN_ACTION);
      return send(message, errorEmbed(
        `Tidak ada hasil **${OUTCOME_LABEL[wanted]}** dalam ${runCount.toLocaleString('id-ID')} pertarungan.`
        + `\nCoba lagi, atau ubah tim/lawan.`
      ));
    }
  } else {
    result = await sim.simulate(playerSpecs, enemySpecs, {
      runs: runCount,
      seed: seed != null ? Number(seed) : undefined,
      playerQuality,
      enemyQuality,
      onProgress: publishProgress,
    });
  }
  store.setCooldown(userId, SIM_COOLDOWN_ACTION, Date.now() + SIM_COOLDOWN_MS);

  // Ringkasan matchup memuat emoji hewan; siapkan dulu seperti `d dex`.
  await animalDex.ensureAnimalEmojis([
    ...playerSpecs.map(spec => spec.animal),
    ...enemySpecs.map(spec => spec.animal),
  ]);

  const finalEmbed = simEmbed(result, {
    ...labels,
    matchup: renderMatchup(playerSpecs, enemySpecs, labels),
  });

  // Tombol 🔁 mengulang matchup yang sama sebanyak `DEFAULT_RUNS`. Spec
  // disimpan, bukan hasilnya, supaya penekanan tombol menjalankan simulasi baru.
  const token = resultToken(seed != null ? Number(seed) : 1);
  rememberDuelResult(userId, token, {
    playerSpecs, enemySpecs, playerQuality, enemyQuality, labels,
  });

  return publishProgress.finish({
    embeds: [finalEmbed],
    components: [repeatButton(userId, token, DEFAULT_RUNS)],
  });
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
function resolveEnemy(userId, args, overrideLevel, prefix = 'd') {
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

  // `d sim blitz` → lawan tim milik user sendiri. Dicek sebelum stat manual
  // karena nama tim bisa berupa angka ("1"). `d sim 3` memilih tim lewat ID;
  // nama tim tetap diterima untuk kompatibilitas.
  const ownTeam = raw ? store.findTeam(userId, raw) : null;
  if (ownTeam) {
    if (!ownTeam.slots.length) {
      return { error: `Tim **${teamLabel(ownTeam)}** masih kosong. Isi dulu dengan \`${prefix} team add 1 <hewan>\`.` };
    }
    const specs = resolveTeamSpecs(ownTeam);
    if (specs.error) return { error: specs.error };
    return { specs: specs.specs, label: teamLabel(ownTeam) };
  }

  // `level=` eksplisit menang atas flag `lvl`, karena lebih spesifik.
  const level = options.level ? Number(options.level) : (overrideLevel ?? 60);
  const looksLikeStats = raw.includes('=') || /^[\d\s,-]+$/.test(raw);
  if (looksLikeStats) {
    // Angka murni bisa berarti ID slot tim. Kalau slot itu bukan milik user,
    // jangan jatuh ke parser stat manual yang membingungkan.
    if (/^\d+$/.test(raw) && store.findForeignTeam(userId, raw)) {
      return { error: 'Kamu tidak memiliki tim tersebut.' };
    }
    const parsed = sim.parseCustomStats(raw);
    if (parsed.error) return { error: parsed.error };
    return { specs: [{ slot: 1, coeffs: parsed.custom, level, label: 'lawan' }], label: 'stat manual' };
  }

  // Komposisi inline: `100 snail`, `snail sword crit mtap`, atau beberapa
  // unit dipisah koma. Ini dicek setelah stat manual supaya `hp=8,att=6` tidak
  // dianggap komposisi.
  if (simParser.looksInline(rest)) {
    const inline = simParser.parseInlineSide(rest, { defaultLevel: level, prefix });
    if (inline.error) return { error: inline.error };
    return { specs: inline.specs, label: inline.label };
  }

  const animal = dexStore.resolveAnimal(raw) || dexStore.searchAnimals(raw)[0];
  if (!animal) {
    // Tim itu ada, tapi bukan milik user ini. Jangan jatuh ke "nama tidak
    // dikenal" karena pesan yang benar adalah soal kepemilikan.
    if (store.findForeignTeam(userId, raw)) {
      return { error: 'Kamu tidak memiliki tim tersebut.' };
    }
    return { error: `Lawan \`${raw}\` tidak dikenal. Pakai nama tim (lihat \`${prefix} team list\`), hewan dex, atau stat manual.` };
  }
  const coeffs = sim.dexStatsToCustom(animal);
  if (!coeffs) return { error: `Stat \`${animal.name}\` tidak lengkap di dex.` };
  return { specs: [{ slot: 1, coeffs, level, label: animal.name, animal }], label: animal.name };
}

module.exports = {
  handleSimCommand, handleGlobalSim, handleGlobalLossButton, handleRepeatButton, handleLimitCommand,
  handleGlobalLimitCommand,
  DEFAULT_RUNS, splitVs,
  parseFlags, resolveEnemy, resolveTeamSpecs, usage, globalUsage, resolveRunCount,
  GLOBAL_COOLDOWN_MS, DEFAULT_GLOBAL_RUNS, MAX_GLOBAL_BATTLES, globalResults,
};
