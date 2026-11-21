// Simulasi global: tim aktif melawan SELURUH tim tersimpan milik user lain.
//
// Berbeda dari `dsim` yang mengadu dua tim, di sini pertarungan dijalankan
// berurutan sehingga bisa dihitung streak (kemenangan berturut-turut). Lawan
// dikelompokkan menurut level tertinggi di timnya, karena tim berlevel rendah
// dan tinggi punya arti berbeda saat membaca hasil.
const { runBattle } = require('./battleEngine');
const { createRng, randomSeed } = require('./battleRng');

// Batas level yang memisahkan kedua kelompok pada laporan.
const LEVEL_THRESHOLD = 35;

// Node hanya punya satu thread: tanpa jeda, loop ribuan pertarungan menahan
// seluruh bot. Setiap sekian pertarungan giliran diserahkan ke event loop.
const YIELD_EVERY = 2000;

function maxLevelOf(specs) {
  return specs.reduce((max, spec) => Math.max(max, Number(spec.level) || 0), 0);
}

function emptyTally() {
  return { player: 0, enemy: 0, tie: 0 };
}

function rate(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function emptyBucket(key, label) {
  return { key, label, teams: 0, battles: 0, levelSum: 0, tally: emptyTally() };
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

// `opponents` = [{ label, teamId, slotId, specs }]. Setiap lawan dijalankan
// `runs` kali; urutannya tetap supaya streak bisa direproduksi dari seed.
async function runGlobalSim(playerSpecs, opponents, {
  runs = 100, seed = randomSeed(), yieldEvery = YIELD_EVERY, onProgress,
} = {}) {
  const runCount = Math.max(1, Math.floor(Number(runs) || 1));
  const total = runCount * opponents.length;
  const tally = emptyTally();
  const buckets = {
    low: emptyBucket('low', `Max level < ${LEVEL_THRESHOLD}`),
    high: emptyBucket('high', `Max level ≥ ${LEVEL_THRESHOLD}`),
  };
  const losses = [];
  const base = createRng(seed);
  const startedAt = Date.now();

  let streak = 0;
  let maxStreak = 0;
  let streakSum = 0;
  let streakCount = 0;
  let done = 0;

  for (const opponent of opponents) {
    const level = maxLevelOf(opponent.specs);
    const bucket = level < LEVEL_THRESHOLD ? buckets.low : buckets.high;
    const own = emptyTally();
    bucket.teams += 1;
    bucket.levelSum += level;

    for (let i = 0; i < runCount; i++) {
      const result = runBattle(playerSpecs, opponent.specs, { rng: base.fork() });
      tally[result.winner] += 1;
      bucket.tally[result.winner] += 1;
      own[result.winner] += 1;
      bucket.battles += 1;
      done += 1;

      if (result.winner === 'player') {
        streak += 1;
        if (streak > maxStreak) maxStreak = streak;
      } else {
        // Seri juga memutus streak: bukan kemenangan, jadi tidak boleh
        // menambah panjang rangkaian.
        if (streak > 0) { streakSum += streak; streakCount += 1; }
        streak = 0;
      }

      if (yieldEvery > 0 && done % yieldEvery === 0) {
        await yieldToEventLoop();
        if (onProgress) {
          await onProgress({
            done,
            total,
            tally: { ...tally },
            winRate: rate(tally.player, done),
            lossRate: rate(tally.enemy, done),
            tieRate: rate(tally.tie, done),
            avgTurns: 0,
          });
        }
      }
    }

    if (own.enemy > 0) {
      losses.push({ ...opponent, level, battles: runCount, tally: own });
    }
  }

  // Streak yang masih berjalan saat simulasi selesai tetap dihitung: rangkaian
  // itu sudah berakhir karena datanya habis.
  if (streak > 0) { streakSum += streak; streakCount += 1; }

  const summarize = bucket => ({
    ...bucket,
    avgLevel: bucket.teams ? Math.round((bucket.levelSum / bucket.teams) * 10) / 10 : 0,
    winRate: rate(bucket.tally.player, bucket.battles),
    lossRate: rate(bucket.tally.enemy, bucket.battles),
    tieRate: rate(bucket.tally.tie, bucket.battles),
    avgWins: bucket.teams ? Math.round((bucket.tally.player / bucket.teams) * 10) / 10 : 0,
    avgLosses: bucket.teams ? Math.round((bucket.tally.enemy / bucket.teams) * 10) / 10 : 0,
  });

  losses.sort((a, b) => b.tally.enemy - a.tally.enemy || a.label.localeCompare(b.label));

  return {
    seed,
    runs: runCount,
    opponents: opponents.length,
    battles: total,
    durationMs: Date.now() - startedAt,
    tally,
    winRate: rate(tally.player, total),
    lossRate: rate(tally.enemy, total),
    tieRate: rate(tally.tie, total),
    streak: {
      avg: streakCount ? Math.round((streakSum / streakCount) * 10) / 10 : 0,
      max: maxStreak,
      count: streakCount,
    },
    // Rata-rata kalah per tim lawan.
    avgLosses: opponents.length ? Math.round((tally.enemy / opponents.length) * 10) / 10 : 0,
    buckets: { low: summarize(buckets.low), high: summarize(buckets.high) },
    losses,
  };
}

module.exports = { LEVEL_THRESHOLD, maxLevelOf, runGlobalSim, rate };
