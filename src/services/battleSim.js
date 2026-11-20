// Jembatan antara tim tersimpan dan mesin simulasi.
//
// Tim menyimpan `animalKey` (nama hewan di dex) atau stat manual. Di sini
// keduanya diterjemahkan menjadi spec yang dimengerti battleEngine, termasuk
// pemetaan nama stat dex (hp/attack/protection/wisdom/magic/mr) ke urutan OwO.
const { runBattle } = require('./battleEngine');
const { createRng, randomSeed } = require('./battleRng');

// Urutan argumen stat manual: hp,att,pr,wp,mag,mr.
const STAT_KEYS = ['hp', 'att', 'pr', 'wp', 'mag', 'mr'];
const STAT_LABELS = {
  hp: 'HP', att: 'ATT', pr: 'PR', wp: 'WP', mag: 'MG', mr: 'MR',
};

// Nama stat pada dex Lucy → kunci stat OwO.
const DEX_STAT_MAP = {
  hp: 'hp', attack: 'att', protection: 'pr', wisdom: 'wp', magic: 'mag', mr: 'mr',
};

function dexStatsToCustom(animal) {
  if (!animal || !animal.stats) return null;
  const custom = {};
  let found = false;
  for (const [from, to] of Object.entries(DEX_STAT_MAP)) {
    const value = animal.stats[from];
    if (value != null && Number.isFinite(Number(value))) {
      custom[to] = Number(value);
      found = true;
    }
  }
  return found ? custom : null;
}

// "hp=14 att=3 pr=2" atau "14,3,2,1,0,4" → objek stat.
function parseCustomStats(input) {
  const text = String(input || '').trim();
  if (!text) return { error: 'Stat kosong.' };

  if (text.includes('=')) {
    const custom = {};
    for (const part of text.split(/[\s,]+/).filter(Boolean)) {
      const m = /^([a-zA-Z]+)=(-?\d+)$/.exec(part);
      if (!m) return { error: `Format stat tidak dikenal: \`${part}\`` };
      const key = m[1].toLowerCase();
      const mapped = Object.keys(DEX_STAT_MAP).includes(key) ? DEX_STAT_MAP[key] : key;
      if (!STAT_KEYS.includes(mapped)) {
        return { error: `Stat \`${m[1]}\` tidak dikenal. Pakai: ${STAT_KEYS.join(', ')}.` };
      }
      custom[mapped] = Number(m[2]);
    }
    return { custom };
  }

  const values = text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length !== STAT_KEYS.length || values.some(v => !Number.isFinite(v))) {
    return { error: `Butuh ${STAT_KEYS.length} angka (${STAT_KEYS.join(',')}) atau format nama=nilai.` };
  }
  const custom = {};
  STAT_KEYS.forEach((key, i) => { custom[key] = values[i]; });
  return { custom };
}

// Tim tersimpan → spec engine. Slot kosong dilewati.
function toSpecs(team) {
  const specs = [];
  for (const slot of team.slots) {
    const spec = {
      slot: slot.slot,
      label: slot.label || slot.animalKey || `slot${slot.slot}`,
      level: slot.level || 1,
      weapon: slot.weaponId ? { id: slot.weaponId, quality: slot.weaponQuality, passives: slot.passives } : null,
    };
    // Stat manual menang atas lookup dex, supaya user bisa mengoreksi hewan
    // yang belum pernah tertangkap bot.
    const coeffs = slot.custom || (slot.animalKey ? dexStatsToCustom(slot.dexAnimal) : null);
    if (!coeffs) {
      return { error: `Slot ${slot.slot}: isi stat manual atau tangkap hewan \`${slot.animalKey}\` dulu.` };
    }
    spec.coeffs = coeffs;
    spec.customStats = Boolean(slot.custom);
    spec.animal = slot.dexAnimal || null;
    specs.push(spec);
  }
  if (!specs.length) return { error: 'Tim belum punya hewan di slot mana pun.' };
  return { specs };
}

// Jalankan N simulasi dengan seed berurutan agar bisa direproduksi.
function simulate(playerSpecs, enemySpecs, { runs = 1, seed = randomSeed(), playerQuality, enemyQuality } = {}) {
  const total = Math.max(1, Math.min(1000, Number(runs) || 1));
  const tally = { player: 0, enemy: 0, tie: 0 };
  const turns = [];
  let timeouts = 0;
  const base = createRng(seed);

  for (let i = 0; i < total; i++) {
    const result = runBattle(playerSpecs, enemySpecs, {
      rng: base.fork(),
      playerQuality,
      enemyQuality,
    });
    tally[result.winner] += 1;
    turns.push(result.turns);
    if (result.timeout) timeouts += 1;
  }

  const sorted = [...turns].sort((a, b) => a - b);
  return {
    runs: total,
    seed,
    tally,
    timeouts,
    turns: {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round((turns.reduce((a, b) => a + b, 0) / total) * 10) / 10,
      median: sorted[Math.floor(sorted.length / 2)],
    },
    winRate: Math.round((tally.player / total) * 1000) / 10,
    lossRate: Math.round((tally.enemy / total) * 1000) / 10,
    tieRate: Math.round((tally.tie / total) * 1000) / 10,
  };
}

module.exports = {
  STAT_KEYS,
  STAT_LABELS,
  DEX_STAT_MAP,
  dexStatsToCustom,
  parseCustomStats,
  toSpecs,
  simulate,
};
