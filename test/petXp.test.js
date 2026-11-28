const test = require('node:test');
const assert = require('node:assert/strict');
const xp = require('../src/services/petXp');

test('xpForNextLevel memakai 1000 + level^4', () => {
  assert.equal(xp.xpForNextLevel(83), 47459321);
  assert.equal(xp.xpForNextLevel(50), 6251000);
  assert.equal(xp.xpForNextLevel(0), null);
});

test('parseProgress membaca current/max XP dari kartu tim', () => {
  assert.deepEqual(xp.parseProgress('Lvl 83 `[6,602,130/47,459,321]`', 83), {
    current: 6602130, max: 47459321, maxed: false,
  });
  assert.deepEqual(xp.parseProgress('Lvl 100 `[MAX]`', 100), {
    current: null, max: null, maxed: true,
  });
});

test('parseProgress tidak menganggap bracket lain sebagai XP', () => {
  assert.deepEqual(xp.parseProgress('Lvl 82 `[1/2]`', 82), {
    current: null, max: null, maxed: false,
  });
  assert.deepEqual(xp.parseProgress('Lvl 82', 82), {
    current: null, max: null, maxed: false,
  });
});

test('bonusXpForStreak mengikuti kelipatan streak OwO', () => {
  assert.equal(xp.bonusXpForStreak(66856), 0);
  assert.equal(xp.bonusXpForStreak(66860), 3086);
  assert.equal(xp.winXpForNextBattle(66855), 200);
});

test('levelMultiplier memakai catch-up OwO', () => {
  assert.equal(xp.levelMultiplier(89, 89), 1);
  assert.equal(xp.levelMultiplier(83, 89), 2.6);
  assert.equal(xp.levelMultiplier(1, 100), 10);
});

test('estimate menghitung sisa XP, battle, dan hari', () => {
  const result = xp.estimate({ level: 83, xpCurrent: 6602130, xpMax: 47459321 });
  assert.equal(result.remaining, 40857191);
  assert.equal(result.battles, 66870);
  assert.ok(Math.abs(result.days - 22.29) < 0.01);
});

test('estimate membagi XP ke jumlah tim dan memakai streak', () => {
  const result = xp.estimate({ level: 89, xpCurrent: 51987966, xpMax: 62743241 }, {
    teamCount: 4,
    active: true,
    streak: 66855,
    highestLevel: 89,
  });
  assert.equal(result.xpPerBattle, 213.2430766180989);
  assert.equal(result.battles, 50445);
  assert.ok(Math.abs(result.days - 16.815) < 0.01);
});

test('buildEmbed menyusun tabel dan menandai pet MAX', () => {
  const embed = xp.buildEmbed({
    name: 'tim uji',
    teamCount: 2,
    isActive: true,
    slots: [
      { slot: 1, label: 'pig', level: 83, xpCurrent: 6602130, xpMax: 47459321, xpMaxed: false },
      { slot: 2, label: 'cat', level: 100, xpCurrent: null, xpMax: null, xpMaxed: true },
    ],
  }).toJSON();
  assert.match(embed.title, /Estimasi XP/);
  assert.match(embed.description, /pig/);
  assert.match(embed.description, /40\.857\.191/);
  assert.match(embed.description, /1\.001,5/);
  assert.match(embed.description, /MAX/);
  assert.match(embed.description, /40\.800/);
  assert.match(embed.footer.text, /3\.000 battle\/hari/);
});

test('buildEmbed memberi peringatan saat metadata tidak terbaca', () => {
  const embed = xp.buildEmbed({
    name: 'tanpa meta',
    slots: [{ slot: 1, label: 'pig', level: 83, xpCurrent: 6602130, xpMax: 47459321, xpMaxed: false }],
  }).toJSON();
  assert.match(embed.footer.text, /jumlah tim tidak terbaca/);
  assert.match(embed.footer.text, /streak tidak terbaca/);
  assert.match(embed.footer.text, /status tim tidak terbaca/);
});

test('buildEmbed memakai streak untuk average XP per battle', () => {
  const embed = xp.buildEmbed({
    name: 'tim streak',
    streak: 66855,
    teamCount: 4,
    isActive: true,
    slots: [
      { slot: 1, label: 'empty', level: 89, xpCurrent: 51987966, xpMax: 62743241, xpMaxed: false },
      { slot: 2, label: 'for', level: 89, xpCurrent: 54267230, xpMax: 62743241, xpMaxed: false },
      { slot: 3, label: '50k Lucent', level: 89, xpCurrent: 54846705, xpMax: 62743241, xpMaxed: false },
    ],
  }).toJSON();
  assert.match(embed.description, /213,2/);
  assert.match(embed.description, /50\.445/);
  assert.match(embed.footer.text, /streak 66\.855/);
  assert.match(embed.footer.text, /dibagi 4/);
  assert.match(embed.footer.text, /aktif ceil/);
});
