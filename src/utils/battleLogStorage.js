// Penyimpanan log battle untuk tautan berbagi.
//
// Log disimpan di SQLite `data/battle-logs.db`, satu baris per tautan dengan
// ID acak. ID memakai 16 byte heksadesimal sehingga tidak bisa ditebak, dan
// baris kedaluwarsa dibuang saat penulisan berikutnya.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Tautan kedaluwarsa setelah 30 hari. Log hanya berisi data battle, jadi
// menyimpannya lama tidak berbahaya; batas ini menjaga tabel tetap kecil.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;

let db = null;
let dbPath = null;

function paths() {
  const dir = path.resolve(process.cwd(), 'data');
  return { dir, dbFile: path.join(dir, 'battle-logs.db') };
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
    CREATE TABLE IF NOT EXISTS battle_logs (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_battle_logs_expires ON battle_logs (expires_at);
  `);
  return db;
}

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function save(log) {
  const payload = JSON.stringify(log);
  if (Buffer.byteLength(payload, 'utf8') > MAX_BYTES) {
    return { error: 'Log terlalu besar untuk disimpan.' };
  }
  const database = getDb();
  const now = Date.now();
  database.prepare('DELETE FROM battle_logs WHERE expires_at < ?').run(now);
  // Tabrakan ID 128-bit praktis mustahil; satu percobaan ulang sudah cukup.
  let id = newId();
  try {
    database.prepare('INSERT INTO battle_logs (id, payload, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, payload, now, now + TTL_MS);
  } catch {
    id = newId();
    database.prepare('INSERT INTO battle_logs (id, payload, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, payload, now, now + TTL_MS);
  }
  return { id, expiresAt: now + TTL_MS };
}

function get(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return null;
  const row = getDb()
    .prepare('SELECT payload, created_at, expires_at FROM battle_logs WHERE id = ?')
    .get(id);
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  try {
    return { log: JSON.parse(row.payload), createdAt: row.created_at, expiresAt: row.expires_at };
  } catch {
    return null;
  }
}

module.exports = { save, get, newId, TTL_MS, MAX_BYTES };
