// Data pasif battle OwO (21 pasif), dipakai sebagai acuan fitur simulasi battle.
//
// Sumber: https://github.com/ChristopherBThai/Discord-OwO-Bot (CC BY-NC-SA 4.0),
// dibaca dari `src/commands/commandList/battle/passives/`. Angka di
// `owoPassives.json` sudah diverifikasi dengan menjalankan class aslinya pada
// quality 0/50/100, bukan hasil perkiraan dari dokumentasi.
const data = require('./owoPassives.json');

const byId = new Map();
const byName = new Map();
for (const passive of data.passives) {
  byId.set(passive.id, passive);
  for (const key of [passive.name, ...(passive.aliases || [])]) {
    const k = String(key).toLowerCase();
    if (!byName.has(k)) byName.set(k, passive);
  }
}

// Nilai stat untuk satu quality (0-100). Sama dengan PassiveInterface.toStats,
// tanpa bonus wear karena wear tidak dipakai di simulasi.
function statsAt(passive, quality) {
  const q = Math.min(100, Math.max(0, Number(quality) || 0));
  return passive.qualityList.map(([min, max]) => Math.round((min + (max - min) * (q / 100)) * 100) / 100);
}

function get(idOrName) {
  if (typeof idOrName === 'number') return byId.get(idOrName) || null;
  return byName.get(String(idOrName).toLowerCase()) || null;
}

module.exports = {
  source: data.source,
  sourceLicense: data.sourceLicense,
  categories: data.categories,
  all: () => data.passives,
  byCategory: category => data.passives.filter(p => p.category === category),
  get,
  statsAt,
};
