// Pencatat jalannya satu pertarungan untuk tautan berbagi.
//
// Pencatatan bersifat opt-in: `runBattle` hanya membuat recorder bila
// `options.log` diisi. Simulasi massal (ribuan run) tidak membayar biaya
// apa pun karena `ctx.log` tetap null dan setiap pemanggilan memakai `?.`.
//
// Bentuk data sengaja datar dan kecil supaya mudah disimpan sebagai JSON dan
// dirender di halaman web: unit dirujuk lewat indeks `ref`, bukan objek.

const VERSION = 2;

// Batas kejadian per battle. Battle normal selesai < 25 turn dengan < 40
// kejadian per turn, jadi batas ini hanya jaring pengaman agar satu log tidak
// membengkak tak terbatas pada pertarungan yang mentok di batas turn.
const MAX_EVENTS = 4000;

// Batas aksi (snapshot state). Satu turn berisi paling banyak 6 aksi, dan
// MAX_TURNS 24, jadi 400 jauh di atas kebutuhan normal.
const MAX_ACTIONS = 400;

function createRecorder({ seed, playerSpecs, enemySpecs } = {}) {
  const units = [];
  const live = [];
  const refByPid = new Map();
  const events = [];
  const actions = [];
  let turn = 0;
  let dropped = 0;
  let droppedActions = 0;
  // Posisi event saat aksi terakhir diambil; dipakai `action()`/`flush()`.
  let eventMark = 0;

  function register(unit, side) {
    if (refByPid.has(unit.pid)) return refByPid.get(unit.pid);
    const ref = units.length;
    refByPid.set(unit.pid, ref);
    live.push(unit);
    const animal = unit.animal || null;
    units.push({
      ref,
      side,
      slot: unit.slot,
      name: unit.nickname || (animal ? animal.name : `slot${unit.slot}`),
      level: unit.level,
      weapon: unit.weapon ? unit.weapon.name : null,
      passives: unit.weapon ? unit.weapon.passives.map(p => p.name) : [],
      maxHp: Math.round(unit.stats.hp[1] + unit.stats.hp[3]),
      maxWp: Math.round(unit.stats.wp[1] + unit.stats.wp[3]),
      // Gambar dipakai halaman untuk menampilkan hewan; null berarti pakai
      // inisial nama, jadi log lama/tanpa dex tetap bisa dirender.
      image: animal ? animal.imageUrl || null : null,
      emoji: animal ? animal.emojiName || null : null,
    });
    return ref;
  }

  function push(event) {
    if (events.length >= MAX_EVENTS) { dropped++; return; }
    events.push(event);
  }

  const refOf = unit => (unit ? refByPid.get(unit.pid) : undefined);
  const hpOf = unit => (unit ? Math.max(0, Math.round(unit.stats.hp[0])) : 0);
  const wpOf = unit => (unit ? Math.max(0, Math.round(unit.stats.wp[0])) : 0);

  // Snapshot seluruh unit pada satu titik waktu. Inilah yang membuat halaman
  // bisa memutar ulang battle: setiap aksi menyimpan HP, WP, dan buff semua
  // unit, sehingga seekbar cukup melompat ke indeks aksi mana pun tanpa
  // menjalankan ulang simulasi.
  //
  // Buff diagregasi per id: Frostbite bisa menumpuk 20 stack sekaligus, dan
  // tanpa agregasi satu snapshot saja sudah membengkak puluhan entri identik.
  function snapshot() {
    return units.map(u => {
      const unit = live[u.ref];
      const grouped = new Map();
      for (const b of unit.buffs) {
        const key = `${b.id}|${b.name}|${b.debuff ? 1 : 0}|${b.duration ?? ''}`;
        const hit = grouped.get(key);
        if (hit) hit.c += 1;
        else grouped.set(key, { id: b.id, n: b.name, d: Boolean(b.debuff), dur: b.duration ?? null, c: 1 });
      }
      return {
        hp: hpOf(unit),
        wp: wpOf(unit),
        b: [...grouped.values()],
      };
    });
  }

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
    // Satu entri per giliran aktor, berisi snapshot state sesudahnya. `mark`
    // menandai posisi event pada saat aksi dimulai, sehingga halaman tahu
    // baris log mana yang termasuk dalam aksi ini.
    action(actor) {
      const a = refOf(actor);
      if (a == null) return;
      if (actions.length >= MAX_ACTIONS) { droppedActions++; return; }
      actions.push({ t: turn, a, from: eventMark, to: events.length, s: snapshot() });
      eventMark = events.length;
    },
    // Snapshot keadaan akhir tanpa aksi (mis. unit mati karena efek turn).
    flush() {
      if (actions.length >= MAX_ACTIONS) { droppedActions++; return; }
      if (eventMark === events.length) return;
      actions.push({ t: turn, a: null, from: eventMark, to: events.length, s: snapshot() });
      eventMark = events.length;
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
        actions,
        dropped,
        droppedActions,
      };
    },
  };
}

module.exports = { createRecorder, VERSION, MAX_EVENTS, MAX_ACTIONS };
