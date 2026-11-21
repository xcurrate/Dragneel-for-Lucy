const test = require('node:test');
const assert = require('node:assert');

const passives = require('../src/data/owoPassives');

test('memuat 26 pasif dengan id unik', () => {
  const all = passives.all();
  assert.equal(all.length, 26);
  const ids = all.map(p => p.id).sort((a, b) => a - b);
  assert.equal(new Set(ids).size, 26, 'id tidak boleh duplikat');
  // Giant Slayer (22) mengisi celah kosong; Frost Armor (24), Living Hive (25),
  // Adaptation (27), dan Resonance (28) menyusul. Id 23 dan 26 belum dipakai
  // sumber, dan id lama tidak boleh bergeser karena dipakai penyimpanan tim.
  assert.deepEqual(ids, [
    ...Array.from({ length: 22 }, (_, i) => i + 1),
    24, 25, 27, 28,
  ]);
  assert.equal(new Set(all.map(p => p.name)).size, 26, 'nama tidak boleh duplikat');
});

test('setiap pasif punya kategori yang dikenal dan qualityList tidak kosong', () => {
  for (const p of passives.all()) {
    assert.ok(passives.categories[p.category], `${p.name}: kategori ${p.category} tidak dikenal`);
    assert.ok(p.qualityList.length > 0, `${p.name}: qualityList kosong`);
    for (const [min, max] of p.qualityList) {
      assert.ok(Number.isFinite(min) && Number.isFinite(max), `${p.name}: range tidak valid`);
      // Rentang menurun sah bila sumber memang menyebut nilai yang TURUN pada
      // quality tinggi (Swarm: biaya WP 8 -> 2). Wajib ada catatan agar tidak
      // lolos sebagai salah ketik.
      if (min > max) assert.ok(p.qualityNote, `${p.name}: range menurun tanpa qualityNote`);
    }
  }
});

test('statsAt mengikuti interpolasi min + (max-min)*q/100', () => {
  assert.deepEqual(passives.statsAt(passives.get('Strength'), 0), [5]);
  assert.deepEqual(passives.statsAt(passives.get('Strength'), 50), [12.5]);
  assert.deepEqual(passives.statsAt(passives.get('Strength'), 100), [20]);
  // Dua stat (peluang, bonus) pada Critical.
  assert.deepEqual(passives.statsAt(passives.get('Critical'), 50), [20, 37.5]);
  assert.deepEqual(passives.statsAt(passives.get('Sacrifice'), 100), [75, 75]);
});

test('statsAt menjepit quality di luar 0-100', () => {
  assert.deepEqual(passives.statsAt(passives.get('Thorns'), -20), [15]);
  assert.deepEqual(passives.statsAt(passives.get('Thorns'), 999), [35]);
});

test('get menerima id maupun nama tanpa peduli huruf besar/kecil', () => {
  assert.equal(passives.get(7).name, 'Lifesteal');
  assert.equal(passives.get('lifesteal').id, 7);
  assert.equal(passives.get('MANA TAP').id, 9);
  assert.equal(passives.get(999), null);
  assert.equal(passives.get('tidak ada'), null);
});

test('pasif pengubah stat memakai hook alterStats, sisanya hook battle', () => {
  const statPassives = passives.byCategory('stat');
  assert.equal(statPassives.length, 6);
  for (const p of statPassives) assert.deepEqual(p.hooks, ['alterStats'], p.name);
  for (const p of passives.byCategory('damage')) assert.ok(!p.hooks.includes('alterStats'), p.name);
});

test('Knowledge satu-satunya pasif tanpa efek battle', () => {
  assert.equal(passives.byCategory('utility').length, 1);
  const knowledge = passives.get('Knowledge');
  assert.equal(knowledge.category, 'utility');
  assert.deepEqual(knowledge.hooks, []);
});
