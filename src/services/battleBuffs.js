// Buff & debuff battle. Port dari OwO `battle/buffs/`.
//
// Durasi dalam turn dan dihitung mesin (battleEngine.runTurn), kecuali Freeze
// yang mengelola durasinya sendiri lewat canAttack.
const data = require('../data/owoBattle');

// battleEngine mengimpor modul ini, jadi import top-level akan melingkar.
// Aksesor malas ini membuat siklusnya aman dan tetap satu pintu.
let engineRef = null;
function engine() {
  if (!engineRef) engineRef = require('./battleEngine');
  return engineRef;
}

function statAt(range, quality) {
  const q = Math.min(100, Math.max(0, Number(quality) || 0));
  const [min, max] = range;
  return Math.round((min + (max - min) * (q / 100)) * 100) / 100;
}

function statsFor(def, quality) {
  return def.qualityList.map(range => statAt(range, quality));
}

// Damage MAG/TRUE dari stat milik `from`, dipakai Poison/Flame/Stinky.
function buffDamage(ctx, from, target, stat, multiplier, type) {
  const e = engine();
  const raw = e.getDamage(from.stats[stat], multiplier, ctx.rng);
  return e.inflictDamage(ctx, from, target, raw, type);
}

function damageReduction(stats) {
  return {
    attacked(ctx, unit, attacker, bucket) {
      bucket.bonus -= ((bucket.amount + bucket.bonus) * stats[0]) / 100;
    },
  };
}

function attackUp(def, stats, from) {
  return {
    id: def.id, name: def.name, debuff: false, stats, duration: 2, from,
    attack(ctx, unit, target, bucket) {
      bucket.bonus += (bucket.amount * stats[0]) / 100;
    },
  };
}

const FACTORIES = {
  1: (def, stats, from) => ({ id: 1, name: def.name, debuff: false, stats, duration: 2, from, ...damageReduction(stats) }),

  2: (def, stats, from) => ({
    id: 2, name: def.name, debuff: true, stats, duration: 3, from,
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      buffDamage(ctx, from, unit, 'mag', stats[0] / 100, 't');
    },
  }),

  3: (def, stats, from) => ({
    id: 3, name: def.name, debuff: true, stats, duration: 3, from,
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      buffDamage(ctx, from, unit, 'mag', stats[0] / 100, 'm');
    },
  }),

  4: (def, stats, from) => ({ id: 4, name: def.name, debuff: false, stats, duration: 2, from, ...damageReduction(stats) }),

  5: (def, stats, from) => ({
    id: 5, name: def.name, debuff: true, stats, duration: 2, from,
    justCreated: true,
    // Freeze baru berlaku setelah turn pembuatannya selesai, dan durasinya
    // diturunkan di canAttack (bukan postTurn) — persis seperti OwO.
    managesOwnDuration: true,
    postTurn() {
      if (this.justCreated) this.justCreated = false;
    },
    canAttack() {
      if (this.justCreated) return true;
      this.duration -= 1;
      if (this.duration <= 0) this.expired = true;
      return false;
    },
  }),

  6: (def, stats, from) => attackUp(def, stats, from),
  7: (def, stats, from) => attackUp(def, stats, from),
  8: (def, stats, from) => attackUp(def, stats, from),

  9: (def, stats, from) => ({
    id: 9, name: def.name, debuff: true, stats, duration: 2, from,
    healed(ctx, unit, healer, bucket) {
      bucket.bonus -= (bucket.amount * stats[0]) / 100;
    },
  }),

  10: (def, stats, from) => ({
    id: 10, name: def.name, debuff: false, stats, duration: 3, from,
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      const e = engine();
      // Heal dari PR, isi WP dari MR; keduanya memakai roll damage OwO.
      const healAmount = e.getDamage(from.stats.pr, stats[0] / 100, ctx.rng);
      const wpAmount = e.getDamage(from.stats.mr, stats[1] / 100, ctx.rng);
      if (healAmount > 0) e.heal(ctx, unit, healAmount, from);
      if (wpAmount > 0) e.replenish(ctx, unit, wpAmount, from);
    },
  }),

  11: (def, stats, from) => ({
    id: 11, name: def.name, debuff: true, stats, duration: 3, from,
    healed(ctx, unit, healer, bucket) {
      const e = engine();
      const stolen = (bucket.amount * stats[0]) / 100;
      bucket.bonus -= stolen;
      if (stolen > 0) e.heal(ctx, from, stolen, from);
    },
    replenished(ctx, unit, healer, bucket) {
      const e = engine();
      const stolen = (bucket.amount * stats[1]) / 100;
      bucket.bonus -= stolen;
      if (stolen > 0) e.replenish(ctx, from, stolen, from);
    },
  }),

  12: (def, stats, from) => ({
    id: 12, name: def.name, debuff: true, stats, duration: 2, from,
    // Mesin memanggil ini sebelum buff lain menempel: blokir + damage MAG.
    preBind(ctx, unit) {
      buffDamage(ctx, from, unit, 'mag', stats[0] / 100, 'm');
      return { dontBind: true };
    },
  }),
};

// `quality` 0-100; tanpa itu di-roll dari RNG agar simulasi tetap deterministik.
function createBuff(id, { quality, from, duration, rng } = {}) {
  const def = data.buffById(id);
  const factory = FACTORIES[Number(id)];
  if (!def || !factory) return null;
  const q = quality == null ? Math.floor((rng ? rng.next() : Math.random()) * 101) : quality;
  const buff = factory(def, statsFor(def, q), from);
  buff.quality = q;
  if (duration != null) buff.duration = duration;
  return buff;
}

module.exports = { createBuff, statAt, statsFor, FACTORIES };
