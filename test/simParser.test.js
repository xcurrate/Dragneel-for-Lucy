const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const parser = require(path.join(ROOT, 'src/utils/simParser'));
const blueprint = require(path.join(ROOT, 'src/utils/blueprint'));
const { buildWeapon, averageQuality } = require(path.join(ROOT, 'src/services/battleWeapon'));
const { createPassive } = require(path.join(ROOT, 'src/services/battlePassives'));
const { createRng } = require(path.join(ROOT, 'src/services/battleRng'));

describe('parser komposisi inline', () => {
  it('memecah contoh snail sword crit mtap vs Aegis sac', () => {
    const result = parser.parseInlineSide([
      'snail', 'sword', 'crit', 'mtap,',
      'snail', 'Aegis', '100,50', 'sac', '10,10',
    ]);
    assert.ok(!result.error, result.error);
    assert.equal(result.specs.length, 2);

    const [first, second] = result.specs;
    assert.equal(first.animal.name, 'snail');
    assert.equal(first.level, 50);
    assert.equal(first.weapon.id, 1, 'sword = Great Sword');
    assert.deepEqual(first.weapon.passives, [{ id: 12 }, { id: 9 }], 'crit + mana tap');
    assert.equal(first.weapon.quality, undefined, 'quality default dipakai');

    assert.equal(second.weapon.id, 5, 'aegis = Defender\'s Aegis');
    assert.deepEqual(second.weapon.quality, [100, 50], 'quality taunt + biaya WP');
    assert.deepEqual(second.weapon.passives, [{ id: 19, quality: [10, 10] }], 'quality sacrifice');
  });

  it('membaca level di depan hewan', () => {
    const result = parser.parseInlineSide(['100', 'snail']);
    assert.ok(!result.error, result.error);
    assert.equal(result.specs[0].level, 100);
    assert.equal(result.specs[0].weapon, null);
  });

  it('menolak quality di luar 0-100', () => {
    const result = parser.parseInlineSide(['snail', 'sword', '101', 'crit']);
    assert.match(result.error, /0-100/);
  });

  it('menolak jumlah pasif yang tidak sesuai senjata', () => {
    const result = parser.parseInlineSide(['snail', 'sword']);
    assert.match(result.error, /butuh 1-2 pasif/);
  });

  it('stat manual tidak dianggap komposisi inline', () => {
    assert.equal(parser.looksInline(['hp=8,att=6,pr=2,wp=3,mag=5,mr=1']), false);
    assert.equal(parser.looksInline(['snail', 'sword', 'crit']), true);
  });

  it('menerima alias sageguard untuk Safeguard', () => {
    const result = parser.parseInlineSide(['snail', 'rune', 'sageguard']);
    assert.ok(!result.error, result.error);
    assert.deepEqual(result.specs[0].weapon.passives, [{ id: 11 }]);
  });

  it('memisahkan quality 10,10 dari level unit berikutnya', () => {
    const result = parser.parseInlineSide('50 snail gsword 100 crit mtap, 50 snail Aegis 100,50 sac 10,10, 10 snail rune sageguard');
    assert.ok(!result.error, result.error);
    assert.strictEqual(result.specs.length, 3);
    assert.deepEqual(result.specs[1].weapon.passives, [{ id: 19, quality: [10, 10] }]);
    assert.strictEqual(result.specs[2].level, 10);
    assert.deepEqual(result.specs[2].weapon.passives, [{ id: 11 }]);
  });
});

describe('blueprint tim', () => {
  it('tidak menulis quality default 100 saat ekspor', () => {
    const result = blueprint.teamToBlueprint({
      slots: [
        {
          slot: 1, animalKey: 'snail', level: 50, weaponId: 1,
          weaponQuality: 100, passives: [{ id: 12 }, { id: 9 }],
        },
        {
          slot: 2, animalKey: 'snail', level: 50, weaponId: 5,
          weaponQuality: [100, 50], passives: [{ id: 19, quality: [100, 100] }],
        },
      ],
    });
    assert.ok(!result.error, result.error);
    assert.equal(result.blueprint, '50 snail gsword crit mtap, 50 snail aegis 100,50 sac');
  });

  it('mengubah spec menjadi payload slot dan bisa dibaca balik', () => {
    const parsed = parser.parseInlineSide(['50', 'snail', 'gsword', '100', 'crit', 'mtap']);
    assert.ok(!parsed.error, parsed.error);
    const slots = blueprint.specsToSlots(parsed.specs);
    assert.equal(slots[0].level, 50);
    assert.equal(slots[0].weaponId, 1);
    assert.deepEqual(slots[0].passives, [{ id: 12 }, { id: 9 }]);
    assert.ok(slots[0].animalKey || slots[0].custom, 'ada sumber stat');
  });
});

describe('quality per-stat di mesin battle', () => {
  it('passive Sacrifice memakai quality heal dan replenish terpisah', () => {
    const passive = createPassive(19, [10, 10], createRng(1));
    assert.deepEqual(passive.stats, [52.5, 52.5]);
  });

  it('Aegis memakai quality buff dan biaya WP terpisah', () => {
    const weapon = buildWeapon({
      id: 5,
      quality: [100, 50],
      passives: [{ id: 19, quality: [10, 10] }],
    }, createRng(1));
    assert.equal(weapon.manaCost, 200, 'quality 50 dari range 250-150');
    assert.deepEqual(weapon.passives[0].stats, [52.5, 52.5]);
    assert.equal(weapon.qualityAverage, 42.5, '(100+50+10+10)/4');
  });

  it('averageQuality menghitung quality senjata dan pasif', () => {
    assert.equal(averageQuality([100, 50], [{ quality: [10, 10] }]), 42.5);
    assert.equal(averageQuality(80, [{ id: 12 }]), 80, 'pasif tanpa quality ikut scalar senjata');
    assert.equal(averageQuality(undefined, [{ id: 12 }]), 100, 'default tier tertinggi');
  });
});
