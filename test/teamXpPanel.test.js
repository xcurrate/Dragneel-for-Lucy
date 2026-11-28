const test = require('node:test');
const assert = require('node:assert/strict');
const panelModule = require('../src/services/teamXpPanel');

function parsedTeam() {
  return {
    name: 'tim uji',
    streak: 0,
    teamCount: 1,
    isActive: true,
    slots: [
      { slot: 1, label: 'satu', level: 1, xpCurrent: 1000, xpMax: 1001, xpMaxed: false },
    ],
  };
}

test('panel punya tombol impor, forecast, pengaturan, dan info', () => {
  const panel = panelModule.createPanel('user-1', parsedTeam());
  const payload = panelModule.statsPayload(panel);
  const buttons = payload.components[0].components.map(button => button.data.label);
  assert.deepEqual(buttons, ['Impor', 'Prediksi', 'Pengaturan', 'Info']);
  assert.match(payload.embeds[0].data.footer.text, /Streak saat ini/);
});

test('modal pengaturan memuat empat field yang diminta', () => {
  const panel = panelModule.createPanel('user-2', parsedTeam());
  const modal = panelModule.settingsModal(panel).toJSON();
  const labels = modal.components.map(row => row.components[0].label);
  assert.deepEqual(labels, [
    'Battle per hari (1-5760)',
    'Rata-rata XP/hunt',
    'Peluang seri (%)',
    'Streak maksimum (opsional)',
  ]);
});

test('validasi pengaturan menolak nilai di luar batas', () => {
  const panel = panelModule.createPanel('user-3', parsedTeam());
  assert.match(panelModule.parseSettings({ battlesPerDay: 0, avgHuntXp: 0, tieRate: 2, maxStreak: 1 }, panel).error, /1-5760/);
  assert.match(panelModule.parseSettings({ battlesPerDay: 3000, avgHuntXp: -1, tieRate: 2, maxStreak: 1 }, panel).error, /XP\/hunt/);
  assert.match(panelModule.parseSettings({ battlesPerDay: 3000, avgHuntXp: 0, tieRate: 101, maxStreak: 1 }, panel).error, /0-100/);
  const ok = panelModule.parseSettings({ battlesPerDay: 3000, avgHuntXp: 0, tieRate: 2, maxStreak: 100000 }, panel);
  assert.equal(ok.settings.tieRate, 2);
  const empty = panelModule.parseSettings({ battlesPerDay: 3000, avgHuntXp: 0, tieRate: 2, maxStreak: '' }, panel);
  assert.equal(empty.settings.maxStreak, null);
});

test('streak maksimum dari kartu ditampilkan, bukan dipakai sebagai cap', () => {
  const data = parsedTeam();
  data.streak = 10;
  data.streakMax = 500;
  const panel = panelModule.createPanel('user-max', data);
  const payload = panelModule.statsPayload(panel);
  assert.match(payload.embeds[0].data.footer.text, /Streak maks 500/);
  const forecast = panelModule.forecastPayload(panel);
  assert.match(forecast.embeds[0].data.footer.text, /Streak maks [\d.]+/);
});

test('forecast menghasilkan baris level-up dan tombol kembali ke statistik', () => {
  const panel = panelModule.createPanel('user-4', parsedTeam());
  const payload = panelModule.forecastPayload(panel);
  assert.match(payload.embeds[0].data.description, /Key: Lvl/);
  assert.match(payload.embeds[0].data.description, /🆙/);
  const labels = payload.components[0].components.map(button => button.data.label);
  assert.deepEqual(labels, ['Impor', 'Prediksi', 'Pengaturan', 'Info']);
});

test('modal submit mengubah pengaturan panel', async () => {
  const panel = panelModule.createPanel('user-5', parsedTeam());
  const updates = [];
  const values = {
    battles_per_day: '1200',
    avg_xp_hunt: '500',
    tie_rate: '5',
    max_streak: '200000',
  };
  const interaction = {
    customId: `xp_panel:${panel.id}:settings_modal`,
    user: { id: 'user-5' },
    fields: { getTextInputValue: key => values[key] },
    update: async payload => updates.push(payload),
    reply: async () => {},
  };
  await panelModule.handleModal(interaction);
  assert.equal(panel.settings.battlesPerDay, 1200);
  assert.equal(panel.settings.avgHuntXp, 500);
  assert.equal(panel.settings.tieRate, 5);
  assert.equal(panel.settings.maxStreak, 200000);
  assert.equal(updates.length, 1);
});
