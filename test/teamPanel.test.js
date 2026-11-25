const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let dir;
let store;
let teamPanel;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-team-panel-'));
  process.chdir(dir);
  delete require.cache[require.resolve('../src/utils/battleTeamStorage')];
  delete require.cache[require.resolve('../src/ui/teamPanel')];
  store = require('../src/utils/battleTeamStorage');
  teamPanel = require('../src/ui/teamPanel');
});

afterEach(() => {
  process.chdir(ROOT);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ID tim 1-21', () => {
  it('memberi ID berikutnya yang bebas, bukan nomor urut naik terus', () => {
    const a = store.createTeam('u', 'Alpha').team;
    const b = store.createTeam('u', 'Beta').team;
    const c = store.createTeam('u', 'Gamma').team;
    assert.deepEqual([a.slotId, b.slotId, c.slotId], [1, 2, 3]);

    store.deleteTeam('u', '2');
    assert.equal(store.createTeam('u', 'Delta').team.slotId, 2, 'slot ID 2 dipakai ulang');
    assert.equal(store.createTeam('u', 'Epsilon').team.slotId, 4);
  });

  it('menolak tim ke-22 karena ID hanya 1-21', () => {
    for (let i = 1; i <= store.MAX_TEAM_ID; i++) {
      assert.ok(store.createTeam('u', `Tim ${i}`).team, `tim ke-${i}`);
    }
    const extra = store.createTeam('u', 'Kelebihan');
    assert.match(extra.error, /1-21/);
    assert.equal(store.listTeams('u').length, store.MAX_TEAM_ID);
  });

  it('mencari tim lewat ID maupun nama', () => {
    store.createTeam('u', 'Alpha');
    store.createTeam('u', 'Beta');
    assert.equal(store.findTeam('u', '2').name, 'Beta');
    assert.equal(store.findTeam('u', 'beta').name, 'Beta');
    assert.equal(store.findTeam('u', '9'), null);
    assert.equal(store.findTeam('u', ''), null);
  });

  it('ID milik user lain tidak saling bertabrakan', () => {
    const mine = store.createTeam('u1', 'Alpha').team;
    const other = store.createTeam('u2', 'Alpha').team;
    assert.equal(mine.slotId, 1);
    assert.equal(other.slotId, 1);
    assert.equal(store.findTeam('u2', '1').id, other.id);
  });

  it('memberi ID ke tim lama yang belum punya ID', () => {
    store.createTeam('u', 'Lama');
    // Simulasikan database versi sebelumnya: ID dikosongkan.
    store.getDb().prepare('UPDATE teams SET slot_id = NULL WHERE user_id = ?').run('u');
    const backfilled = store.nextFreeSlotId('u');
    assert.equal(backfilled, 1, 'ID lama diisi ulang saat dibuka');
  });
});

describe('panel tim', () => {
  it('menampilkan komposisi tim aktif, bukan daftar nama', () => {
    store.createTeam('u', 'Alpha');
    store.createTeam('u', 'Beta');
    store.setActiveTeam('u', 'Beta');
    const teams = store.listTeams('u');
    const active = store.getActiveTeam('u');
    const payload = teamPanel.panelPayload(teams, teamPanel.indexOfActive(teams, active), 'u', { active });
    const embed = payload.embeds[0].toJSON();
    assert.match(embed.title, /Beta/);
    assert.match(embed.title, /2/, 'ID tim ikut tampil di judul');
    assert.equal(payload.index, 1);
    assert.equal(payload.total, 2);
  });

  it('menyediakan tombol panah, select menu, pilih, ekspor, dan hapus', () => {
    store.createTeam('u', 'Alpha');
    store.createTeam('u', 'Beta');
    const payload = teamPanel.panelPayload(store.listTeams('u'), 0, 'u', {});
    const rows = payload.components.map(row => row.toJSON());
    assert.equal(rows.length, 2, 'select + tombol navigasi untuk user biasa');
    assert.equal(rows[0].components[0].type, 3, 'select menu');
    assert.equal(rows[1].components.length, 5, '◀ pilih ▶ ekspor hapus');
    assert.deepEqual(rows[1].components.map(b => b.label), ['◀', 'Pilih Tim Ini', '▶', 'Ekspor', 'Hapus']);
    assert.equal(rows[1].components[4].style, 4, 'tombol hapus merah');
    assert.equal(rows[1].components[4].emoji.name, '🗑️');
    assert.equal(rows[1].components[3].emoji.name, '📤');
    assert.equal(rows[1].components[1].style, 1, 'tombol pilih biru saat tim belum aktif');
  });

  it('user biasa tidak mendapat tombol toggle senjata', () => {
    store.createTeam('u', 'Alpha');
    const payload = teamPanel.panelPayload(store.listTeams('u'), 0, 'u', { showWeapons: true });
    assert.equal(payload.components.length, 2);
    assert.ok(!payload.components.some(row => row.toJSON().components.some(c => c.custom_id?.startsWith('battle_tm_weapons'))));
  });

  it('toggle senjata menampilkan nama senjata dan pasif seluruh slot', () => {
    store.createTeam('u', 'Alpha');
    const stats = { hp: 8, att: 6, pr: 2, wp: 3, mag: 5, mr: 1 };
    store.setSlot('u', 'Alpha', 1, { custom: stats, level: 50, weaponId: 1, passives: [{ id: 12 }] });
    store.setSlot('u', 'Alpha', 2, { custom: stats, level: 50, weaponId: 4, passives: [{ id: 11 }] });
    const teams = store.listTeams('u');
    const payload = teamPanel.panelPayload(teams, 0, 'u', { showWeapons: true, isDeveloper: true });
    const toggle = payload.components[2].toJSON().components[0];
    const body = JSON.stringify(payload.embeds[0].toJSON());
    assert.equal(toggle.label, 'Senjata: ON');
    assert.equal(toggle.style, 3, 'toggle hijau saat hidup');
    assert.ok(body.includes('Great Sword'), 'nama senjata slot 1');
    assert.ok(body.includes('Rune of the Forgotten'), 'nama senjata slot 2');
    assert.ok(body.includes('Critical'), 'nama pasif ikut tampil');

    store.setTeamWeapons('dev', true);
    const other = teamPanel.panelPayload(store.listTeams('u'), 0, 'u', { isDeveloper: true });
    assert.equal(other.components[2].toJSON().components[0].label, 'Senjata: OFF',
      'preferensi developer tidak menular ke user lain');
    assert.ok(!JSON.stringify(other.embeds[0].toJSON()).includes('Great Sword'));
  });

  it('menandai tim aktif dengan tombol hijau dan bintang di dropdown', () => {
    store.createTeam('u', 'Alpha');
    store.createTeam('u', 'Beta');
    store.setActiveTeam('u', 'Beta');
    const teams = store.listTeams('u');
    const active = store.getActiveTeam('u');
    const payload = teamPanel.panelPayload(teams, teamPanel.indexOfActive(teams, active), 'u', { active });
    const nav = payload.components[1].toJSON().components;
    const menu = payload.components[0].toJSON().components[0];
    assert.equal(nav[1].style, 3, 'tombol pilih hijau untuk tim aktif');
    assert.ok(menu.options[1].label.startsWith('⭐ '), 'opsi tim aktif memakai bintang');
    assert.ok(!menu.options[0].label.startsWith('⭐ '), 'tim lain tanpa bintang');
  });

  it('tombol hapus tetap ada saat user hanya punya satu tim', () => {
    store.createTeam('u', 'Solo');
    const payload = teamPanel.panelPayload(store.listTeams('u'), 0, 'u', {});
    const nav = payload.components[1].toJSON().components;
    assert.deepEqual(nav.map(b => b.label), ['◀', 'Pilih Tim Ini', '▶', 'Ekspor', 'Hapus']);
    assert.equal(nav[0].disabled, true, 'panah mundur mati');
    assert.equal(nav[2].disabled, true, 'panah maju mati');
    assert.ok(!nav[1].disabled, 'pilih tetap bisa dipakai');
    assert.ok(!nav[3].disabled, 'ekspor tetap bisa dipakai');
    assert.ok(!nav[4].disabled, 'hapus tetap bisa dipakai');
    const parsed = teamPanel.parsePanelNav(nav[4].custom_id);
    assert.equal(parsed.kind, 'delete');
    assert.equal(parsed.index, 0);
  });

  it('tombol hapus membawa indeks tim yang sedang ditampilkan', () => {
    store.createTeam('u', 'Alpha');
    store.createTeam('u', 'Beta');
    store.createTeam('u', 'Gamma');
    const payload = teamPanel.panelPayload(store.listTeams('u'), 2, 'u', {});
    const hapus = payload.components[1].toJSON().components[4];
    assert.equal(teamPanel.parsePanelNav(hapus.custom_id).index, 2, 'tim ketiga');
  });

  it('tombol konfirmasi hapus membawa pilihan yes/no', () => {
    const [row] = teamPanel.deleteConfirmComponents('u', 1, 'Beta');
    const buttons = row.toJSON().components;
    assert.deepEqual(buttons.map(b => b.label), ['Hapus Beta', 'Batal']);
    const yes = teamPanel.parsePanelNav(buttons[0].custom_id);
    const no = teamPanel.parsePanelNav(buttons[1].custom_id);
    assert.equal(yes.confirm, 'yes');
    assert.equal(yes.kind, 'delete');
    assert.equal(yes.index, 1);
    assert.equal(no.confirm, 'no');
    assert.equal(teamPanel.parsePanelNav('battle_tm_del:u:1:xx').ok, false);
  });

  it('panah membungkus daftar dan select menu memakai indeks', () => {
    store.createTeam('u', 'Alpha');
    store.createTeam('u', 'Beta');
    store.createTeam('u', 'Gamma');
    const payload = teamPanel.panelPayload(store.listTeams('u'), 0, 'u', {});
    const prev = payload.components[1].toJSON().components[0];
    const next = payload.components[1].toJSON().components[2];
    const pick = payload.components[1].toJSON().components[1];
    const parsedPrev = teamPanel.parsePanelNav(prev.custom_id);
    const parsedNext = teamPanel.parsePanelNav(next.custom_id);
    assert.equal(parsedPrev.index, 2, 'dari tim pertama, ◀ membungkus ke terakhir');
    assert.equal(parsedNext.index, 1);
    assert.equal(teamPanel.parsePanelNav(pick.custom_id).kind, 'pick');
    assert.equal(teamPanel.parsePanelNav(pick.custom_id).index, 0);

    // Select menu ada di dalam action row: components[0].components[0].
    const menu = payload.components[0].toJSON().components[0];
    // Select menu menaruh pilihan di `options`, bukan `components`.
    assert.deepEqual(menu.options.map(o => o.value), ['0', '1', '2']);
    assert.equal(menu.options[0].default, true, 'opsi aktif ditandai');
  });

  it('mengekspor blueprint tim yang sedang ditampilkan', () => {
    const team = store.createTeam('u', 'Alpha').team;
    store.setSlot('u', 'Alpha', 1, { animalKey: 'snail', level: 50, weaponId: 1, weaponQuality: [100], passives: [{ id: 12 }, { id: 9 }] });
    store.setSlot('u', 'Alpha', 2, { animalKey: 'snail', level: 10, weaponId: 4, passives: [{ id: 11 }] });
    const fresh = store.getTeamById(team.id);
    const embed = teamPanel.blueprintEmbed(fresh, { prefix: 'd' }).toJSON();
    assert.match(embed.title, /Blueprint/);
    assert.match(embed.description, /50 snail gsword 100 crit mtap/);
    assert.match(embed.description, /10 snail rune sg/);
  });

  it('menolak customId yang bukan milik panel', () => {
    assert.equal(teamPanel.isTeamPanelNav('battle_tm_prev:u:0'), true);
    assert.equal(teamPanel.isTeamPanelNav('battle_tm_del:u:0'), true);
    assert.equal(teamPanel.isTeamPanelNav('battle_tm_export:u:0'), true);
    assert.equal(teamPanel.isTeamPanelNav('battle_tm_weapons:u:0'), true);
    assert.equal(teamPanel.isTeamPanelNav('battle_tm_del:u:0:yes'), true);
    assert.equal(teamPanel.isTeamPanelNav('battle_team_pick:u:0'), false);
    assert.equal(teamPanel.parsePanelNav('battle_tm_prev').ok, false);
    assert.equal(teamPanel.parsePanelNav('battle_tm_next:u:abc').ok, false);
    assert.equal(teamPanel.parsePanelNav('battle_tm_weapons:u:0').kind, 'weapons');
  });
});
