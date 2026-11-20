// Perintah simulasi battle.
//
//   dsim [lawan] [opsi]      simulasi tim aktif vs tim lain / stat manual
//   dsim -m 500              jumlah pertarungan (default 100)
//   dsim -s 1234             seed (default acak)
//   dsim -qp 80 -qe 50       quality senjata pemain / lawan
//   dsim -lawan hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=60
const store = require('../utils/battleTeamStorage');
const dexStore = require('../utils/animalDexStorage');
const sim = require('../services/battleSim');
const { simEmbed, renderMatchup, usageEmbed, errorEmbed } = require('../ui/battlePanel');
const { parseOptions } = require('./battleTeam');

function usage(prefix = 'd') {
  return [
    `\`${prefix} sim\` — tim aktif vs tim lain milikmu (atau mirror)`,
    `\`${prefix} sim <nama-tim>\` — lawan tim kustom lain milikmu`,
    `\`${prefix} sim hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=60\` — lawan stat manual`,
    `\`${prefix} sim <hewan> level=60\` — lawan dari hewan dex`,
    '',
    'Opsi: `-m <jumlah>` (default 100, maks 1000), `-s <seed>`, `-qp <0-100>`, `-qe <0-100>`',
  ].join('\n');
}

// Opsi berbentuk flag: `-m 500`, `-s 42`, `-qp 80`, `-qe 50`.
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
    rest.push(args[i]);
  }
  return { flags, rest };
}

function handleSimCommand(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  const guildId = message.guildId;
  const userId = message.author.id;

  if ((args[0] || '').toLowerCase() === 'help' || (args[0] || '').toLowerCase() === 'bantuan') {
    return send(message, usageEmbed('⚔️ Simulasi Battle', usage(prefix)));
  }

  const team = store.getActiveTeam(guildId, userId);
  if (!team) {
    return send(message, errorEmbed(`Belum ada tim aktif. Buat dulu: \`${prefix} team new <nama>\` lalu \`${prefix} team add 1 <hewan>\`.`));
  }
  if (!team.slots.length) {
    return send(message, errorEmbed(`Tim **${team.name}** masih kosong. Isi dengan \`${prefix} team add 1 <hewan>\`.`));
  }

  const { flags, rest } = parseFlags(args);
  const runs = flags['-m'] ?? flags['-n'] ?? flags['-runs'] ?? 100;
  if (!Number.isFinite(Number(runs)) || Number(runs) < 1 || Number(runs) > 1000) {
    return send(message, errorEmbed('Jumlah simulasi harus 1-1000. Contoh: `d sim -m 500`.'));
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

  const enemy = resolveEnemy(guildId, userId, rest);
  if (enemy.error) return send(message, errorEmbed(`❌ ${enemy.error}`));

  const result = sim.simulate(player.specs, enemy.specs, {
    runs: Number(runs),
    seed: seed != null ? Number(seed) : undefined,
    playerQuality,
    enemyQuality,
  });

  return send(message, simEmbed(result, {
    playerLabel: team.name,
    enemyLabel: enemy.label,
    matchup: renderMatchup(player.specs, enemy.specs),
  }));
}

// Tim aktif → spec engine, dengan stat diambil dari dex bila perlu.
function resolveTeamSpecs(team) {
  const slots = team.slots.map(slot => ({
    ...slot,
    dexAnimal: slot.animalKey ? dexStore.getAnimal(slot.animalKey) : null,
  }));
  return sim.toSpecs({ slots });
}

// Menentukan lawan: tim lain, hewan dex, atau stat manual.
function resolveEnemy(guildId, userId, args) {
  const { options, rest } = parseOptions(args);
  const raw = rest.join(' ').trim();

  // Tanpa argumen: pakai tim aktif lain milik user, kalau tidak ada pakai
  // stat seimbang dari tim pemain agar simulasi tetap bermakna.
  if (!raw) {
    const others = store.listTeams(guildId, userId);
    const active = store.getActiveTeam(guildId, userId);
    const other = others.find(t => active && t.id !== active.id && t.slots.length);
    if (other) {
      const specs = resolveTeamSpecs(other);
      if (specs.error) return { error: specs.error };
      return { specs: specs.specs, label: other.name };
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
  const enemyName = raw.includes(' vs ') ? raw.split(/\s+vs\s+/i).pop().trim() : raw;
  const ownTeam = enemyName ? store.getTeam(guildId, userId, enemyName) : null;
  if (ownTeam) {
    if (!ownTeam.slots.length) {
      return { error: `Tim **${ownTeam.name}** masih kosong. Isi dulu dengan \`d team add 1 <hewan>\`.` };
    }
    const specs = resolveTeamSpecs(ownTeam);
    if (specs.error) return { error: specs.error };
    return { specs: specs.specs, label: ownTeam.name };
  }

  const level = options.level ? Number(options.level) : 60;
  const looksLikeStats = raw.includes('=') || /^[\d\s,-]+$/.test(raw);
  if (looksLikeStats) {
    const parsed = sim.parseCustomStats(raw);
    if (parsed.error) return { error: parsed.error };
    return { specs: [{ slot: 1, coeffs: parsed.custom, level, label: 'lawan' }], label: 'stat manual' };
  }

  const animal = dexStore.getAnimal(raw.toLowerCase()) || dexStore.searchAnimals(raw)[0];
  if (!animal) return { error: `Lawan \`${raw}\` tidak dikenal. Pakai nama tim (lihat \`d team list\`), hewan dex, atau stat manual.` };
  const coeffs = sim.dexStatsToCustom(animal);
  if (!coeffs) return { error: `Stat \`${animal.name}\` tidak lengkap di dex.` };
  return { specs: [{ slot: 1, coeffs, level, label: animal.name, animal }], label: animal.name };
}

module.exports = { handleSimCommand, parseFlags, resolveEnemy, resolveTeamSpecs, usage };
