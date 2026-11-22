// Pencatat jalannya satu pertarungan untuk tautan berbagi.
//
// Pencatatan bersifat opt-in: `runBattle` hanya membuat recorder bila
// `options.log` diisi. Simulasi massal (ribuan run) tidak membayar biaya
// apa pun karena `ctx.log` tetap null dan setiap pemanggilan memakai `?.`.
//
// Bentuk data sengaja datar dan kecil supaya mudah disimpan sebagai JSON dan
// dirender di halaman web: unit dirujuk lewat indeks `ref`, bukan objek.

const VERSION = 1;

// Batas kejadian per battle. Battle normal selesai < 25 turn dengan < 40
// kejadian per turn, jadi batas ini hanya jaring pengaman agar satu log tidak
// membengkak tak terbatas pada pertarungan yang mentok di batas turn.
const MAX_EVENTS = 4000;

function createRecorder({ seed, playerSpecs, enemySpecs } = {}) {
  const units = [];
  const live = [];
  const refByPid = new Map();
  const events = [];
  let turn = 0;
  let dropped = 0;

  function register(unit, side) {
    if (refByPid.has(unit.pid)) return refByPid.get(unit.pid);
    const ref = units.length;
    refByPid.set(unit.pid, ref);
    live.push(unit);
    units.push({
      ref,
      side,
      slot: unit.slot,
      name: unit.nickname || `slot${unit.slot}`,
      level: unit.level,
      weapon: unit.weapon ? unit.weapon.name : null,
      passives: unit.weapon ? unit.weapon.passives.map(p => p.name) : [],
      maxHp: Math.round(unit.stats.hp[1] + unit.stats.hp[3]),
    });
    return ref;
  }

  function push(event) {
    if (events.length >= MAX_EVENTS) { dropped++; return; }
    events.push(event);
  }

  const refOf = unit => (unit ? refByPid.get(unit.pid) : undefined);
  const hpOf = unit => (unit ? Math.max(0, Math.round(unit.stats.hp[0])) : 0);

  return {
    version: VERSION,
    seed,
    playerSpecs,
    enemySpecs,
    register,
    refOf,
    startTurn(number) { turn = number; },
    turn: () => turn,
    damage(attacker, target, amount, type) {
      const a = refOf(attacker);
      const t = refOf(target);
      if (a == null || t == null || amount <= 0) return;
      push({ k: 'dmg', t: turn, a, r: t, v: Math.round(amount), ty: type, hp: hpOf(target) });
    },
    heal(target, amount, from) {
      const t = refOf(target);
      if (t == null || amount <= 0) return;
      push({ k: 'heal', t: turn, r: t, s: refOf(from) ?? null, v: Math.round(amount), hp: hpOf(target) });
    },
    wp(target, amount, from) {
      const t = refOf(target);
      if (t == null || amount <= 0) return;
      push({ k: 'wp', t: turn, r: t, s: refOf(from) ?? null, v: Math.round(amount), wp: Math.round(target.stats.wp[0]) });
    },
    buff(target, buff, from) {
      const t = refOf(target);
      if (t == null || !buff) return;
      push({
        k: 'buff', t: turn, r: t, s: refOf(from ?? buff.from) ?? null,
        id: buff.id, n: buff.name, d: Boolean(buff.debuff), hp: hpOf(target),
      });
    },
    act(actor, kind, name) {
      const a = refOf(actor);
      if (a == null) return;
      push({ k: 'act', t: turn, a, kind, n: name || null });
    },
    death(unit) {
      const r = refOf(unit);
      if (r == null) return;
      push({ k: 'death', t: turn, r });
    },
    finish(result) {
      return {
        version: VERSION,
        seed: seed ?? null,
        winner: result.winner,
        turns: result.turns,
        timeout: Boolean(result.timeout),
        units: units.map(u => ({ ...u, hp: hpOf(live[u.ref]) })),
        events,
        dropped,
      };
    },
  };
}

module.exports = { createRecorder, VERSION, MAX_EVENTS };
