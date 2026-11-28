// Pengaturan panel XP disimpan per user supaya tidak hilang saat panel
// kedaluwarsa atau bot restart.
const fs = require('node:fs');
const path = require('node:path');

function filePath() {
  return path.resolve(process.cwd(), 'data', 'team-xp-settings.json');
}

function readAll() {
  const file = filePath();
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  const file = filePath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function get(userId) {
  const row = readAll()[String(userId)];
  return row && typeof row === 'object' ? { ...row } : null;
}

function set(userId, settings) {
  const all = readAll();
  all[String(userId)] = { ...settings };
  writeAll(all);
  return all[String(userId)];
}

module.exports = { filePath, get, set };
