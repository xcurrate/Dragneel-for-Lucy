// Buff & debuff battle. Port dari OwO `battle/buffs/`.
//
// Durasi dalam turn dan dihitung mesin (battleEngine.runTurn), kecuali Freeze
// yang mengelola durasinya sendiri lewat canAttack.
const data = require('../data/owoBattle');

// Frostbite berubah menjadi Freeze setiap 100 stack; Exposed menambah 1% damage
// per stack. Keduanya angka tetap dari deskripsi sumber, bukan quality.
const FROSTBITE_PER_FREEZE = 100;
const EXPOSED_PER_STACK = 0.01;

// battleEngine mengimpor modul ini, jadi import top-level akan melingkar.
// Aksesor malas ini membuat siklusnya aman dan tetap satu pintu.
let engineRef = null;
function engine() {
  if (!engineRef) engineRef = require('./battleEngine');
  return engineRef;
}

function statAt(range, quality) {
  const q = Math.min(100, Math.max(0, Number(quality) || 0));
  const [min, max = min] = range; // rentang satu nilai = angka tetap
  return Math.round((min + (max - min) * (q / 100)) * 100) / 100;
}

function statsFor(def, quality) {
  // OwO menyimpan satu quality per entri `qualityList`; skalar berarti semua
  // entri memakai nilai yang sama.
  return def.qualityList.map((range, i) => statAt(range, Array.isArray(quality) ? quality[i] : quality));
}

// Aturan penumpukan buff saat efek yang sama menempel lagi. OwO tidak seragam,
// jadi tiap buff menentukan sendiri lewat `bind()` masing-masing:
//   merge       — durasi instance lama ditambah, stat lama dipertahankan
//   replace     — instance lama dibuang (Flame meledak dulu), lalu yang baru masuk
//   independent — instance baru selalu ditambahkan
// `sameFrom` membatasi merge pada pemberi yang sama (hanya Poison).
const STACK = {
  1: 'independent', // Taunt: tidak punya bind()
  2: { merge: 'sameFrom' }, // Poison: id + from
  3: 'replace', // Flame: buang yang lama, maksimal satu
  4: 'merge', // Defense Up
  5: 'independent', // Freeze
  6: 'merge', // Attack Up
  7: 'merge', // Attack Up+
  8: 'merge', // Attack Up++
  9: 'merge', // Mortality
  10: 'independent', // Celebration
  11: 'independent', // Leech
  12: 'independent', // Stinky
  13: 'independent', // Sacred Ward: tiap stack instance terpisah
  14: 'merge', // Wither: durasi digabung, persennya tidak dijumlah
  15: 'merge', // Midnight Curse: idem, satu kutukan per unit
  16: 'merge', // Anniversary Blessing: pasang ulang memperpanjang durasi
  17: 'independent', // Frostbite: tiap stack instance terpisah, dihitung 100 stack
  18: 'independent', // Pest: tiap stack menyerang sendiri lalu hilang
  19: 'independent', // Exposed: tiap stack menambah 1% damage berikutnya
};

// `merge` berarti durasi digabung; `sameFrom` mempersempitnya ke pemberi sama.
function stackOf(buff) {
  const rule = STACK[buff.id] || 'merge';
  if (rule === 'independent' || rule === 'replace') return { kind: rule };
  if (typeof rule === 'object') return { kind: 'merge', sameFrom: rule.merge === 'sameFrom' };
  return { kind: 'merge', sameFrom: false };
}

// Damage MAG/TRUE dari stat milik `from`, dipakai Poison/Flame/Stinky.
function buffDamage(ctx, from, target, stat, multiplier, type) {
  const e = engine();
  const raw = e.getDamage(from.stats[stat], multiplier, ctx.rng);
  return e.inflictDamage(ctx, from, target, raw, type);
}

function damageReduction(stats) {
  return {
    effectiveness: 1,
    attacked(ctx, unit, attacker, bucket) {
      bucket.bonus -= (bucket.amount + bucket.bonus) * eff(this, stats[0]);
    },
  };
}

// Efektivitas mengalikan semua persen milik buff. Dipakai Wither (melemah saat
// menyebar) dan Staff of Corruption (menurunkan buff musuh). Dibaca lewat
// `this.effectiveness`, bukan dari `stats`, supaya angka aslinya tetap utuh.
function eff(self, pct) {
  return (pct * (self.effectiveness ?? 1)) / 100;
}

function attackUp(def, stats, from) {
  return {
    id: def.id, name: def.name, debuff: false, stats, duration: 2, from,
    effectiveness: 1,
    attack(ctx, unit, target, bucket) {
      bucket.bonus += bucket.amount * eff(this, stats[0]);
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
    // Flame baru meledakkan instance lama lalu menempel; persen ledakan dan
    // pemberinya diambil dari buff baru (`replacement`), sama seperti OwO yang
    // menghitung `this.stats[1]` di dalam bind() milik instance baru.
    explode(ctx, unit, replacement) {
      if (unit.stats.hp[0] <= 0) return;
      buffDamage(ctx, replacement.from, unit, 'mag', replacement.stats[1] / 100, 'm');
    },
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

  13: (def, stats, from) => ({
    id: 13, name: def.name, debuff: false, stats, duration: 2, from,
  }),

  // Wither: mengurangi heal HP dan replenish WP, lalu tiap giliran berpeluang
  // menyebar ke musuh lain yang belum terkena. Salinan hasil sebar memakai
  // `effectiveness` separuh dari sumbernya, sehingga rantai makin melemah dan
  // berhenti sendiri ketika semua musuh sudah terkena.
  14: (def, stats, from) => ({
    id: 14, name: def.name, debuff: true, stats, duration: 2, from,
    effectiveness: 1,
    healed(ctx, unit, healer, bucket) {
      bucket.bonus -= bucket.amount * eff(this, stats[0]);
    },
    replenished(ctx, unit, healer, bucket) {
      bucket.bonus -= bucket.amount * eff(this, stats[1]);
    },
    postTurn(ctx, unit, team, foes) {
      if (unit.stats.hp[0] <= 0) return;
      const e = engine();
      if (ctx.rng.next() >= eff(this, stats[2])) return;
      const targets = e.aliveOf(foes).filter(u => !u.buffs.some(b => b.id === 14));
      const target = e.pickRandom(targets, ctx.rng);
      if (!target) return;
      const spread = createBuff(14, { quality: this.quality, from, rng: ctx.rng });
      if (!spread) return;
      spread.effectiveness = this.effectiveness * (def.spreadWeakening ?? 0.5);
      e.bindBuff(ctx, target, spread);
    },
  }),

  // Midnight Curse: damage MAG di akhir turn, damage keluar -20%, heal -40%,
  // dan kehilangan 20% Max WP tiap turn. Tiga persen terakhir tidak punya slot
  // quality di sumber, jadi dibaca dari data dan tidak diskalakan.
  15: (def, stats, from) => ({
    id: 15, name: def.name, debuff: true, stats, duration: 2, from,
    attack(ctx, unit, target, bucket) {
      bucket.bonus -= (bucket.amount * (def.damageReduction ?? 20)) / 100;
    },
    healed(ctx, unit, healer, bucket) {
      bucket.bonus -= (bucket.amount * (def.healReduction ?? 40)) / 100;
    },
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      const e = engine();
      const amount = e.getDamage(from.stats.mag, stats[0] / 100, ctx.rng);
      if (amount > 0) e.inflictDamage(ctx, from, unit, amount, 'm');
      // Kehilangan WP dihitung dari Max WP, bukan dari WP yang tersisa.
      const drain = (e.maxWp(unit) * (def.wpDrain ?? 20)) / 100;
      if (drain > 0) unit.stats.wp[0] = Math.max(0, unit.stats.wp[0] - drain);
    },
  }),

  // Anniversary Blessing: naikkan ATT/MAG (stats[0]), PR/MR (stats[1]), dan
  // heal persen Max HP tiap akhir turn (stats[2]). Slot-nya tiga, sesuai
  // qualityList sumber, sehingga `buffQuality` memotong tiga angka.
  16: (def, stats, from) => ({
    id: 16, name: def.name, debuff: false, stats, duration: 2, from,
    effectiveness: 1,
    attack(ctx, unit, target, bucket) {
      bucket.bonus += bucket.amount * eff(this, stats[0]);
    },
    attacked(ctx, unit, attacker, bucket) {
      bucket.bonus -= (bucket.amount + bucket.bonus) * eff(this, stats[1]);
    },
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      const e = engine();
      e.heal(ctx, unit, (e.maxHp(unit) * eff(this, stats[2])), from);
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

  // Frostbite: tidak punya efek sendiri, hanya penghitung. Setiap 100 stack
  // berubah menjadi 1 stack Freeze lalu semua stack Frostbite dihapus. Stack
  // dihitung dari panjang array karena setiap instance berdiri sendiri.
  // Durasi `null` = tidak pernah kedaluwarsa; Freeze yang mengakhiri.
  17: (def, stats, from) => ({
    id: 17, name: def.name, debuff: true, stats, duration: null, from,
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      const stacks = unit.buffs.filter(b => b.id === 17).length;
      if (stacks < FROSTBITE_PER_FREEZE) return;
      const e = engine();
      unit.buffs = unit.buffs.filter(b => b.id !== 17);
      // Sumber: "Next turn, prevent the target from attacking. Remove a stack
      // after triggering." Satu turn terblokir = durasi 1; Freeze sendiri
      // menurunkan durasinya di canAttack, bukan di tick mesin.
      const freeze = createBuff(5, { quality: [], from, duration: 1, rng: ctx.rng });
      if (freeze) e.bindBuff(ctx, unit, freeze);
    },
  }),

  // Pest: tiap stack meledak sendiri di akhir turn memakai MAG pemberinya,
  // lalu hilang. Karena damage dihitung per instance, buff di-splice dulu
  // supaya tidak ikut terhitung lagi saat damage memicu hook lain.
  18: (def, stats, from) => ({
    id: 18, name: def.name, debuff: true, stats, duration: null, from,
    postTurn(ctx, unit) {
      if (unit.stats.hp[0] <= 0) return;
      const idx = unit.buffs.indexOf(this);
      if (idx === -1) return;
      unit.buffs.splice(idx, 1);
      buffDamage(ctx, from, unit, 'mag', stats[0] / 100, 'm');
    },
  }),

  // Exposed: menambah damage SATU hit berikutnya sebesar 1% per stack, lalu
  // semua stack dihapus. Stack dibaca dan dibuang di hook yang sama supaya
  // hit berikutnya tidak ikut terkena.
  19: (def, stats, from) => ({
    id: 19, name: def.name, debuff: true, stats, duration: null, from,
    attacked(ctx, unit, attacker, bucket) {
      if (unit.stats.hp[0] <= 0) return;
      const stacks = unit.buffs.filter(b => b.id === 19).length;
      if (!stacks) return;
      bucket.bonus += (bucket.amount + bucket.bonus) * (stacks * EXPOSED_PER_STACK);
      unit.buffs = unit.buffs.filter(b => b.id !== 19);
    },
  }),
};

// `quality` 0-100, atau array sepanjang `qualityList`. Tanpa nilai, di-roll dari
// RNG agar simulasi tetap deterministik.
function createBuff(id, { quality, from, duration, rng } = {}) {
  const def = data.buffById(id);
  const factory = FACTORIES[Number(id)];
  if (!def || !factory) return null;
  const roll = () => Math.floor((rng ? rng.next() : Math.random()) * 101);
  const q = quality == null ? roll() : quality;
  const buff = factory(def, statsFor(def, q), from);
  buff.quality = q;
  if (duration != null) buff.duration = duration;
  return buff;
}

module.exports = { createBuff, statAt, statsFor, stackOf, FACTORIES };
