// Penyimpanan tim kustom untuk simulasi battle.
//
// Satu tim = satu baris `teams`; isi slot ada di `team_slots` (maks 3 per tim,
// mengikuti batas OwO). Tim bersifat global per user: tim yang sama dipakai di
// server mana pun. Kolom `guild_id` masih ada demi kompatibilitas skema lama,
// tetapi selalu diisi string kosong dan tidak pernah dipakai untuk memfilter.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MAX_SLOTS = 3;
const MAX_TEAMS = 10;

// Semua tim disimpan pada satu lingkup global; kolom `guild_id` hanya diisi
// nilai ini supaya skema lama tetap valid.
const GLOBAL_SCOPE = '';

let db = null;
let dbPath = null;

function paths() {
  const dir = path.resolve(process.cwd(), 'data');
  return { dir, dbFile: path.join(dir, 'battle-teams.db') };
}

function getDb() {
  const { dir, dbFile } = paths();
  if (db && dbPath === dbFile) return db;
  if (db) { try { db.close(); } catch {} db = null; }
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(dbFile);
  dbPath = dbFile;
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE (guild_id, user_id, name_key)
    );
    CREATE TABLE IF NOT EXISTS team_slots (
      team_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      label TEXT,
      animal_key TEXT,
      custom_hp INTEGER, custom_att INTEGER, custom_pr INTEGER,
      custom_wp INTEGER, custom_mag INTEGER, custom_mr INTEGER,
      level INTEGER NOT NULL DEFAULT 1,
      weapon_id INTEGER,
      weapon_quality INTEGER,
      passives TEXT,
      PRIMARY KEY (team_id, slot),
      FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS active_team (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
  migrateToGlobal(db);
  return db;
}

// Tim dulu dipisah per guild. Saat pertama kali dibuka, satukan baris lama:
// untuk tiap user+nama dipilih satu tim (yang paling baru diperbarui), tim lain
// dibuang beserta slotnya, lalu semua baris ditandai lingkup global.
function migrateToGlobal(database) {
  const legacy = database.prepare('SELECT COUNT(*) AS n FROM teams WHERE guild_id <> ?').get(GLOBAL_SCOPE).n;
  if (!legacy) return;
  database.exec('BEGIN');
  try {
    const duplicates = database.prepare(`
      SELECT user_id, name_key, MAX(id) AS keep_id
      FROM teams GROUP BY user_id, name_key HAVING COUNT(*) > 1
    `).all();
    for (const { user_id, name_key, keep_id } of duplicates) {
      const losers = database.prepare('SELECT id FROM teams WHERE user_id = ? AND name_key = ? AND id <> ?')
        .all(user_id, name_key, keep_id).map(r => r.id);
      for (const id of losers) {
        database.prepare('DELETE FROM team_slots WHERE team_id = ?').run(id);
        database.prepare('DELETE FROM active_team WHERE team_id = ?').run(id);
        database.prepare('DELETE FROM teams WHERE id = ?').run(id);
      }
    }
    database.prepare('UPDATE teams SET guild_id = ? WHERE guild_id <> ?').run(GLOBAL_SCOPE, GLOBAL_SCOPE);

    // Satu baris active_team per user: pertahankan yang menunjuk tim hidup.
    const actives = database.prepare('SELECT rowid, user_id, team_id FROM active_team ORDER BY rowid').all();
    const seen = new Set();
    for (const row of actives) {
      const alive = database.prepare('SELECT 1 FROM teams WHERE id = ?').get(row.team_id);
      if (!alive || seen.has(row.user_id)) {
        database.prepare('DELETE FROM active_team WHERE rowid = ?').run(row.rowid);
        continue;
      }
      seen.add(row.user_id);
      database.prepare('UPDATE active_team SET guild_id = ? WHERE rowid = ?').run(GLOBAL_SCOPE, row.rowid);
    }
    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function keyOf(name) {
  return normalizeName(name).toLowerCase();
}

function rowToSlot(row) {
  const custom = row.custom_hp != null
    ? { hp: row.custom_hp, att: row.custom_att, pr: row.custom_pr, wp: row.custom_wp, mag: row.custom_mag, mr: row.custom_mr }
    : null;
  let passives = null;
  if (row.passives) { try { passives = JSON.parse(row.passives); } catch {} }
  return {
    slot: row.slot,
    label: row.label,
    animalKey: row.animal_key,
    custom,
    level: row.level || 1,
    weaponId: row.weapon_id,
    weaponQuality: row.weapon_quality,
    passives,
  };
}

function rowToTeam(row, slots = []) {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    slots: slots.sort((a, b) => a.slot - b.slot),
  };
}

function listTeams(userId) {
  const rows = getDb().prepare(
    'SELECT * FROM teams WHERE user_id = ? ORDER BY name COLLATE NOCASE'
  ).all(String(userId));
  return rows.map(row => rowToTeam(row, loadSlots(row.id)));
}

function loadSlots(teamId) {
  return getDb().prepare('SELECT * FROM team_slots WHERE team_id = ? ORDER BY slot').all(teamId).map(rowToSlot);
}

function getTeam(userId, name) {
  const row = getDb().prepare(
    'SELECT * FROM teams WHERE user_id = ? AND name_key = ?'
  ).get(String(userId), keyOf(name));
  if (!row) return null;
  return rowToTeam(row, loadSlots(row.id));
}

function getTeamById(teamId) {
  const row = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(Number(teamId));
  if (!row) return null;
  return rowToTeam(row, loadSlots(row.id));
}

function countTeams(userId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM teams WHERE user_id = ?')
    .get(String(userId)).n;
}

function createTeam(userId, name) {
  const clean = normalizeName(name);
  if (!clean) return { error: 'Nama tim tidak boleh kosong.' };
  if (countTeams(userId) >= MAX_TEAMS) {
    return { error: `Sudah mencapai batas ${MAX_TEAMS} tim. Hapus salah satu dulu.` };
  }
  if (getTeam(userId, clean)) return { error: `Tim **${clean}** sudah ada.` };
  const now = Date.now();
  const info = getDb().prepare(
    'INSERT INTO teams (guild_id, user_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(GLOBAL_SCOPE, String(userId), clean, keyOf(clean), now, now);
  return { team: getTeamById(info.lastInsertRowid) };
}

function renameTeam(userId, from, to) {
  const team = getTeam(userId, from);
  if (!team) return { error: `Tim **${from}** tidak ditemukan.` };
  const clean = normalizeName(to);
  if (!clean) return { error: 'Nama baru tidak boleh kosong.' };
  if (getTeam(userId, clean)) return { error: `Tim **${clean}** sudah ada.` };
  getDb().prepare('UPDATE teams SET name = ?, name_key = ?, updated_at = ? WHERE id = ?')
    .run(clean, keyOf(clean), Date.now(), team.id);
  return { team: getTeamById(team.id) };
}

function deleteTeam(userId, name) {
  const team = getTeam(userId, name);
  if (!team) return { error: `Tim **${name}** tidak ditemukan.` };
  const d = getDb();
  d.prepare('DELETE FROM team_slots WHERE team_id = ?').run(team.id);
  d.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
  d.prepare('DELETE FROM active_team WHERE team_id = ?').run(team.id);
  return { team };
}

// Menulis satu slot. `slot` 1..MAX_SLOTS. Data hewan bisa dari dex (`animalKey`)
// atau stat manual (`custom`), tidak keduanya.
function setSlot(userId, teamName, slot, data) {
  const team = getTeam(userId, teamName);
  if (!team) return { error: `Tim **${teamName}** tidak ditemukan.` };
  const index = Number(slot);
  if (!Number.isInteger(index) || index < 1 || index > MAX_SLOTS) {
    return { error: `Slot harus 1-${MAX_SLOTS}.` };
  }
  const custom = data.custom || null;
  if (!data.animalKey && !custom) return { error: 'Isi nama hewan dex atau stat manual.' };
  if (data.animalKey && custom) return { error: 'Pilih salah satu: hewan dex atau stat manual.' };

  const level = Math.max(1, Math.min(1000, Number(data.level) || 1));
  const passives = Array.isArray(data.passives) ? JSON.stringify(data.passives) : null;
  getDb().prepare(`
    INSERT INTO team_slots
      (team_id, slot, label, animal_key, custom_hp, custom_att, custom_pr, custom_wp, custom_mag, custom_mr,
       level, weapon_id, weapon_quality, passives)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, slot) DO UPDATE SET
      label = excluded.label, animal_key = excluded.animal_key,
      custom_hp = excluded.custom_hp, custom_att = excluded.custom_att, custom_pr = excluded.custom_pr,
      custom_wp = excluded.custom_wp, custom_mag = excluded.custom_mag, custom_mr = excluded.custom_mr,
      level = excluded.level, weapon_id = excluded.weapon_id,
      weapon_quality = excluded.weapon_quality, passives = excluded.passives
  `).run(
    team.id, index, data.label || null, data.animalKey || null,
    custom ? custom.hp : null, custom ? custom.att : null, custom ? custom.pr : null,
    custom ? custom.wp : null, custom ? custom.mag : null, custom ? custom.mr : null,
    level, data.weaponId ?? null, data.weaponQuality ?? null, passives
  );
  touch(team.id);
  return { team: getTeamById(team.id) };
}

// Memasang atau mengganti senjata pada slot yang sudah berisi hewan. Hanya
// kolom senjata yang disentuh, jadi level dan stat hewan tidak ikut berubah.
function setWeapon(userId, teamName, slot, { weaponId, weaponQuality = null, passives = null }) {
  const team = getTeam(userId, teamName);
  if (!team) return { error: `Tim **${teamName}** tidak ditemukan.` };
  const index = Number(slot);
  if (!Number.isInteger(index) || index < 1 || index > MAX_SLOTS) {
    return { error: `Slot harus 1-${MAX_SLOTS}.` };
  }
  const entry = team.slots.find(s => s.slot === index);
  if (!entry) return { error: `Slot ${index} masih kosong. Isi hewannya dulu.` };

  getDb().prepare(
    'UPDATE team_slots SET weapon_id = ?, weapon_quality = ?, passives = ? WHERE team_id = ? AND slot = ?'
  ).run(
    weaponId ?? null, weaponQuality ?? null,
    Array.isArray(passives) ? JSON.stringify(passives) : null,
    team.id, index
  );
  touch(team.id);
  return { team: getTeamById(team.id) };
}

function clearSlot(userId, teamName, slot) {
  const team = getTeam(userId, teamName);
  if (!team) return { error: `Tim **${teamName}** tidak ditemukan.` };
  getDb().prepare('DELETE FROM team_slots WHERE team_id = ? AND slot = ?').run(team.id, Number(slot));
  touch(team.id);
  return { team: getTeamById(team.id) };
}

function touch(teamId) {
  getDb().prepare('UPDATE teams SET updated_at = ? WHERE id = ?').run(Date.now(), teamId);
}

function setActiveTeam(userId, name) {
  const team = getTeam(userId, name);
  if (!team) return { error: `Tim **${name}** tidak ditemukan.` };
  getDb().prepare(`
    INSERT INTO active_team (guild_id, user_id, team_id) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET team_id = excluded.team_id
  `).run(GLOBAL_SCOPE, String(userId), team.id);
  return { team };
}

function getActiveTeam(userId) {
  const row = getDb().prepare('SELECT team_id FROM active_team WHERE user_id = ?')
    .get(String(userId));
  if (!row || row.team_id == null) return null;
  return getTeamById(row.team_id);
}

module.exports = {
  MAX_SLOTS,
  MAX_TEAMS,
  getDb,
  normalizeName,
  listTeams,
  getTeam,
  getTeamById,
  createTeam,
  renameTeam,
  setWeapon,
  deleteTeam,
  setSlot,
  clearSlot,
  setActiveTeam,
  getActiveTeam,
};
