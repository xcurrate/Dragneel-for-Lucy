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
const weaponModule = require(path.join(ROOT, 'src/services/battleWeapon'));

// Stat dasar dipakai berulang; level 40 cukup untuk battle selesai < 24 turn.
const COEFFS_STRONG = { hp: 8, att: 6, pr: 2, wp: 3, mag: 5, mr: 1 };
const COEFFS_WEAK = { hp: 4, att: 2, pr: 3, wp: 1, mag: 1, mr: 2 };

describe('data battle OwO', () => {
  it('memuat hewan, senjata, dan buff dengan jumlah yang diharapkan', () => {
    assert.strictEqual(data.animals().length, 20);
    assert.strictEqual(data.weapons().length, 22);
    assert.strictEqual(data.buffs().length, 13);
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

  it('Poison Dagger: 70-100% STR, 200-100 WP, Poison 40-65% MAG 3 turn', () => {
    const def = data.weapons().find(w => w.id === 8);
    assert.strictEqual(def.name, 'Poison Dagger');
    assert.deepStrictEqual(def.qualityList[0], [70, 100]);
    assert.deepStrictEqual(def.manaRange, [200, 100]);
    assert.deepStrictEqual(data.buffById(2).qualityList[0], [40, 65]);
    assert.strictEqual(def.ability.duration, 3);

    const at = q => weaponModule.buildWeapon({ id: 8, quality: q, passives: [12] }, rngModule.createRng(1), q).stats[0];
    assert.strictEqual(at(0), 70);
    assert.strictEqual(at(100), 100);
  });

  it('kualitas Poison mengikuti kualitas senjata, bukan diundi', () => {
    const rng = rngModule.createRng(1);
    const seen = [0, 50, 100].map(quality => createBuff(2, { quality, from: null, duration: 3, rng }).stats[0]);
    assert.deepStrictEqual(seen, [40, 52.5, 65]);

    // Lewat senjata: q100 harus memberi Poison 65%, bukan hasil undian.
    const q100 = weaponModule.buildWeapon({ id: 8, quality: 100, passives: [12] }, rng, 100);
    assert.strictEqual(q100.quality, 100);
    assert.strictEqual(createBuff(2, { quality: q100.quality, from: null, duration: 3, rng }).stats[0], 65);
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

  it('teamEmbed menandai slot kosong dengan perintah pengisian', () => {
    const json = panel.teamEmbed(team, {}).toJSON();
    assert.ok(json.fields[1].value.includes('d team add 2'));
    assert.strictEqual(json.color, panel.COLOR.info);
  });

  it('teamEmbed memakai format OwO: nomor, level, emoji, nama', () => {
    const labelled = { id: 1, name: 'Tank', slots: [{ slot: 1, label: 'lobbot', custom: COEFFS_STRONG, level: 100 }] };
    const name = panel.teamEmbed(labelled, { prefix: 'd' }).toJSON().fields[0].name;
    assert.match(name, /^\[1\] L\.100 /, 'diawali [slot] L.level');
    assert.ok(name.endsWith('lobbot'), 'nama hewan/label di akhir judul');
  });

  it('teamEmbed menampilkan stat final, bukan koefisien', () => {
    const value = panel.teamEmbed(team, {}).toJSON().fields[0].value;
    const lines = value.split('\n');
    assert.strictEqual(lines.length, 4, 'empat baris stat');
    assert.match(lines[0], /\d{3,}/, 'HP/WP berupa angka besar');
    assert.match(lines[2], /\d+%/, 'PR/MR berupa persen');
  });

  it('teamEmbed menaruh jumlah slot di footer', () => {
    const json = panel.teamEmbed(team, { prefix: 'd', active: true }).toJSON();
    assert.ok(json.footer.text.includes('Team 1/3'));
  });

  it('teamEmbed menampilkan rank, senjata, dan pasif beserta quality', () => {
    const entry = { slot: 1, custom: COEFFS_STRONG, level: 100, weaponId: 14, weaponQuality: 100, passives: [15] };
    const value = panel.teamEmbed({ id: 1, name: 'T', slots: [entry] }, {}).toJSON().fields[0].value;
    assert.match(value, /100%$/, 'diakhiri persen quality');
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

  // Regresi: `...usage(prefix)` menyebar string menjadi per karakter, jadi
  // panduan tampil satu huruf satu baris.
  it('panduan d team tidak dipecah per huruf', () => {
    handleTeamCommand(message('d team zzz'), ['zzz'], 'd', { sendEmbed });
    const body = replies[0].description;
    assert.ok(body.includes('Perintah tidak dikenal.'));
    assert.ok(body.split('\n').length < 20, 'jumlah baris wajar');
    assert.ok(body.includes('`d team list` — daftar tim kamu'), 'baris utuh');
  });

  it('panduan d sim tidak dipecah per huruf', () => {
    handleSimCommand(message('d sim help'), ['help'], 'd', { sendEmbed });
    const body = replies[0].description;
    assert.ok(body.split('\n').length < 20, 'jumlah baris wajar');
    assert.ok(body.includes('`d sim <nama-tim>`'), 'baris utuh');
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

describe('dtm s memasang senjata ke slot', () => {
  const { handleTeamCommand } = require(path.join(ROOT, 'src/commands/battleTeam'));
  const store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));
  const STATS = 'hp=14,att=6,pr=2,wp=3,mag=0,mr=1';

  let dir;
  const run = (...args) => {
    const out = [];
    handleTeamCommand({ guildId: 'g', author: { id: 'u' } }, args, 'd', {
      sendEmbed: (m, e) => out.push(e.toJSON()),
    });
    return out[0]?.description || '';
  };
  const slotOf = n => store.getActiveTeam('g', 'u').slots.find(s => s.slot === n);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-dtm-'));
    process.chdir(dir);
    store.createTeam('g', 'u', 'Alpha');
    store.setActiveTeam('g', 'u', 'Alpha');
    run('add', '1', STATS, 'level=100');
    run('add', '2', STATS, 'level=80');
  });

  afterEach(() => {
    process.chdir(ROOT);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('dtm s gsword crit memasang ke slot 1', () => {
    run('s', 'gsword', 'crit');
    assert.strictEqual(slotOf(1).weaponId, 1);
  });

  it('menolak senjata berpasif tanpa pasif', () => {
    const text = run('s', 'gsword');
    assert.ok(text.includes('butuh 1 pasif'), text);
    assert.strictEqual(slotOf(1).weaponId, null, 'tidak tersimpan');
  });

  it('dtm s sword crit memasang senjata + pasif', () => {
    run('s', 'sword', 'crit');
    assert.strictEqual(slotOf(1).weaponId, 1, 'alias sword = Great Sword');
    assert.deepStrictEqual(slotOf(1).passives, [12], 'crit = Critical');
  });

  it('dtm s gsword crit 2 memasang ke slot 2', () => {
    run('s', 'gsword', 'crit', '2');
    assert.strictEqual(slotOf(2).weaponId, 1);
    assert.strictEqual(slotOf(1).weaponId, null, 'slot 1 tidak ikut terisi');
  });

  it('Rune of the Forgotten justru harus tanpa pasif', () => {
    const ok = run('s', 'rune');
    assert.ok(ok.includes('tanpa pasif'), ok);
    assert.strictEqual(slotOf(1).weaponId, 4);
    assert.strictEqual(slotOf(1).passives, null);

    const bad = run('s', 'rune', 'crit');
    assert.ok(bad.includes('tidak punya pasif'), bad);
  });

  it('dtm s sword crit 2 memasang senjata + pasif ke slot 2', () => {
    run('s', 'sword', 'crit', '2');
    assert.strictEqual(slotOf(2).weaponId, 1);
    assert.deepStrictEqual(slotOf(2).passives, [12]);
  });

  it('mengganti senjata tidak mengubah level dan stat hewan', () => {
    run('s', 'gsword', '1');
    run('s', 'rstaff', 'hgen', '1');
    const slot = slotOf(1);
    assert.strictEqual(slot.weaponId, 14);
    assert.deepStrictEqual(slot.passives, [15]);
    assert.strictEqual(slot.level, 100, 'level tetap');
    assert.deepStrictEqual(slot.custom, { hp: 14, att: 6, pr: 2, wp: 3, mag: 0, mr: 1 });
  });

  it('mempertahankan quality slot saat senjata diganti', () => {
    store.setSlot('g', 'u', 'Alpha', 1, { custom: { hp: 14, att: 6, pr: 2, wp: 3, mag: 0, mr: 1 }, level: 100, weaponId: 1, weaponQuality: 60 });
    run('s', 'rstaff', '1');
    assert.strictEqual(slotOf(1).weaponQuality, 60);
  });

  it('menolak jumlah pasif melebihi passiveCount senjata', () => {
    const text = run('s', 'gs', 'crit', 'str', '1');
    assert.ok(text.includes('punya 1 slot pasif'), text);
    assert.strictEqual(slotOf(1).weaponId, null, 'tidak tersimpan sebagian');
  });

  it('menolak jumlah pasif kurang dari passiveCount senjata', () => {
    const text = run('s', 'orb', 'crit', '1');
    assert.ok(text.includes('punya 2 slot pasif'), text);
    assert.strictEqual(slotOf(1).weaponId, null);
  });

  it('d team add dengan weapon= juga wajib menyebut pasif', () => {
    const bad = run('add', '1', STATS, 'weapon=gs');
    assert.ok(bad.includes('butuh 1 pasif'), bad);
    assert.strictEqual(slotOf(1).weaponId, null);

    run('add', '1', STATS, 'weapon=gs', 'passive=12');
    assert.strictEqual(slotOf(1).weaponId, 1);
    assert.deepStrictEqual(slotOf(1).passives, [12]);
  });

  it('Orb of Potency menerima dua pasif', () => {
    run('s', 'orb', 'crit', 'th', '1');
    assert.strictEqual(slotOf(1).weaponId, 6);
    assert.deepStrictEqual(slotOf(1).passives, [12, 8]);
  });

  it('menolak slot kosong dan slot di luar batas', () => {
    assert.ok(run('s', 'bow', 'crit', '3').includes('masih kosong'));
    assert.ok(run('s', 'bow', 'crit', '9').includes('Slot harus 1-3'));
  });

  it('membedakan senjata belum ada mekanik dari tidak dikenal', () => {
    assert.ok(run('s', 'cstaff', 'crit').includes('belum punya data simulasi'));
    assert.ok(run('s', 'zzz', 'crit').includes('tidak dikenal'));
  });

  it('membedakan pasif belum ada mekanik dari tidak dikenal', () => {
    assert.ok(run('s', 'gs', 'gslay').includes('belum punya mekanik simulasi'));
    assert.ok(run('s', 'gs', 'nope').includes('tidak dikenal'));
  });

  it('senjata yang dipasang benar-benar dipakai simulasi', () => {
    run('s', 'rstaff', 'hgen', '1');
    const specs = sim.toSpecs(store.getActiveTeam('g', 'u')).specs;
    const unit = engine.buildUnit(specs[0], rngModule.createRng(1), undefined);
    assert.strictEqual(unit.weapon.id, 14);
    assert.deepStrictEqual(unit.weapon.passives.map(p => p.id), [15]);
  });
});

describe('alias senjata dan pasif', () => {
  const battleData = require(path.join(ROOT, 'src/data/owoBattle'));
  const passives = require(path.join(ROOT, 'src/data/owoPassives'));

  it('mengenali semua alias senjata dari daftar resmi', () => {
    const cases = {
      aegis: "Defender's Aegis", shield: "Defender's Aegis", gsword: 'Great Sword', sword: 'Great Sword',
      hstaff: 'Healing Staff', rune: 'Rune of the Forgotten', orb: 'Orb of Potency',
      vstaff: 'Vampiric Staff', pdag: 'Poison Dagger', pd: 'Poison Dagger',
      awand: 'Wand of Absorption', ascept: 'Arcane Scepter', scepter: 'Arcane Scepter',
      rstaff: 'Resurrection Staff', axe: 'Glacial Axe', gaxe: 'Glacial Axe',
      vban: "Vanguard's Banner", banner: "Vanguard's Banner", sythe: 'Culling Scythe',
      csy: 'Culling Scythe', scythe: 'Culling Scythe', cel: 'Rune of Celebration',
      pstaff: 'Staff of Purity', lsy: 'Leeching Scythe', ffish: 'Foul Fish',
      lrune: 'Rune of Luck',
    };
    for (const [alias, name] of Object.entries(cases)) {
      const found = battleData.findWeapon(alias);
      assert.ok(found, `alias ${alias} dikenali`);
      assert.strictEqual(found.name, name, alias);
    }
  });

  it('mengenali semua alias pasif dari daftar resmi', () => {
    const cases = {
      str: 1, strength: 1, magic: 2, hp: 3, wp: 4, pr: 5, mr: 6,
      ls: 7, lifesteal: 7, th: 8, thorns: 8, mtap: 9, manatap: 9,
      absv: 10, absolve: 10, sg: 11, safeguard: 11, crit: 12, critical: 12,
      dc: 13, discharge: 13, kk: 14, kamikaze: 14, regen: 15, regeneration: 15,
      energ: 16, energize: 16, sprt: 17, enra: 18, sac: 19, sacrifice: 19,
      snail: 20, kno: 21, knowledge: 21,
    };
    for (const [alias, id] of Object.entries(cases)) {
      const found = passives.get(alias);
      assert.ok(found, `pasif ${alias} dikenali`);
      assert.strictEqual(found.id, id, alias);
    }
  });

  it('senjata tanpa data simulasi dilaporkan belum siap, bukan tidak dikenal', () => {
    const { handleTeamCommand } = require(path.join(ROOT, 'src/commands/battleTeam'));
    const store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-pending-'));
    process.chdir(tempDir);
    store.createTeam('g', 'u', 'T');
    store.setActiveTeam('g', 'u', 'T');
    const replies = [];
    handleTeamCommand({ guildId: 'g', author: { id: 'u' } }, ['add', '1', 'snail', 'weapon=cstaff'], 'd', {
      sendEmbed: (m, e) => replies.push(e.toJSON()),
    });
    assert.ok(replies[0].description.includes('belum punya data simulasi'));
    assert.ok(!replies[0].description.includes('tidak dikenal'));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('data pending tetap punya nama dan alias walau mekanik belum ada', () => {
    const pending = battleData.pending;
    assert.ok(pending.weapons.length > 0 && pending.passives.length > 0);
    for (const w of pending.weapons) {
      assert.ok(w.name && w.aliases.length, `${w.name} punya alias`);
      assert.strictEqual(battleData.findWeapon(w.aliases[0]), null, 'belum masuk data simulasi');
      assert.ok(battleData.findPendingWeapon(w.aliases[0]), 'terdaftar sebagai pending');
    }
  });
});

describe('level default dan flag lvl', () => {
  const { handleSimCommand, parseFlags } = require(path.join(ROOT, 'src/commands/battleSim'));
  const { handleTeamCommand } = require(path.join(ROOT, 'src/commands/battleTeam'));
  const store = require(path.join(ROOT, 'src/utils/battleTeamStorage'));
  const battleData = require(path.join(ROOT, 'src/data/owoBattle'));

  let tempDir;
  let replies;
  const sendEmbed = (m, e) => { replies.push(e.toJSON()); };
  const message = { guildId: 'g', author: { id: 'u' } };

  function run(args) {
    replies = [];
    handleSimCommand(message, args, 'd', { sendEmbed });
    return replies[0];
  }

  function composition(embed) {
    return (embed.fields || []).find(f => f.name.toLowerCase().includes('komposisi')).value;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-battle-level-'));
    process.chdir(tempDir);
    store.createTeam('g', 'u', 'A');
    store.setSlot('g', 'u', 'A', 1, { custom: COEFFS_STRONG, level: 50 });
    store.createTeam('g', 'u', 'B');
    store.setSlot('g', 'u', 'B', 1, { custom: COEFFS_WEAK, level: 70 });
    store.setSlot('g', 'u', 'B', 2, { custom: COEFFS_WEAK, level: 20 });
    store.setActiveTeam('g', 'u', 'A');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('level default hewan saat ditambah ke tim adalah 50', () => {
    assert.strictEqual(battleData.DEFAULT_LEVEL, 50);
    replies = [];
    handleTeamCommand(message, ['add', '2', 'hp=14,att=6,pr=2,wp=3,mag=0,mr=1'], 'd', { sendEmbed });
    assert.ok(replies[0].description.includes('level 50'));
    assert.strictEqual(store.getTeam('g', 'u', 'A').slots.find(s => s.slot === 2).level, 50);
  });

  it('lvl<angka> menyamakan level kedua sisi', () => {
    const body = composition(run(['B', 'lvl100']));
    assert.ok(body.includes('Kamu:** 🐾 slot1 lv100'));
    assert.ok(body.includes('slot1 lv100'));
    assert.ok(!body.includes('lv70') && !body.includes('lv20'), 'level lawan ikut ditimpa');
  });

  it('lvl<n>/<m> memakai level berbeda per sisi', () => {
    const body = composition(run(['B', 'lvl100/60']));
    assert.ok(body.includes('Kamu:** 🐾 slot1 lv100'));
    assert.ok(body.includes('slot1 lv60') && body.includes('slot2 lv60'));
  });

  it('lvl/<m> hanya menimpa level lawan', () => {
    const body = composition(run(['B', 'lvl/40']));
    assert.ok(body.includes('Kamu:** 🐾 slot1 lv50'));
    assert.ok(body.includes('slot1 lv40') && body.includes('slot2 lv40'));
  });

  it('flag lvl tidak mengubah level tersimpan di tim', () => {
    run(['B', 'lvl100/60']);
    assert.deepStrictEqual(store.getTeam('g', 'u', 'A').slots.map(s => s.level), [50]);
    assert.deepStrictEqual(store.getTeam('g', 'u', 'B').slots.map(s => s.level), [70, 20]);
  });

  it('bentuk lvl yang salah dilaporkan, bukan dianggap nama lawan', () => {
    for (const bad of [['lvl'], ['lvl0'], ['lvlabc'], ['lvl9999'], ['lvl100/abc']]) {
      const embed = run(bad);
      assert.ok(embed.description.includes('Format level salah'), bad.join(' '));
      assert.strictEqual(embed.color, 0xED4245);
    }
  });

  it('token lvl tidak masuk ke daftar argumen lawan', () => {
    const { rest, flags } = parseFlags(['B', 'lvl100/60', '-m', '5']);
    assert.deepStrictEqual(rest, ['B']);
    assert.deepStrictEqual(flags.lvl, { player: '100', enemy: '60' });
    assert.strictEqual(flags['-m'], '5');
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

// Regresi untuk bug wiring: hook pasif dan aturan penumpukan hanya terlihat
// kalau diuji lewat runTurn/runBattle, bukan dengan memanggil hook langsung.
describe('wiring mesin battle', () => {
  it('passive.postTurn dipanggil mesin untuk Regeneration', () => {
    const rng = rngModule.createRng(6);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    unit.weapon = { passives: [createPassive(15, 100, rng)] };
    unit.stats.hp[0] = engine.maxHp(unit) * 0.5;

    let calls = 0;
    const original = unit.weapon.passives[0].postTurn;
    unit.weapon.passives[0].postTurn = function (...args) { calls++; return original.apply(this, args); };

    const enemy = engine.buildUnit({ coeffs: COEFFS_WEAK, level: 40 }, rng);
    unit.team = [unit]; unit.foes = [enemy];
    enemy.team = [enemy]; enemy.foes = [unit];
    const ctx = { rng, tags: new Set(), damageDealt: 0, playerFirst: true };

    engine.runTurn(ctx, [unit], [enemy]);
    assert.strictEqual(calls, 1, 'postTurn pasif harus dipanggil sekali per turn');
  });

  it('Regeneration benar-benar menyembuhkan lewat mesin', () => {
    const rng = rngModule.createRng(6);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    unit.weapon = { passives: [createPassive(15, 100, rng)] };
    unit.stats.hp[0] = engine.maxHp(unit) * 0.5;
    const enemy = engine.buildUnit({ coeffs: COEFFS_WEAK, level: 1 }, rng);
    unit.team = [unit]; unit.foes = [enemy];
    enemy.team = [enemy]; enemy.foes = [unit];

    const before = unit.stats.hp[0];
    const ctx = { rng, tags: new Set(), damageDealt: 0, playerFirst: true };
    engine.runTurn(ctx, [unit], [enemy]);
    assert.ok(unit.stats.hp[0] > before, 'HP naik karena Regeneration');
  });

  it('Energize mengisi WP lewat mesin', () => {
    const rng = rngModule.createRng(6);
    const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    unit.weapon = { passives: [createPassive(16, 100, rng)] };
    unit.stats.wp[0] = 0;
    const enemy = engine.buildUnit({ coeffs: COEFFS_WEAK, level: 1 }, rng);
    unit.team = [unit]; unit.foes = [enemy];
    enemy.team = [enemy]; enemy.foes = [unit];

    const ctx = { rng, tags: new Set(), damageDealt: 0, playerFirst: true };
    engine.runTurn(ctx, [unit], [enemy]);
    assert.ok(unit.stats.wp[0] > 0, 'WP terisi karena Energize');
  });

  it('Rune of the Forgotten menyerang sebagai TRUE damage campuran', () => {
    // TRUE damage tidak dipotong resistensi, jadi target ber-PR tinggi dan
    // ber-PR rendah harus menerima damage yang sama pada seed yang sama.
    const hit = (pr) => {
      const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, weapon: { id: 4, quality: 100 } }, rngModule.createRng(9));
      const target = engine.buildUnit({ coeffs: { ...COEFFS_STRONG, pr }, level: 40 }, rngModule.createRng(9));
      attacker.team = [attacker]; attacker.foes = [target];
      target.team = [target]; target.foes = [attacker];
      const before = target.stats.hp[0];
      const ctx = { rng: rngModule.createRng(4), tags: new Set(), damageDealt: 0, playerFirst: true };
      engine.runTurn(ctx, [attacker], [target]);
      return before - target.stats.hp[0];
    };
    const lowPr = hit(0);
    const highPr = hit(40);
    assert.ok(lowPr > 0, 'target harus menerima damage');
    assert.strictEqual(lowPr, highPr, 'TRUE damage tidak boleh terpengaruh PR');
  });

  it('Rune of the Forgotten memakai STR+MAG, bukan STR saja', () => {
    const attacker = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, weapon: { id: 4, quality: 100 } }, rngModule.createRng(9));
    const target = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rngModule.createRng(9));
    attacker.team = [attacker]; attacker.foes = [target];
    target.team = [target]; target.foes = [attacker];
    const before = target.stats.hp[0];
    const ctx = { rng: rngModule.createRng(4), tags: new Set(), damageDealt: 0, playerFirst: true };
    engine.runTurn(ctx, [attacker], [target]);
    const dealt = before - target.stats.hp[0];
    const strOnly = attacker.stats.att[0] + attacker.stats.att[1];
    assert.ok(dealt > strOnly, `damage ${dealt} harus melebihi serangan STR saja (${strOnly})`);
  });

  it('Defense Up dari dua pemberi bergabung, tidak dobel', () => {
    const rng = rngModule.createRng(1);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const b = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const victim = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    a.team = [a]; a.foes = [victim]; b.team = [a]; b.foes = [victim];
    victim.team = [victim]; victim.foes = [a];
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    engine.bindBuff(ctx, victim, createBuff(4, { quality: 100, from: a, duration: 2, rng }));
    engine.bindBuff(ctx, victim, createBuff(4, { quality: 100, from: b, duration: 2, rng }));
    assert.strictEqual(victim.buffs.filter(x => x.id === 4).length, 1, 'Defense Up harus satu instance');
  });

  it('Flame hanya satu instance; yang lama meledak saat ditimpa', () => {
    const rng = rngModule.createRng(1);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const b = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const victim = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    a.team = [a]; a.foes = [victim]; b.team = [a]; b.foes = [victim];
    victim.team = [victim]; victim.foes = [a];
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    engine.bindBuff(ctx, victim, createBuff(3, { quality: 100, from: a, duration: 3, rng }));
    const before = victim.stats.hp[0];
    engine.bindBuff(ctx, victim, createBuff(3, { quality: 100, from: b, duration: 3, rng }));
    assert.strictEqual(victim.buffs.filter(x => x.id === 3).length, 1, 'Flame harus satu instance');
    assert.ok(victim.stats.hp[0] < before, 'Flame lama harus meledak');
  });

  it('Flame yang menimpa memakai persen dan pemberi dari instance baru', () => {
    const rng = rngModule.createRng(1);
    // Pemberi lama MAG rendah, pemberi baru MAG tinggi, supaya salah sumber
    // langsung terlihat dari besarnya ledakan.
    const weak = engine.buildUnit({ coeffs: { ...COEFFS_STRONG, mag: 1 }, level: 40 }, rng);
    const strong = engine.buildUnit({ coeffs: { ...COEFFS_STRONG, mag: 40 }, level: 40 }, rng);
    const victim = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    weak.team = [weak]; weak.foes = [victim];
    strong.team = [strong]; strong.foes = [victim];
    victim.team = [victim]; victim.foes = [strong];
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    // Ledakan q0 = 60% MAG; q100 = 80% MAG.
    engine.bindBuff(ctx, victim, createBuff(3, { quality: 0, from: weak, duration: 3, rng }));
    const before = victim.stats.hp[0];
    engine.bindBuff(ctx, victim, createBuff(3, { quality: 100, from: strong, duration: 3, rng }));
    const dealt = before - victim.stats.hp[0];
    const expected = strong.stats.mag[0] * 0.8;
    assert.ok(
      dealt > expected * 0.5,
      `ledakan harus memakai MAG pemberi baru (~${Math.round(expected)}), bukan yang lama; dapat ${Math.round(dealt)}`
    );
    assert.ok(dealt > weak.stats.mag[0] * 0.6 * 5, 'tidak boleh memakai stat pemberi lama');
  });

  it('Taunt menumpuk antar instance', () => {
    const rng = rngModule.createRng(1);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const victim = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    engine.bindBuff(ctx, victim, createBuff(1, { quality: 100, from: a, duration: 2, rng }));
    engine.bindBuff(ctx, victim, createBuff(1, { quality: 100, from: a, duration: 2, rng }));
    assert.strictEqual(victim.buffs.filter(x => x.id === 1).length, 2, 'Taunt tidak digabung');
  });

  it('Poison bergabung hanya dari pemberi yang sama', () => {
    const rng = rngModule.createRng(1);
    const a = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const b = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const victim = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rng);
    const ctx = { rng, tags: new Set(), damageDealt: 0 };

    engine.bindBuff(ctx, victim, createBuff(2, { quality: 100, from: a, duration: 3, rng }));
    engine.bindBuff(ctx, victim, createBuff(2, { quality: 100, from: a, duration: 3, rng }));
    assert.strictEqual(victim.buffs.filter(x => x.id === 2).length, 1, 'pemberi sama digabung');
    assert.strictEqual(victim.buffs.find(x => x.id === 2).duration, 6, 'durasi dijumlahkan');

    engine.bindBuff(ctx, victim, createBuff(2, { quality: 100, from: b, duration: 3, rng }));
    assert.strictEqual(victim.buffs.filter(x => x.id === 2).length, 2, 'pemberi beda tidak digabung');
  });

  it('createBuff menerima quality berupa array', () => {
    const single = createBuff(2, { quality: [100, 100] });
    assert.strictEqual(single.stats[0], 65, 'Poison q100 = 65%');
    const flame = createBuff(3, { quality: [100, 100] });
    assert.deepStrictEqual(flame.stats, [40, 80], 'Flame q100 = [40, 80]');
  });

  it('Rune of the Forgotten tidak punya ability aktif, hanya override serangan dasar', () => {
    const rune = data.weapons().find(w => w.id === 4);
    assert.strictEqual(rune.ability.kind, 'none', 'OwO: "does not have an active ability"');
    assert.deepStrictEqual(rune.basicAttack, { kind: 'mixed_true', mixed: [0.65, 0.65] });
    assert.strictEqual(rune.statBoost, 'all');
  });

  it('Rune of the Forgotten tetap menaikkan semua stat', () => {
    const withRune = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, weapon: { id: 4, quality: 100 } }, rngModule.createRng(1));
    const plain = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rngModule.createRng(1));
    for (const key of ['att', 'mag', 'pr', 'mr']) {
      assert.ok(withRune.stats[key][1] > plain.stats[key][1], `${key} harus dapat bonus`);
    }
    assert.ok(withRune.stats.hp[3] > plain.stats.hp[3], 'hp bonus harus naik');
  });

  it('Rune of the Forgotten sesuai deskripsi resmi: 5-15% semua stat, biaya 0, tanpa ability', () => {
    // Deskripsi: "Increase ALL stats by 5-15%, changes physical attacks to 65%
    // STR and 65% MAG as TRUE damage. Does not have an active ability."
    const plain = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40 }, rngModule.createRng(1));
    for (const [q, pct] of [[0, 5], [50, 10], [100, 15]]) {
      const unit = engine.buildUnit({ coeffs: COEFFS_STRONG, level: 40, weapon: { id: 4, quality: q } }, rngModule.createRng(1));
      for (const key of ['att', 'mag', 'pr', 'mr']) {
        // Slot [0] = stat dasar, [1] = bonus dari senjata/pasif.
        const got = (unit.stats[key][0] + unit.stats[key][1]) / plain.stats[key][0];
        assert.ok(Math.abs(got - (1 + pct / 100)) < 1e-9, `${key} q${q} harus +${pct}%, dapat ${((got - 1) * 100).toFixed(2)}%`);
      }
      // hp/wp menyimpan bonus di slot [3] karena dipakai maxHp/maxWp.
      assert.ok(Math.abs(unit.stats.hp[3] / plain.stats.hp[1] - pct / 100) < 1e-9, `hp q${q} +${pct}%`);
      assert.ok(Math.abs(unit.stats.wp[3] / plain.stats.wp[1] - pct / 100) < 1e-9, `wp q${q} +${pct}%`);
      // "Weapon Cost: 0" — tidak ada manaRange, jadi tidak pernah menahan ability.
      assert.strictEqual(unit.weapon.manaCost, 0, 'biaya WP harus 0');
      assert.strictEqual(weaponModule.weaponAbility({ rng: rngModule.createRng(1) }, unit.weapon, unit), false, 'tidak ada ability aktif');
    }
  });

  it('buffQuality memotong kualitas buff setelah entri stat senjata', () => {
    const { buffQuality, manaQuality } = weaponModule;
    // Poison Dagger: 1 entri stat + Poison (1 entri) + biaya → slot ke-2.
    const dagger = data.weapons().find(w => w.id === 8);
    assert.deepStrictEqual(buffQuality(dagger, [70, 90, 50]), [90]);
    // Leeching Scythe: 2 entri stat + Leech (2 entri) + biaya.
    const scythe = data.weapons().find(w => w.id === 20);
    assert.deepStrictEqual(buffQuality(scythe, [10, 20, 30, 40, 50]), [30, 40]);
    // Biaya WP selalu slot terakhir, bukan elemen terakhir array masukan.
    assert.strictEqual(manaQuality(scythe, [10, 20, 30, 40, 50]), 50);
    // Tanpa array (tier tunggal) nilainya diteruskan apa adanya.
    assert.strictEqual(buffQuality(dagger, 100), 100);
    assert.strictEqual(manaQuality(dagger, 100), 100);
  });
});

describe('Resurrection Staff', () => {
  function setup(quality) {
    const rng = rngModule.createRng(3);
    const healer = engine.buildUnit({ label: 'healer', level: 50, coeffs: COEFFS_STRONG, weapon: { id: 14, quality } }, rng);
    const dead = engine.buildUnit({ label: 'mati', level: 50, coeffs: COEFFS_STRONG }, rng);
    const foe = engine.buildUnit({ label: 'foe', level: 50, coeffs: COEFFS_STRONG }, rng);
    dead.stats.hp[0] = 0;
    healer.team = [healer, dead]; healer.foes = [foe];
    dead.team = healer.team; dead.foes = healer.foes;
    foe.team = [foe]; foe.foes = healer.team;
    return { rng, healer, dead, foe, ctx: { rng, tags: new Set(), damageDealt: 0 } };
  }

  it('menghidupkan rekan mati pertama sesuai urutan slot (OwO getDead)', () => {
    const { healer, dead, ctx } = setup(100);
    const second = engine.buildUnit({ label: 'mati2', level: 50, coeffs: COEFFS_STRONG }, ctx.rng);
    second.stats.hp[0] = 0;
    healer.team.push(second);
    weaponModule.weaponAbility(ctx, healer.weapon, healer);
    assert.ok(dead.stats.hp[0] > 0, 'slot pertama dihidupkan');
    assert.strictEqual(second.stats.hp[0], 0, 'slot kedua tidak tersentuh');
  });

  it('menghidupkan rekan yang mati, bukan membuang WP saja', () => {
    const { healer, dead, ctx } = setup(100);
    assert.strictEqual(healer.weapon.manaCost, 300, 'q100 = biaya 300');
    const ok = weaponModule.weaponAbility(ctx, healer.weapon, healer);
    assert.strictEqual(ok, true);
    assert.ok(dead.stats.hp[0] > 0, `HP rekan harus > 0, dapat ${dead.stats.hp[0]}`);
    assert.ok(healer.stats.wp[0] < engine.maxWp(healer), 'WP terpakai');
  });

  it('menyembuhkan 50-80% MAG sesuai quality', () => {
    for (const [q, pct] of [[0, 0.5], [100, 0.8]]) {
      const { healer, dead, ctx } = setup(q);
      const mag = healer.stats.mag[0] + healer.stats.mag[1];
      weaponModule.weaponAbility(ctx, healer.weapon, healer);
      const expected = mag * pct;
      assert.ok(Math.abs(dead.stats.hp[0] - expected) <= 50, `q${q}: HP ${dead.stats.hp[0]} vs harapan ${expected.toFixed(0)} (±50 roll)`);
    }
  });

  it('tidak memakai WP kalau tidak ada rekan yang mati', () => {
    const { healer, dead, ctx } = setup(100);
    dead.stats.hp[0] = engine.maxHp(dead);
    const before = healer.stats.wp[0];
    assert.strictEqual(weaponModule.weaponAbility(ctx, healer.weapon, healer), false);
    assert.strictEqual(healer.stats.wp[0], before, 'WP tidak boleh terbuang');
  });
});

describe("Vanguard's Banner", () => {
  function setup() {
    const rng = rngModule.createRng(11);
    const unit = engine.buildUnit({ label: 'banner', level: 50, coeffs: COEFFS_STRONG, weapon: { id: 16 } }, rng);
    const ally = engine.buildUnit({ label: 'ally', level: 50, coeffs: COEFFS_STRONG }, rng);
    const foe = engine.buildUnit({ label: 'foe', level: 50, coeffs: COEFFS_STRONG }, rng);
    unit.team = [unit, ally]; unit.foes = [foe];
    ally.team = unit.team; ally.foes = unit.foes;
    foe.team = [foe]; foe.foes = unit.team;
    return { rng, unit, ally, foe, ctx: { rng, tags: new Set(), damageDealt: 0 } };
  }

  it('memasang Attack Up ke semua rekan di preTurn, bukan ability aktif', () => {
    const { unit, ally, ctx } = setup();
    assert.strictEqual(weaponModule.weaponAbility(ctx, unit.weapon, unit), false, 'bukan ability aktif');
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    for (const member of [unit, ally]) {
      const buff = member.buffs.find(b => b.id === 6);
      assert.ok(buff, `${member.label} mendapat Attack Up`);
      assert.strictEqual(buff.duration, 2, 'durasi 2 turn sesuai deskripsi');
    }
  });

  it('menaikkan tier ke Attack Up+ setelah buff lama hampir habis', () => {
    const { unit, ctx } = setup();
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    unit.buffs.find(b => b.id === 6).duration = 1;
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    assert.ok(unit.buffs.some(b => b.id === 7), 'tier naik ke Attack Up+');
    assert.ok(!unit.buffs.some(b => b.id === 6), 'Attack Up lama dilepas');
  });

  it('tidak memasang apa pun bila buff masih berjalan atau WP kurang', () => {
    const { unit, ctx } = setup();
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    const before = unit.buffs.filter(b => b.id === 6).length;
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    assert.strictEqual(unit.buffs.filter(b => b.id === 6).length, before, 'tidak menumpuk');

    const poor = setup();
    poor.unit.stats.wp[0] = poor.unit.weapon.manaCost - 1;
    poor.unit.weapon.preTurn(poor.ctx, poor.unit, poor.unit.team, poor.unit.foes);
    assert.strictEqual(poor.unit.buffs.length, 0, 'WP kurang tidak memasang buff');
  });
});

describe('Staff of Purity', () => {
  function setup() {
    const rng = rngModule.createRng(13);
    const unit = engine.buildUnit({ label: 'purity', level: 50, coeffs: COEFFS_STRONG, weapon: { id: 19, quality: 100 } }, rng);
    const ally = engine.buildUnit({ label: 'ally', level: 50, coeffs: COEFFS_STRONG }, rng);
    const foe = engine.buildUnit({ label: 'foe', level: 50, coeffs: COEFFS_STRONG }, rng);
    unit.team = [unit, ally]; unit.foes = [foe];
    ally.team = unit.team; ally.foes = unit.foes;
    foe.team = [foe]; foe.foes = unit.team;
    return { rng, unit, ally, foe, ctx: { rng, tags: new Set(), damageDealt: 0 } };
  }

  it('memakai biaya 250-150 WP dan heal 50-100% MAG', () => {
    const def = data.weapons().find(w => w.id === 19);
    assert.deepStrictEqual(def.manaRange, [250, 150]);
    assert.deepStrictEqual(def.qualityList[0], [50, 100]);
    assert.strictEqual(def.ability.stat, 'mag', 'heal memakai MAG, bukan STR');
  });

  it('melepas debuff rekan, menyembuhkan, lalu memasang Sacred Ward', () => {
    const { unit, ally, ctx } = setup();
    ally.buffs.push(createBuff(2, { quality: 100, from: ally, rng: ctx.rng }));
    ally.stats.hp[0] = engine.maxHp(ally) * 0.4;
    const before = ally.stats.hp[0];

    assert.strictEqual(weaponModule.weaponAbility(ctx, unit.weapon, unit), true);
    assert.ok(!ally.buffs.some(b => b.id === 2), 'debuff dilepas');
    assert.ok(ally.stats.hp[0] > before, 'rekan disembuhkan');
    const ward = ally.buffs.find(b => b.id === 13);
    assert.ok(ward, 'Sacred Ward terpasang');
    assert.strictEqual(ward.duration, 2);
  });

  it('mundur ke serangan fisik bila tidak ada rekan ber-debuff', () => {
    const { unit, ctx } = setup();
    assert.strictEqual(weaponModule.weaponAbility(ctx, unit.weapon, unit), false);
  });
});

describe('Sacred Ward', () => {
  function setup() {
    const rng = rngModule.createRng(17);
    const caster = engine.buildUnit({ label: 'caster', level: 50, coeffs: COEFFS_STRONG }, rng);
    const ally = engine.buildUnit({ label: 'ally', level: 50, coeffs: COEFFS_STRONG }, rng);
    ally.team = [ally, caster]; caster.team = ally.team;
    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    ally.stats.wp[0] = 0;
    engine.bindBuff(ctx, ally, createBuff(13, { quality: 100, from: caster, rng }));
    return { rng, caster, ally, ctx };
  }

  it('menolak debuff, menghabiskan satu stack, dan replenish 15-25% MAG', () => {
    const { rng, caster, ally, ctx } = setup();
    assert.strictEqual(ally.buffs.filter(b => b.id === 13).length, 1);
    engine.bindBuff(ctx, ally, createBuff(2, { quality: 100, from: caster, rng }));

    assert.ok(!ally.buffs.some(b => b.id === 2), 'Poison ditolak');
    assert.strictEqual(ally.buffs.filter(b => b.id === 13).length, 0, 'stack habis');
    const refill = ally.stats.wp[0];
    const maxWp = engine.maxWp(ally);
    assert.ok(refill >= maxWp * 0.15 - 60 && refill <= maxWp * 0.25 + 60, `replenish ${refill} di luar 15-25% dari ${maxWp}`);
  });

  it('tidak menghalangi buff positif', () => {
    const { rng, caster, ally, ctx } = setup();
    engine.bindBuff(ctx, ally, createBuff(4, { quality: 50, from: caster, rng }));
    assert.ok(ally.buffs.some(b => b.id === 4), 'Defense Up tetap masuk');
    assert.strictEqual(ally.buffs.filter(b => b.id === 13).length, 1, 'stack tidak terpakai');
  });
});

describe('Sacrifice', () => {
  it('memakai 50-75% Max HP dan WP sesuai qualityList OwO', () => {
    const rng = rngModule.createRng(5);
    const dead = engine.buildUnit({ label: 'mati', level: 50, coeffs: COEFFS_STRONG }, rng);
    const ally = engine.buildUnit({ label: 'ally', level: 50, coeffs: COEFFS_STRONG }, rng);
    dead.team = [dead, ally]; ally.team = dead.team;
    dead.weapon = { passives: [createPassive(19, 100, rng)], stats: [], def: {}, manaCost: 0 };
    dead.stats.hp[0] = 0;
    ally.stats.hp[0] = 1;
    ally.stats.wp[0] = 0;

    const ctx = { rng, tags: new Set(), damageDealt: 0 };
    dead.weapon.passives[0].postAttacked(ctx, dead, null, 0, 't');

    const maxHp = engine.maxHp(dead);
    const maxWp = engine.maxWp(dead);
    const healed = ally.stats.hp[0] - 1;
    const refilled = ally.stats.wp[0];
    assert.ok(healed >= maxHp * 0.5 - 50 && healed <= maxHp * 0.75 + 50, `heal ${healed} di luar 50-75% dari ${maxHp}`);
    assert.ok(refilled >= maxWp * 0.5 - 50 && refilled <= maxWp * 0.75 + 50, `WP ${refilled} di luar 50-75% dari ${maxWp}`);
  });
});

describe("Defender's Aegis", () => {
  function setup(quality) {
    const rng = rngModule.createRng(7);
    const unit = engine.buildUnit({ label: 'aegis', level: 50, coeffs: COEFFS_STRONG, weapon: { id: 5, quality } }, rng);
    const ally = engine.buildUnit({ label: 'ally', level: 50, coeffs: COEFFS_STRONG }, rng);
    const foe = engine.buildUnit({ label: 'foe', level: 50, coeffs: COEFFS_STRONG }, rng);
    unit.team = [unit, ally]; unit.foes = [foe];
    ally.team = unit.team; ally.foes = unit.foes;
    foe.team = [foe]; foe.foes = unit.team;
    return { rng, unit, ally, foe, ctx: { rng, tags: new Set(), damageDealt: 0 } };
  }

  it('memasang Taunt di awal turn lewat preTurn, bukan ability aktif', () => {
    const { unit, ctx } = setup(100);
    assert.strictEqual(weaponModule.weaponAbility(ctx, unit.weapon, unit), false, 'bukan ability aktif');
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    assert.ok(unit.buffs.some(b => b.id === 1), 'Taunt terpasang');
    assert.ok(unit.stats.wp[0] < engine.maxWp(unit), 'WP terpakai');
  });

  it('tidak memasang Taunt bila WP tidak cukup', () => {
    const { unit, ctx } = setup(0);
    unit.stats.wp[0] = unit.weapon.manaCost - 1;
    unit.weapon.preTurn(ctx, unit, unit.team, unit.foes);
    assert.ok(!unit.buffs.some(b => b.id === 1));
    assert.strictEqual(unit.stats.wp[0], unit.weapon.manaCost - 1, 'WP tidak terpakai');
  });

  it('melewati serangan pada turn saat Taunt baru dipasang', () => {
    const { unit, foe, ctx } = setup(100);
    unit.team = [unit];
    foe.foes = unit.team;
    const hpBefore = foe.stats.hp[0];
    engine.runTurn({ ...ctx, playerFirst: true }, unit.team, foe.team);
    assert.ok(unit.buffs.some(b => b.id === 1), 'Taunt terpasang');
    assert.strictEqual(foe.stats.hp[0], hpBefore, 'tidak menyerang di turn pemasangan');
  });
});
