const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'src/data/owoBattle'));
const engine = require(path.join(ROOT, 'src/services/battleEngine'));
const sim = require(path.join(ROOT, 'src/services/battleSim'));
const rngModule = require(path.join(ROOT, 'src/services/battleRng'));
const { createPassive } = require(path.join(ROOT, 'src/services/battlePassives'));
const { createBuff } = require(path.join(ROOT, 'src/services/battleBuffs'));

// Stat dasar dipakai berulang; level 40 cukup untuk battle selesai < 24 turn.
const COEFFS_STRONG = { hp: 8, att: 6, pr: 2, wp: 3, mag: 5, mr: 1 };
const COEFFS_WEAK = { hp: 4, att: 2, pr: 3, wp: 1, mag: 1, mr: 2 };

describe('data battle OwO', () => {
  it('memuat hewan, senjata, dan buff dengan jumlah yang diharapkan', () => {
    assert.strictEqual(data.animals().length, 20);
    assert.strictEqual(data.weapons().length, 22);
    assert.strictEqual(data.buffs().length, 12);
  });

  it('mencari hewan lewat alias', () => {
    assert.strictEqual(data.findAnimal('snail').name, 'snail');
    assert.strictEqual(data.findAnimal('tiger2').name, 'tiger2');
    assert.strictEqual(data.findAnimal('tidak-ada'), null);
    assert.strictEqual(data.findWeapon('gs').name, 'Great Sword');
  });

  it('mengubah koefisien level menjadi stat final', () => {
    const level1 = data.baseStats(data.findAnimal('snail'), 1);
    const level100 = data.baseStats(data.findAnimal('snail'), 100);
    assert.ok(level100.hp > level1.hp, 'HP naik seiring level');
    assert.ok(level100.att > level1.att, 'ATT naik seiring level');
  });

  it('menolak senjata yang tidak ada', () => {
    assert.strictEqual(data.findWeapon('tidak-ada-senjata'), null);
  });
});

describe('RNG ber-seed', () => {
  it('menghasilkan urutan yang sama untuk seed sama', () => {
    const a = rngModule.createRng(123);
    const b = rngModule.createRng(123);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    assert.deepStrictEqual(seqA, seqB);
  });

  it('menghasilkan urutan berbeda untuk seed berbeda', () => {
    const a = rngModule.createRng(1).next();
    const b = rngModule.createRng(2).next();
    assert.notStrictEqual(a, b);
  });

  it('fork memberi stream anak yang berbeda', () => {
    const base = rngModule.createRng(7);
    const childA = base.fork();
    const childB = base.fork();
    assert.notStrictEqual(childA.next(), childB.next());
  });

  it('next selalu di rentang [0,1)', () => {
    const rng = rngModule.createRng(99);
    for (let i = 0; i < 500; i++) {
      const value = rng.next();
      assert.ok(value >= 0 && value < 1, `nilai ${value} di luar rentang`);
    }
  });
});

describe('rumus damage', () => {
  it('getDamage memakai roll ±50 seperti OwO', () => {
    const rng = rngModule.createRng(5);
    const value = engine.getDamage([200, 0], 1, rng);
    assert.ok(value >= 150 && value <= 250, `damage ${value} di luar roll ±50`);
  });

  it('resistensi menjenuh dan tidak pernah mencapai 100%', () => {
    assert.strictEqual(engine.resToPercent([0, 0]), 0);
    const high = engine.resToPercent([10000, 0]);
    assert.ok(high < 0.8, 'plafon resistensi 80%');
    assert.ok(engine.resToPercent([425, 0]) > engine.resToPercent([100, 0]));
  });

  it('damage fisik dikurangi PR, magical dikurangi MR', () => {
    const rng = rngModule.createRng(3);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    const physical = engine.inflictDamage(ctx, attacker, target, 1000, engine.PHYSICAL);
    const magical = engine.inflictDamage(ctx, attacker, target, 1000, engine.MAGICAL);
    const trueDamage = engine.inflictDamage(ctx, attacker, target, 1000, engine.TRUE);

    assert.ok(physical < 1000, 'damage fisik kena PR');
    assert.strictEqual(trueDamage, 1000, 'TRUE damage tidak kena resistensi');
    assert.notStrictEqual(physical, magical);
  });

  it('damage tidak pernah negatif walau dikurangi shield besar', () => {
    const rng = rngModule.createRng(11);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    target.buffs.push(createBuff(1, { quality: 100, from: target, rng }));
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    const dealt = engine.inflictDamage(ctx, attacker, target, 10, engine.PHYSICAL);
    assert.ok(dealt >= 0);
    assert.ok(engine.isAlive(target));
  });
});

describe('heal dan replenish', () => {
  it('heal tidak melewati HP maksimum', () => {
    const rng = rngModule.createRng(4);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    engine.heal(ctx, unit, 999999, unit);
    assert.strictEqual(unit.stats.hp[0], engine.maxHp(unit));
  });

  it('heal dengan overheal boleh melewati HP maksimum', () => {
    const rng = rngModule.createRng(4);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    engine.heal(ctx, unit, 999999, unit, { overheal: true });
    assert.ok(unit.stats.hp[0] > engine.maxHp(unit));
    assert.ok(unit.stats.hp[0] <= engine.maxHp(unit) * 1.5);
  });

  it('replenish tidak melewati WP maksimum', () => {
    const rng = rngModule.createRng(4);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    unit.stats.wp[0] = 0;
    engine.replenish(ctx, unit, 999999, unit);
    assert.strictEqual(unit.stats.wp[0], engine.maxWp(unit));
  });

  it('useMana tidak membuat WP negatif', () => {
    const rng = rngModule.createRng(4);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    engine.useMana(unit, 999999);
    assert.strictEqual(unit.stats.wp[0], 0);
  });
});

describe('pemilihan target', () => {
  it('taunt diprioritaskan saat memilih target', () => {
    const rng = rngModule.createRng(8);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, label: 'a' }, rng);
    const b = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, label: 'b' }, rng);
    const c = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, label: 'c' }, rng);
    c.buffs.push(createBuff(1, { quality: 50, from: c, rng }));
    for (let i = 0; i < 20; i++) {
      assert.strictEqual(engine.chooseTarget(a, [a], [b, c], rng), c);
    }
  });

  it('ignoreChoose melewati taunt', () => {
    const rng = rngModule.createRng(8);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const b = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const c = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    c.buffs.push(createBuff(1, { quality: 50, from: c, rng }));
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const target = engine.chooseTarget(a, [a], [b, c], rng, { ignoreChoose: true });
      seen.add(target.pid);
    }
    assert.strictEqual(seen.size, 2, 'kedua lawan bisa terpilih');
  });

  it('lowestHp memilih rasio HP terendah dan melewati yang mati', () => {
    const rng = rngModule.createRng(2);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const b = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const dead = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    a.stats.hp[0] = engine.maxHp(a) * 0.9;
    b.stats.hp[0] = engine.maxHp(b) * 0.2;
    dead.stats.hp[0] = 0;
    assert.strictEqual(engine.lowestHp([a, b, dead]), b);
  });
});

describe('pasif senjata', () => {
  it('pasif stat menambah bonus stat saat alterStats', () => {
    const rng = rngModule.createRng(1);
    const passive = createPassive(1, 100, rng); // Strength, +20%
    const stats = engine.buildStats({ hp: 100, wp: 100, att: 100, mag: 100, pr: 100, mr: 100 });
    passive.alterStats(stats);
    assert.ok(Math.abs(stats.att[1] - 20) < 0.01, 'bonus ATT = 20% dari 100');
  });

  it('Critical menambah damage saat roll berhasil', () => {
    const rng = rngModule.createRng(1);
    const passive = createPassive(12, 100, rng); // 30% chance, +50%
    const bucket = { amount: 100, bonus: 0 };
    let crit = false;
    for (let i = 0; i < 100; i++) {
      bucket.bonus = 0;
      passive.attack({ rng }, { pid: 1 }, { pid: 2 }, bucket);
      if (bucket.bonus > 0) { crit = true; break; }
    }
    assert.ok(crit, 'critical pernah aktif');
    if (crit) assert.ok(Math.abs(bucket.bonus - 50) < 0.01);
  });

  it('Lifesteal menyembuhkan penyerang sebesar persentase damage', () => {
    const rng = rngModule.createRng(6);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const passive = createPassive(7, 100, rng); // 35%
    attacker.weapon = { passives: [passive] };
    attacker.stats.hp[0] = engine.maxHp(attacker) * 0.5;

    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    const before = attacker.stats.hp[0];
    const dealt = engine.inflictDamage(ctx, attacker, target, 200, engine.TRUE);
    assert.ok(dealt > 0);
    assert.ok(attacker.stats.hp[0] > before, 'HP penyerang naik');
  });

  it('Lifesteal tidak memicu dirinya sendiri berulang kali', () => {
    const rng = rngModule.createRng(6);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    attacker.weapon = { passives: [createPassive(7, 100, rng)] };
    attacker.stats.hp[0] = engine.maxHp(attacker) * 0.5;
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    // Rekursi tak terkendali akan melempar RangeError stack overflow.
    assert.doesNotThrow(() => engine.inflictDamage(ctx, attacker, target, 200, engine.TRUE));
  });

  it('Thorns memantulkan damage ke penyerang', () => {
    const rng = rngModule.createRng(6);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    target.weapon = { passives: [createPassive(8, 100, rng)] }; // 35%
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    const before = attacker.stats.hp[0];
    engine.inflictDamage(ctx, attacker, target, 500, engine.TRUE);
    assert.ok(attacker.stats.hp[0] < before, 'penyerang menerima pantulan');
  });

  it('Safeguard memakai WP untuk menahan damage', () => {
    const rng = rngModule.createRng(6);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    target.weapon = { passives: [createPassive(11, 100, rng)] }; // 40%
    const wpBefore = target.stats.wp[0];
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    const dealt = engine.inflictDamage(ctx, attacker, target, 300, engine.TRUE);
    assert.ok(target.stats.wp[0] < wpBefore, 'WP terpakai');
    assert.ok(dealt < 300, 'damage berkurang');
  });

  it('Regeneration menyembuhkan tiap akhir turn', () => {
    const rng = rngModule.createRng(6);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    unit.weapon = { passives: [createPassive(15, 100, rng)] }; // 10%
    unit.stats.hp[0] = engine.maxHp(unit) * 0.5;
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    const before = unit.stats.hp[0];
    unit.weapon.passives[0].postTurn(ctx, unit);
    assert.ok(unit.stats.hp[0] > before);
  });

  it('Energize mengisi WP tiap akhir turn', () => {
    const rng = rngModule.createRng(6);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    unit.weapon = { passives: [createPassive(16, 100, rng)] }; // +40 WP
    unit.stats.wp[0] = 0;
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    unit.weapon.passives[0].postTurn(ctx, unit);
    assert.ok(unit.stats.wp[0] > 0);
  });

  it('semua pasif bisa dibuat tanpa error', () => {
    const rng = rngModule.createRng(1);
    for (let id = 1; id <= 21; id++) {
      const passive = createPassive(id, 50, rng);
      assert.ok(passive, `pasif ${id} gagal dibuat`);
      assert.strictEqual(passive.id, id);
    }
  });
});

describe('buff', () => {
  it('Shield mengurangi damage masuk', () => {
    const rng = rngModule.createRng(9);
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    const plain = engine.inflictDamage(ctx, attacker, target, 400, engine.TRUE);
    target.stats.hp[0] = engine.maxHp(target);
    target.buffs.push(createBuff(1, { quality: 100, from: target, rng }));
    const shielded = engine.inflictDamage(ctx, attacker, target, 400, engine.TRUE);

    assert.ok(shielded < plain, 'damage dengan shield lebih kecil');
  });

  it('Freeze baru berlaku setelah turn pembuatannya selesai', () => {
    const rng = rngModule.createRng(9);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const freeze = createBuff(5, { quality: 50, from: unit, duration: 2, rng });
    unit.buffs.push(freeze);

    assert.strictEqual(freeze.canAttack(), true, 'turn pembuatan tidak terblokir');
    freeze.postTurn();
    // Durasi 2 = dua giliran serang yang hilang, lalu buff lepas.
    assert.strictEqual(freeze.canAttack(), false, 'giliran pertama terblokir');
    assert.ok(!freeze.expired, 'masih tersisa satu giliran');
    assert.strictEqual(freeze.canAttack(), false, 'giliran kedua terblokir');
    assert.ok(freeze.expired, 'freeze habis setelah durasinya selesai');
  });

  it('Freeze mengelola durasinya sendiri, bukan lewat tick mesin', () => {
    const rng = rngModule.createRng(9);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const freeze = createBuff(5, { quality: 50, from: unit, duration: 2, rng });
    assert.strictEqual(freeze.managesOwnDuration, true);
  });

  it('Attack Up menambah damage serangan', () => {
    const rng = rngModule.createRng(9);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const buff = createBuff(6, { quality: 100, from: unit, duration: 2, rng });
    const bucket = { amount: 100, bonus: 0 };
    buff.attack({ rng }, unit, null, bucket);
    assert.ok(bucket.bonus > 0);
  });

  it('Poison memberi damage tiap akhir turn', () => {
    const rng = rngModule.createRng(9);
    const caster = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const victim = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const poison = createBuff(2, { quality: 100, from: caster, duration: 3, rng });
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    const before = victim.stats.hp[0];
    poison.postTurn(ctx, victim);
    assert.ok(victim.stats.hp[0] < before);
  });

  it('semua buff bisa dibuat dan punya id yang benar', () => {
    const rng = rngModule.createRng(1);
    for (let id = 1; id <= 12; id++) {
      const buff = createBuff(id, { quality: 50, from: null, rng });
      assert.ok(buff, `buff ${id} gagal dibuat`);
      assert.strictEqual(buff.id, id);
    }
  });
});

describe('simulasi battle', () => {
  const strong = [{ slot: 1, coeffs: COEFFS_STRONG, level: 40, label: 'kuat' }];
  const weak = [{ slot: 1, coeffs: COEFFS_WEAK, level: 40, label: 'lemah' }];

  it('deterministik untuk seed yang sama', () => {
    const a = sim.simulate(strong, weak, { runs: 20, seed: 1234 });
    const b = sim.simulate(strong, weak, { runs: 20, seed: 1234 });
    assert.deepStrictEqual(a.tally, b.tally);
    assert.strictEqual(a.turns.avg, b.turns.avg);
  });

  it('tim lebih kuat menang jauh lebih sering', () => {
    const result = sim.simulate(strong, weak, { runs: 100, seed: 3 });
    assert.ok(result.winRate > 80, `win rate ${result.winRate}% terlalu rendah`);
  });

  it('hasil terbalik saat posisi ditukar', () => {
    const forward = sim.simulate(strong, weak, { runs: 100, seed: 3 });
    const reverse = sim.simulate(weak, strong, { runs: 100, seed: 3 });
    assert.ok(forward.winRate > 80);
    assert.ok(reverse.winRate < 20);
  });

  it('pertarungan cermin mendekati 50% (tidak bias sisi)', () => {
    const mirror = sim.simulate(strong, strong.map(s => ({ ...s, label: 'mirror' })), { runs: 300, seed: 11 });
    assert.ok(mirror.winRate > 35 && mirror.winRate < 65, `mirror win rate ${mirror.winRate}% bias`);
  });

  it('cermin dengan senjata tetap mendekati 50%', () => {
    const withWeapon = [{ slot: 1, coeffs: COEFFS_STRONG, level: 60, weapon: { id: 1, quality: 90 } }];
    const result = sim.simulate(withWeapon, withWeapon.map(s => ({ ...s, label: 'mirror' })), { runs: 300, seed: 5 });
    assert.ok(result.winRate > 35 && result.winRate < 65, `mirror senjata ${result.winRate}% bias`);
  });

  it('jumlah pertarungan dihitung tepat', () => {
    const result = sim.simulate(strong, weak, { runs: 37, seed: 1 });
    assert.strictEqual(result.runs, 37);
    assert.strictEqual(result.tally.player + result.tally.enemy + result.tally.tie, 37);
  });

  it('membatasi jumlah pertarungan ke 1..1000', () => {
    assert.strictEqual(sim.simulate(strong, weak, { runs: 0, seed: 1 }).runs, 1);
    assert.strictEqual(sim.simulate(strong, weak, { runs: 99999, seed: 1 }).runs, 1000);
  });

  it('battle selalu selesai dalam batas turn', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = engine.runBattle(strong, weak, { seed });
      assert.ok(result.turns >= 1 && result.turns <= engine.MAX_TURNS, `turn ${result.turns} di luar batas`);
    }
  });
});

describe('senjata', () => {
  it('semua senjata bisa dipakai bertarung tanpa error', () => {
    const rng = rngModule.createRng(7);
    for (const weapon of data.weapons()) {
      const player = [{ slot: 1, coeffs: COEFFS_STRONG, level: 60, weapon: { id: weapon.id, quality: 100 } }];
      const enemy = [{ slot: 1, coeffs: COEFFS_WEAK, level: 60 }];
      assert.doesNotThrow(
        () => engine.runBattle(player, enemy, { rng: rngModule.createRng(7), playerQuality: 100 }),
        `senjata ${weapon.name} error`
      );
    }
  });

  it('biaya WP turun saat quality naik', () => {
    const { buildWeapon } = require(path.join(ROOT, 'src/services/battleWeapon'));
    const low = buildWeapon({ id: 1, quality: 0 }, rngModule.createRng(1));
    const high = buildWeapon({ id: 1, quality: 100 }, rngModule.createRng(1));
    assert.ok(low.manaCost >= high.manaCost, 'manaRange OwO menurun terhadap quality');
  });

  it('tanpa quality senjata memakai tier tertinggi', () => {
    const { buildWeapon } = require(path.join(ROOT, 'src/services/battleWeapon'));
    const plain = buildWeapon({ id: 1 }, rngModule.createRng(1));
    const fabled = buildWeapon({ id: 1, quality: 100 }, rngModule.createRng(1));
    assert.deepStrictEqual(plain.stats, fabled.stats);
    assert.strictEqual(plain.manaCost, fabled.manaCost);
    assert.ok(plain.passives.every(p => p.quality === 100), 'pasif ikut tier tertinggi');
  });

  it('flag -qp/-qe menimpa default tier', () => {
    const { buildWeapon } = require(path.join(ROOT, 'src/services/battleWeapon'));
    const weapon = buildWeapon({ id: 1 }, rngModule.createRng(1), 0);
    const common = buildWeapon({ id: 1, quality: 0 }, rngModule.createRng(1));
    assert.deepStrictEqual(weapon.stats, common.stats);
  });

  it('quality di slot menimpa flag global', () => {
    const { buildWeapon } = require(path.join(ROOT, 'src/services/battleWeapon'));
    const weapon = buildWeapon({ id: 1, quality: 40 }, rngModule.createRng(1), 100);
    const explicit = buildWeapon({ id: 1, quality: 40 }, rngModule.createRng(1));
    assert.deepStrictEqual(weapon.stats, explicit.stats);
  });

  it('senjata tidak dikenal menghasilkan null', () => {
    const { buildWeapon } = require(path.join(ROOT, 'src/services/battleWeapon'));
    assert.strictEqual(buildWeapon('tidak-ada', rngModule.createRng(1)), null);
  });
});

describe('parsing stat manual', () => {
  it('menerima format nama=nilai', () => {
    const parsed = sim.parseCustomStats('hp=14 att=6 pr=2 wp=3 mag=0 mr=1');
    assert.deepStrictEqual(parsed.custom, { hp: 14, att: 6, pr: 2, wp: 3, mag: 0, mr: 1 });
  });

  it('menerima format enam angka berurutan', () => {
    const parsed = sim.parseCustomStats('14,6,2,3,0,1');
    assert.deepStrictEqual(parsed.custom, { hp: 14, att: 6, pr: 2, wp: 3, mag: 0, mr: 1 });
  });

  it('menerima nama stat dex (attack/protection/wisdom/magic)', () => {
    const parsed = sim.parseCustomStats('attack=6 protection=2 wisdom=3 magic=5');
    assert.deepStrictEqual(parsed.custom, { att: 6, pr: 2, wp: 3, mag: 5 });
  });

  it('menolak jumlah angka yang salah', () => {
    assert.ok(sim.parseCustomStats('1,2,3').error);
  });

  it('menolak nama stat tak dikenal', () => {
    assert.ok(sim.parseCustomStats('kekuatan=5').error);
  });

  it('menolak input kosong', () => {
    assert.ok(sim.parseCustomStats('').error);
  });
});

describe('embed UI', () => {
  const panel = require(path.join(ROOT, 'src/ui/battlePanel'));

  const team = { id: 1, name: 'Tank', slots: [{ slot: 1, animalKey: null, custom: COEFFS_STRONG, level: 60, weaponId: 1 }] };

  it('teamEmbed menghasilkan embed dengan field per slot', () => {
    const json = panel.teamEmbed(team, { prefix: 'd', active: true }).toJSON();
    assert.ok(json.title.includes('Tank'));
    assert.strictEqual(json.fields.length, 3);
    assert.ok(json.color === panel.COLOR.ok, 'tim aktif memakai warna hijau');
  });

  it('teamEmbed menandai slot kosong', () => {
    const json = panel.teamEmbed(team, {}).toJSON();
    assert.ok(json.fields[1].value.includes('kosong'));
    assert.strictEqual(json.color, panel.COLOR.info);
  });

  it('teamListEmbed memberi warna peringatan saat belum ada tim', () => {
    const json = panel.teamListEmbed([], null, 'd').toJSON();
    assert.strictEqual(json.color, panel.COLOR.warn);
    assert.ok(json.description.includes('d team new'));
  });

  it('simEmbed memuat tally, durasi, dan seed', () => {
    const result = sim.simulate(
      [{ slot: 1, coeffs: COEFFS_STRONG, level: 60 }],
      [{ slot: 1, coeffs: COEFFS_WEAK, level: 60 }],
      { runs: 20, seed: 7 }
    );
    const json = panel.simEmbed(result, { playerLabel: 'Tank', enemyLabel: 'Lawan' }).toJSON();
    const names = json.fields.map(f => f.name).join(' ');
    assert.ok(names.includes('Total'));
    assert.ok(names.includes('Durasi'));
    assert.ok(names.includes('Seed'));
    assert.ok(json.description.includes('Tank'));
  });

  it('warna simEmbed mengikuti hasil', () => {
    assert.strictEqual(panel.simColor(90), panel.COLOR.ok);
    assert.strictEqual(panel.simColor(50), panel.COLOR.warn);
    assert.strictEqual(panel.simColor(10), panel.COLOR.error);
  });

  it('bar penuh saat nilai maksimum dan kosong saat nol', () => {
    assert.strictEqual(panel.bar(10, 10, 4), '▰▰▰▰');
    assert.strictEqual(panel.bar(0, 10, 4), '▱▱▱▱');
    assert.strictEqual(panel.bar(5, 0, 3), '▱▱▱');
  });

  it('usageEmbed menerima string maupun array', () => {
    assert.ok(panel.usageEmbed('Judul', 'satu baris').toJSON().description === 'satu baris');
    assert.strictEqual(panel.usageEmbed('Judul', ['a', 'b']).toJSON().description, 'a\nb');
  });

  it('tombol tim dibatasi 5 per baris dan memuat index', () => {
    const teams = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `T${i + 1}`, slots: [] }));
    const rows = panel.teamButtons(teams, teams[0], 'u1');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].components.length, 5);
    assert.strictEqual(rows[1].components.length, 2);
    assert.strictEqual(panel.parseTeamButton(rows[1].components[1].data.custom_id).index, 6);
  });

  it('tombol menandai tim aktif dan menolak customId asing', () => {
    const teams = [{ id: 1, name: 'A', slots: [] }, { id: 2, name: 'B', slots: [] }];
    const rows = panel.teamButtons(teams, teams[1], 'u9');
    assert.ok(rows[0].components[1].data.label.startsWith('✓'));
    assert.strictEqual(panel.isTeamButton('boss_other'), false);
    assert.strictEqual(panel.parseTeamButton('battle_team_pick:u9').ok, false);
  });
});

describe('balasan command memakai embed', () => {
  const { handleTeamCommand } = require(path.join(ROOT, 'src/commands/battleTeam'));
  const { handleSimCommand } = require(path.join(ROOT, 'src/commands/battleSim'));
  const store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));

  let tempDir;
  let replies;

  function message(content) {
    return { guildId: 'g', author: { id: 'u' }, content };
  }

  const sendEmbed = (m, embed) => { replies.push(embed.toJSON()); };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-battle-embed-'));
    process.chdir(tempDir);
    store.getDb();
    replies = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('d team new membalas dengan embed, bukan teks polos', () => {
    handleTeamCommand(message('d team new Tank'), ['new', 'Tank'], 'd', { sendEmbed });
    assert.strictEqual(replies.length, 1);
    assert.ok(replies[0].color, 'embed punya warna');
    assert.ok(replies[0].description.includes('Tank'));
  });

  it('d team list mengirim embed beserta tombol', () => {
    store.createTeam('g', 'u', 'Alpha');
    store.createTeam('g', 'u', 'Beta');
    let payload = null;
    handleTeamCommand(message('d team list'), ['list'], 'd', {
      sendEmbed,
      sendPayload: (m, p) => { payload = p; },
    });
    assert.ok(payload, 'payload terkirim');
    assert.ok(payload.embeds[0].toJSON().title.includes('Tim Battle'));
    assert.strictEqual(payload.components[0].components.length, 2);
  });

  it('d sim membalas dengan embed berisi statistik', () => {
    store.createTeam('g', 'u', 'Solo');
    store.setSlot('g', 'u', 'Solo', 1, { custom: COEFFS_STRONG, level: 60 });
    store.setActiveTeam('g', 'u', 'Solo');
    handleSimCommand(message('d sim -m 10 -s 3'), ['-m', '10', '-s', '3'], 'd', { sendEmbed });
    assert.strictEqual(replies.length, 1);
    assert.ok(replies[0].title.includes('Simulasi Battle'));
    assert.ok(replies[0].fields.some(f => f.name.includes('Total')));
  });

  it('error d sim tetap berupa embed', () => {
    handleSimCommand(message('d sim -m 5000'), ['-m', '5000'], 'd', { sendEmbed });
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(replies[0].color, 0xED4245);
  });
});

describe('emoji battle', () => {
  const be = require(path.join(ROOT, 'src/services/battleEmoji'));

  it('memetakan quality ke rank OwO', () => {
    assert.strictEqual(be.rankName(10), 'Common');
    assert.strictEqual(be.rankName(30), 'Uncommon');
    assert.strictEqual(be.rankName(70), 'Epic');
    assert.strictEqual(be.rankName(96), 'Legendary');
    assert.strictEqual(be.rankName(100), 'Fabled');
    assert.strictEqual(be.rankName(0), 'Common');
  });

  it('setiap senjata dan pasif punya 7 emoji (satu per rank)', () => {
    const battle = require(path.join(ROOT, 'src/data/owoBattle'));
    const passives = require(path.join(ROOT, 'src/data/owoPassives.json')).passives;
    for (const weapon of battle.weapons()) {
      assert.strictEqual(weapon.emojis.length, 7, `${weapon.name} punya emoji lengkap`);
    }
    for (const passive of passives) {
      assert.strictEqual(passive.emojis.length, 7, `${passive.name} punya emoji lengkap`);
    }
  });

  it('memilih emoji sesuai rank dan jatuh ke ikon netral tanpa quality', () => {
    assert.ok(be.weaponToken(1, 10).includes('cgreatsword'));
    assert.ok(be.weaponToken(1, 100).includes('fgreatsword'));
    assert.ok(be.passiveToken(7, 70).includes('elifesteal'));
    assert.ok(be.weaponToken(1, null).includes('fgreatsword'), 'tanpa quality = fabled');
    assert.ok(be.passiveToken(7, null).includes('flifesteal'));
    assert.strictEqual(be.weaponEmoji(999, 80), '⚔️');
    assert.strictEqual(be.passiveEmoji(7, null), '✨');
    assert.strictEqual(be.animalEmoji(null), '🐾');
  });

  it('tidak pernah membocorkan token mentah ke tampilan', () => {
    const panel = require(path.join(ROOT, 'src/ui/battlePanel'));
    const team = { id: 1, name: 'T', slots: [{ slot: 1, animalKey: null, custom: COEFFS_STRONG, level: 60, weaponId: 1, passives: [7] }] };
    const text = JSON.stringify(panel.teamEmbed(team, {}).toJSON());
    assert.ok(!/<a?:\w+:\d+>/.test(text), 'tidak ada token mentah saat cache kosong');
  });

  it('menyertakan emoji senjata dan pasif saat cache terisi', () => {
    const dexStore = require(path.join(ROOT, 'src/utils/animalDexStorage'));
    const panel = require(path.join(ROOT, 'src/ui/battlePanel'));
    for (const token of be.allTokens()) {
      const id = /:(\d+)>$/.exec(token);
      if (id) dexStore.setEmojiToken(id[1], token);
    }
    const team = { id: 1, name: 'T', slots: [{ slot: 1, custom: COEFFS_STRONG, level: 60, weaponId: 1, weaponQuality: 80, passives: [7] }] };
    const json = panel.teamEmbed(team, {}).toJSON();
    assert.ok(json.fields[0].value.includes('greatsword'));
    assert.ok(json.fields[0].value.includes('lifesteal'));
  });
});

describe('lawan simulasi berupa tim', () => {
  const { resolveEnemy } = require(path.join(ROOT, 'src/commands/battleSim'));
  const store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));

  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-battle-enemy-'));
    process.chdir(tempDir);
    store.createTeam('g', 'u', '1');
    store.setSlot('g', 'u', '1', 1, { custom: COEFFS_STRONG, level: 60 });
    store.createTeam('g', 'u', 'blitz');
    store.setSlot('g', 'u', 'blitz', 1, { custom: COEFFS_WEAK, level: 70 });
    store.setActiveTeam('g', 'u', '1');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('menerima nama tim sebagai lawan', () => {
    const enemy = resolveEnemy('g', 'u', ['blitz']);
    assert.ok(!enemy.error, enemy.error);
    assert.strictEqual(enemy.label, 'blitz');
  });

  it('menerima bentuk "x vs y"', () => {
    const enemy = resolveEnemy('g', 'u', ['1', 'vs', 'blitz']);
    assert.ok(!enemy.error, enemy.error);
    assert.strictEqual(enemy.label, 'blitz');
  });

  it('nama tim berupa angka tetap dikenali sebagai tim', () => {
    const enemy = resolveEnemy('g', 'u', ['1']);
    assert.ok(!enemy.error, enemy.error);
    assert.strictEqual(enemy.label, '1');
  });

  it('tim kosong dilaporkan, bukan dianggap nama tidak dikenal', () => {
    store.createTeam('g', 'u', 'kosong');
    const enemy = resolveEnemy('g', 'u', ['kosong']);
    assert.ok(enemy.error.includes('masih kosong'));
  });

  it('stat manual tetap didahulukan saat berbentuk angka', () => {
    const enemy = resolveEnemy('g', 'u', ['hp=8,att=6,pr=2,wp=3,mag=5,mr=1']);
    assert.ok(!enemy.error, enemy.error);
    assert.strictEqual(enemy.label, 'stat manual');
  });
});

describe('storage tim', () => {
  let tempDir;
  let store;

  function load() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-battle-team-'));
    process.chdir(tempDir);
    delete require.cache[require.resolve(path.join(ROOT, 'src/utils/battleTeamStorage'))];
    store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));
  }

  function cleanup() {
    try { store.getDb().close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  it('membuat, membaca, dan menghapus tim', () => {
    load();
    try {
      const created = store.createTeam('g1', 'u1', 'Alpha');
      assert.ok(created.team);
      assert.strictEqual(store.getTeam('g1', 'u1', 'Alpha').name, 'Alpha');
      store.deleteTeam('g1', 'u1', 'Alpha');
      assert.strictEqual(store.getTeam('g1', 'u1', 'Alpha'), null);
    } finally { cleanup(); }
  });

  it('nama tim unik tanpa peduli huruf besar/kecil', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      assert.ok(store.createTeam('g1', 'u1', 'alpha').error);
    } finally { cleanup(); }
  });

  it('tim terpisah per user dan per guild', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      assert.strictEqual(store.getTeam('g1', 'u2', 'Alpha'), null);
      assert.strictEqual(store.getTeam('g2', 'u1', 'Alpha'), null);
    } finally { cleanup(); }
  });

  it('menyimpan slot hewan dan slot stat manual', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      store.setSlot('g1', 'u1', 'Alpha', 1, { animalKey: 'snail', level: 50, weaponId: 1 });
      store.setSlot('g1', 'u1', 'Alpha', 2, { custom: { hp: 14, att: 6, pr: 2, wp: 3, mag: 0, mr: 1 }, level: 20 });
      const team = store.getTeam('g1', 'u1', 'Alpha');
      assert.strictEqual(team.slots.length, 2);
      assert.strictEqual(team.slots[0].animalKey, 'snail');
      assert.strictEqual(team.slots[0].level, 50);
      assert.deepStrictEqual(team.slots[1].custom, { hp: 14, att: 6, pr: 2, wp: 3, mag: 0, mr: 1 });
    } finally { cleanup(); }
  });

  it('slot di luar 1-3 ditolak', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      assert.ok(store.setSlot('g1', 'u1', 'Alpha', 0, { animalKey: 'snail' }).error);
      assert.ok(store.setSlot('g1', 'u1', 'Alpha', 4, { animalKey: 'snail' }).error);
    } finally { cleanup(); }
  });

  it('slot harus berisi hewan atau stat, tidak keduanya', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      assert.ok(store.setSlot('g1', 'u1', 'Alpha', 1, {}).error);
      assert.ok(store.setSlot('g1', 'u1', 'Alpha', 1, { animalKey: 'snail', custom: { hp: 1 } }).error);
    } finally { cleanup(); }
  });

  it('menimpa slot yang sama tanpa menduplikasi', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      store.setSlot('g1', 'u1', 'Alpha', 1, { animalKey: 'snail', level: 10 });
      store.setSlot('g1', 'u1', 'Alpha', 1, { animalKey: 'cat2', level: 30 });
      const team = store.getTeam('g1', 'u1', 'Alpha');
      assert.strictEqual(team.slots.length, 1);
      assert.strictEqual(team.slots[0].animalKey, 'cat2');
      assert.strictEqual(team.slots[0].level, 30);
    } finally { cleanup(); }
  });

  it('menyimpan dan membaca tim aktif', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      store.createTeam('g1', 'u1', 'Beta');
      store.setActiveTeam('g1', 'u1', 'Beta');
      assert.strictEqual(store.getActiveTeam('g1', 'u1').name, 'Beta');
      store.setActiveTeam('g1', 'u1', 'Alpha');
      assert.strictEqual(store.getActiveTeam('g1', 'u1').name, 'Alpha');
    } finally { cleanup(); }
  });

  it('mengganti nama tim dan menolak nama yang sudah dipakai', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      store.createTeam('g1', 'u1', 'Beta');
      assert.ok(store.renameTeam('g1', 'u1', 'Alpha', 'Beta').error);
      const renamed = store.renameTeam('g1', 'u1', 'Alpha', 'Gamma');
      assert.strictEqual(renamed.team.name, 'Gamma');
    } finally { cleanup(); }
  });

  it('menghapus tim juga membersihkan tim aktif', () => {
    load();
    try {
      store.createTeam('g1', 'u1', 'Alpha');
      store.setActiveTeam('g1', 'u1', 'Alpha');
      store.deleteTeam('g1', 'u1', 'Alpha');
      assert.strictEqual(store.getActiveTeam('g1', 'u1'), null);
    } finally { cleanup(); }
  });
});
