const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const catalog = require(path.join(ROOT, 'src/data/battleEmojiCatalog.json'));
const battle = require(path.join(ROOT, 'src/data/owoBattle.json'));
const passives = require(path.join(ROOT, 'src/data/owoPassives.json'));
const pending = require(path.join(ROOT, 'src/data/owoPending.json'));

function ids(tokens) {
  return tokens
    .map(token => /:(\d+)>$/.exec(token || '')?.[1])
    .filter(Boolean);
}

test('katalog emoji memuat 7 rank dan metadata wear', () => {
  assert.deepEqual(catalog.ranks, ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary', 'fabled']);
  assert.equal(catalog.rankEmojis.length, 7);
  assert.deepEqual(Object.keys(catalog.wear), ['pristine', 'fine', 'decent', 'worn']);
  assert.equal(catalog.wear.pristine.buff, 5);
  assert.equal(catalog.wear.fine.buff, 3);
  assert.equal(catalog.wear.decent.buff, 1);
  assert.equal(catalog.wear.worn.buff, 0);
});

test('katalog senjata lengkap dan setiap rank punya token', () => {
  assert.equal(catalog.weapons.length, 32);
  assert.equal(new Set(catalog.weapons.map(w => w.name)).size, 32);
  for (const weapon of catalog.weapons) {
    assert.equal(weapon.emojis.length, 7, weapon.name);
    assert.ok(weapon.genericEmoji, weapon.name);
  }
  const pristine = catalog.weapons.filter(w => w.pristineEmojis);
  assert.equal(pristine.length, 22);
  for (const weapon of pristine) {
    assert.equal(weapon.pristineEmojis.length, 7, weapon.name);
    const missing = weapon.pristineEmojis.filter(Boolean).length;
    if (weapon.name === 'Arcane Scepter') {
      assert.equal(missing, 6);
      assert.match(weapon.pristineEmojiNote, /rare/);
    } else {
      assert.equal(missing, 7, weapon.name);
    }
  }
});

test('katalog pasif lengkap dan setiap rank punya token', () => {
  assert.equal(catalog.passives.length, 30);
  assert.equal(new Set(catalog.passives.map(p => p.name)).size, 30);
  for (const passive of catalog.passives) {
    assert.equal(passive.emojis.length, 7, passive.name);
  }
});

test('data battle memakai token dari katalog', () => {
  const byName = new Map(catalog.weapons.map(w => [w.name, w]));
  for (const weapon of battle.weapons) {
    const source = byName.get(weapon.name);
    assert.ok(source, weapon.name);
    assert.deepEqual(weapon.emojis, source.emojis, weapon.name);
    assert.deepEqual(weapon.pristineEmojis || null, source.pristineEmojis, weapon.name);
  }
  const passiveByName = new Map(catalog.passives.map(p => [p.name, p]));
  for (const passive of passives.passives) {
    assert.deepEqual(passive.emojis, passiveByName.get(passive.name).emojis, passive.name);
  }
  assert.deepEqual(
    pending.passives.map(item => item.name).sort(),
    ['Conserve', 'Purify'],
  );
});

test('tidak ada ID emoji ganda di katalog', () => {
  const all = [
    ...catalog.rankEmojis,
    ...catalog.weapons.flatMap(w => [w.genericEmoji, ...w.emojis, ...(w.pristineEmojis || []).filter(Boolean)]),
    ...catalog.passives.flatMap(p => p.emojis),
  ];
  const allIds = ids(all);
  assert.equal(new Set(allIds).size, allIds.length);
});
