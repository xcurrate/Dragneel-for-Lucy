const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const parser = require(path.join(ROOT, 'src/utils/simParser'));
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
