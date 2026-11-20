// Senjata battle: stat dari quality, pasif, dan ability aktif.
//
// Angka berasal dari `src/data/owoBattle.json`. Perhatikan `manaRange`:
// `manaCost = stats[last]`, jadi quality 0 memakai nilai pertama dan quality 100
// nilai kedua — untuk semua senjata OwO biaya WP TURUN saat quality naik.
const data = require('../data/owoBattle');
const { createBuff } = require('./battleBuffs');
const { createPassive, rollPassives } = require('./battlePassives');

function statAt(range, quality) {
  const q = Math.min(100, Math.max(0, Number(quality) || 0));
  const [min, max] = range;
  return Math.round((min + (max - min) * (q / 100)) * 100) / 100;
}

function weaponStats(def, quality) {
  return def.qualityList.map(range => {
    const q = Array.isArray(quality) ? quality[def.qualityList.indexOf(range)] : quality;
    return statAt(range, q);
  });
}

function buildWeapon(spec, rng, globalQuality) {
  const def = typeof spec === 'object' && spec.id ? data.weapons().find(w => w.id === spec.id) : data.findWeapon(spec);
  if (!def) return null;

  const explicit = typeof spec === 'object' ? spec : {};
  // Urutan: quality slot → flag global (-qp/-qe) → tier tertinggi.
  const quality = explicit.quality ?? globalQuality ?? data.DEFAULT_QUALITY;
  const stats = weaponStats(def, quality);
  // OwO menambahkan `manaRange` ke qualityList, lalu mengambil elemen terakhir
  // sebagai biaya WP. Jadi biaya punya quality sendiri, terpisah dari stat efek.
  const manaCost = def.manaRange
    ? statAt(def.manaRange, Array.isArray(quality) ? quality[quality.length - 1] : quality)
    : 0;
  const weapon = {
    id: def.id,
    name: def.name,
    def,
    stats,
    manaCost,
    // Buff memakai quality senjata (OwO: buff quality ada di tengah qualityList
    // senjata), jadi Poison dari dagger q100 selalu 50%, bukan diundi terpisah.
    quality,
    ability: def.ability,
    passives: [],
  };

  // Pasif memakai tier yang sama dengan senjatanya, supaya ikon rank di
  // `d team show` sesuai dengan stat yang benar-benar dipakai simulasi.
  const chosen = explicit.passives;
  weapon.passives = Array.isArray(chosen) && chosen.length
    ? chosen.map(id => createPassive(id, quality, rng)).filter(Boolean)
    : rollPassives(def.passiveCount, rng, quality);

  // Stat bonus dari pasif + efek Rune of the Forgotten (persen dari stat dasar).
  weapon.alterStats = statsObj => {
    for (const passive of weapon.passives) passive.alterStats?.(statsObj);
    if (def.ability.kind === 'stat_boost_all') {
      const pct = weapon.stats[0] / 100;
      statsObj.hp[3] += statsObj.hp[1] * pct;
      statsObj.wp[3] += statsObj.wp[1] * pct;
      statsObj.att[1] += statsObj.att[0] * pct;
      statsObj.mag[1] += statsObj.mag[0] * pct;
      statsObj.pr[1] += statsObj.pr[0] * pct;
      statsObj.mr[1] += statsObj.mr[0] * pct;
    }
  };
  return weapon;
}

// Ability aktif. Mengembalikan true bila benar-benar dipakai; false berarti
// pemanggil harus jatuh ke serangan fisik (mis. tidak ada target valid).
const ABILITIES = {
  damage_all(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    for (const target of e.aliveOf(actor.foes)) e.inflictDamage(ctx, actor, target, raw, ab.type || e.PHYSICAL);
    return true;
  },

  damage_one(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const target = e.chooseTarget(actor, actor.team, actor.foes, ctx.rng);
    if (!target) return false;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    e.inflictDamage(ctx, actor, target, raw, ab.type || e.PHYSICAL);
    return true;
  },

  damage_one_buff(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const buffId = weapon.def.buffList[0];
    const target = e.chooseTarget(actor, actor.team, actor.foes, ctx.rng, {
      excludeBuffId: ab.skipIfBuffed ? buffId : undefined,
    });
    if (!target) return false;
    e.useMana(actor, weapon.manaCost);
    const already = target.buffs.some(b => b.id === buffId);
    const pct = weapon.stats[0] + (already && ab.bonusIfBuffed ? weapon.stats[ab.bonusIfBuffed] : 0);
    const raw = e.getDamage(actor.stats[ab.stat], pct / 100, ctx.rng);
    e.inflictDamage(ctx, actor, target, raw, ab.type || e.PHYSICAL);
    // Glacial Axe melewati buff kalau target sudah terkena Freeze.
    if (!(ab.skipIfBuffed && already)) applyBuff(ctx, buffId, actor, target, ab.duration, weapon.quality);
    return true;
  },

  damage_all_heal_team(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    let dealt = 0;
    for (const target of e.aliveOf(actor.foes)) dealt += e.inflictDamage(ctx, actor, target, raw, e.MAGICAL);
    const allies = e.aliveOf(actor.team);
    for (const unit of allies) e.heal(ctx, unit, dealt / Math.max(1, allies.length), actor);
    return true;
  },

  damage_one_steal_wp(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const target = e.chooseTarget(actor, actor.team, actor.foes, ctx.rng);
    if (!target) return false;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    const dealt = e.inflictDamage(ctx, actor, target, raw, e.MAGICAL);
    const stolen = Math.min((dealt * weapon.stats[1]) / 100, target.stats.wp[0]);
    target.stats.wp[0] -= stolen;
    const receiver = e.lowestWp(actor.team, actor) || actor;
    e.replenish(ctx, receiver, stolen, actor);
    return true;
  },

  heal_lowest(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const target = e.lowestHp(actor.team);
    if (!target) return false;
    if (target.stats.hp[0] + 1 >= e.maxHp(target) * 1.5) return false;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    e.heal(ctx, target, raw, actor, { overheal: true });
    return true;
  },

  heal_all_buff(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    for (const unit of e.aliveOf(actor.team)) {
      e.heal(ctx, unit, raw, actor);
      applyBuff(ctx, weapon.def.buffList[0], actor, unit, ab.duration, weapon.quality);
    }
    return true;
  },

  replenish_ally(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const target = e.lowestWp(actor.team, actor);
    if (!target) return false;
    if (target.stats.wp[0] + 1 >= e.maxWp(target) * 1.5) return false;
    e.useMana(actor, weapon.manaCost);
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    e.replenish(ctx, target, raw, actor);
    return true;
  },

  revive(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const dead = actor.team.find(u => u.stats.hp[0] <= 0);
    if (!dead) return false;
    e.useMana(actor, weapon.manaCost);
    dead.stats.hp[0] = 0;
    const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
    e.heal(ctx, dead, raw, actor);
    return true;
  },

  taunt(ctx, weapon, actor) {
    if (actor.buffs.some(b => b.id === 1)) return false;
    const e = require('./battleEngine');
    e.useMana(actor, weapon.manaCost);
    applyBuff(ctx, 1, actor, actor, weapon.ability.duration, weapon.quality);
    return true;
  },

  attack_up_chain(ctx, weapon, actor) {
    // Banner menaikkan tingkat Attack Up rekan yang belum punya tier tertinggi.
    const e = require('./battleEngine');
    const tiers = weapon.def.buffList;
    const target = actor.team.find(u => u.stats.hp[0] > 0 && u.buffs.filter(b => tiers.includes(b.id)).length < tiers.length);
    if (!target) return false;
    e.useMana(actor, weapon.manaCost);
    const owned = target.buffs.filter(b => tiers.includes(b.id)).length;
    applyBuff(ctx, tiers[owned], actor, target, 2, weapon.quality);
    return true;
  },

  celebration(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const target = e.lowestHp(actor.team, 10);
    if (!target) return false;
    if (target.stats.hp[0] + 1 >= e.maxHp(target)) return false;
    e.useMana(actor, weapon.manaCost);
    applyBuff(ctx, 10, actor, target, weapon.ability.duration, weapon.quality);
    return true;
  },

  purify(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const ab = weapon.ability;
    const buffed = e.chooseTarget(actor, actor.team, actor.foes, ctx.rng, { hasBuff: true });
    const debuffed = e.pickRandom(e.aliveOf(actor.team).filter(u => u.buffs.some(b => b.debuff)), ctx.rng);
    if (!buffed && !debuffed) return false;
    e.useMana(actor, weapon.manaCost);
    if (buffed) {
      const idx = buffed.buffs.findIndex(b => !b.debuff);
      if (idx >= 0) buffed.buffs.splice(idx, 1);
      const raw = e.getDamage(actor.stats[ab.stat], weapon.stats[0] / 100, ctx.rng);
      e.inflictDamage(ctx, actor, buffed, raw, e.MAGICAL);
    }
    if (debuffed) {
      const idx = debuffed.buffs.findIndex(b => b.debuff);
      if (idx >= 0) debuffed.buffs.splice(idx, 1);
      const raw = e.getDamage(actor.stats[ab.healStat], weapon.stats[1] / 100, ctx.rng);
      e.heal(ctx, debuffed, raw, actor);
    }
    return true;
  },

  luck_hits(ctx, weapon, actor) {
    const e = require('./battleEngine');
    const target = e.chooseTarget(actor, actor.team, actor.foes, ctx.rng);
    if (!target) return false;
    e.useMana(actor, weapon.manaCost);
    for (let i = 0; i < weapon.ability.hits; i++) {
      const physical = ctx.rng.next() < 0.5;
      const stat = physical ? 'att' : 'mag';
      const raw = e.getDamage(actor.stats[stat], weapon.stats[i] / 100, ctx.rng);
      e.inflictDamage(ctx, actor, target, raw, physical ? e.PHYSICAL : e.MAGICAL);
    }
    return true;
  },

  stat_boost_all(ctx, weapon, actor) {
    // Rune of the Forgotten: serangan fisik jadi TRUE damage campuran STR+MAG.
    const e = require('./battleEngine');
    const target = e.chooseTarget(actor, actor.team, actor.foes, ctx.rng);
    if (!target) return false;
    const [pAtt, pMag] = weapon.ability.mixed;
    const raw = e.getMixedDamage(actor.stats.att, pAtt, actor.stats.mag, pMag, ctx.rng);
    e.inflictDamage(ctx, actor, target, raw, e.TRUE);
    return true;
  },
};

function applyBuff(ctx, buffId, from, target, duration, quality) {
  const e = require('./battleEngine');
  if (!e.isAlive(target)) return;
  const buff = createBuff(buffId, { quality, from, duration, rng: ctx.rng });
  if (buff) e.bindBuff(ctx, target, buff);
}

function weaponAbility(ctx, weapon, actor) {
  const ab = weapon.ability;
  if (!ab || ab.kind === 'none') return false;
  const handler = ABILITIES[ab.kind];
  if (!handler) return false;
  return handler(ctx, weapon, actor) === true;
}

module.exports = { buildWeapon, weaponAbility, weaponStats, statAt, ABILITIES, applyBuff };
