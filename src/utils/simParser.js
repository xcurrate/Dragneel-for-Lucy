// Parser komposisi inline untuk `d sim`.
//
// Contoh:
//   snail sword crit mtap, snail Aegis 100,50 sac 10,10 vs 100 snail
//
// Satu unit: [level] <hewan> [senjata [quality...]] [pasif [quality...]]...
// Koma memisahkan unit. Quality berupa satu angka atau daftar angka 0-100
// yang dipisah koma, mis. `Aegis 100,50` (taunt 100, biaya WP 50) dan
// `sac 10,10` (heal 10, replenish 10).
const data = require('../data/owoBattle');
const passiveData = require('../data/owoPassives');
const dexStore = require('./animalDexStorage');

const NUMBER = /^\d+$/;
const NUMBER_LIST = /^\d+(?:\s*,\s*\d+)+$/;
const LEVEL_EQ = /^level=(\d+)$/i;
const STAT_EQ = /^(hp|att|attack|pr|protection|wp|wisdom|mag|magic|mr)=/i;
const STAT_KEYS = ['hp', 'att', 'pr', 'wp', 'mag', 'mr'];

function fromDexAnimal(animal) {
  const stats = animal.stats || {};
  return {
    name: animal.name,
    hp: stats.hp,
    att: stats.attack,
    pr: stats.protection,
    wp: stats.wisdom,
    mag: stats.magic,
    mr: stats.mr,
    dexAnimal: animal,
  };
}

// Hewan battle berasal dari data statis OwO, tetapi hewan hasil tangkapan Lucy
// bisa lebih banyak. Kalau tidak ada di data statis, cari di dex supaya
// komposisi inline dan ekspor blueprint tetap bekerja.
function findAnimal(query) {
  const known = data.findAnimal(query);
  if (known) return known;
  const animal = dexStore.resolveAnimal(query) || dexStore.searchAnimals(query)[0];
  return animal ? fromDexAnimal(animal) : null;
}

function tokenize(input) {
  const text = Array.isArray(input) ? input.join(' ') : String(input ?? '');
  const tokens = [];
  const re = /\d+(?:\s*,\s*\d+)+|\d+|[^\s,]+|,/g;
  let match;
  while ((match = re.exec(text))) tokens.push(match[0]);

  // `sac 10,10, 10 snail` ambigu: regex membaca `10,10, 10` sebagai satu
  // daftar quality. Kalau token berikutnya nama hewan, angka terakhir adalah
  // level unit baru, bukan quality ketiga.
  for (let i = 0; i < tokens.length - 1; i++) {
    const split = /^(\d+(?:\s*,\s*\d+)*),\s*(\d+)$/.exec(tokens[i]);
    if (!split || !findAnimal(tokens[i + 1])) continue;
    tokens.splice(i, 1, split[1], ',', split[2]);
    i += 2;
  }
  return tokens;
}

function parseQuality(token) {
  const values = String(token).split(',').map(value => Number(value.trim()));
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
    return { error: `Quality \`${token}\` harus angka 0-100.` };
  }
  return { quality: values.length === 1 ? values[0] : values };
}

function parseLevel(token) {
  const value = Number(token);
  if (!Number.isInteger(value) || value < 1 || value > data.MAX_LEVEL) return null;
  return value;
}

// Cocokkan nama terpanjang dulu supaya alias multi-kata seperti
// "defender's aegis" atau "mana tap" tidak terpotong jadi satu kata.
function longestMatch(tokens, index, maxWords, lookup) {
  const limit = Math.min(maxWords, tokens.length - index);
  for (let length = limit; length >= 1; length--) {
    const parts = tokens.slice(index, index + length);
    if (parts.includes(',')) continue;
    const found = lookup(parts.join(' '));
    if (found) return { found, length };
  }
  return null;
}

function matchAnimal(tokens, index) {
  return longestMatch(tokens, index, 3, query => findAnimal(query));
}

function matchWeapon(tokens, index) {
  const known = longestMatch(tokens, index, 4, query => data.findWeapon(query));
  if (known) return { ...known, pending: false };
  const pending = longestMatch(tokens, index, 4, query => data.findPendingWeapon(query));
  return pending ? { ...pending, pending: true } : null;
}

function matchPassive(tokens, index) {
  const known = longestMatch(tokens, index, 3, query => passiveData.get(query));
  if (known) return { ...known, pending: false };
  const pending = longestMatch(tokens, index, 3, query => passiveData.findPending(query));
  return pending ? { ...pending, pending: true } : null;
}

function coeffsOf(animal) {
  const coeffs = {};
  for (const key of STAT_KEYS) {
    const value = Number(animal[key]);
    if (!Number.isFinite(value)) return null;
    coeffs[key] = value;
  }
  return coeffs;
}

// Deteksi apakah argumen sisi memang komposisi inline, bukan nama tim/stat
// manual. `hp=8,att=6` sengaja tidak dianggap inline.
function looksInline(input) {
  const tokens = tokenize(input);
  if (!tokens.length) return false;
  if (tokens.some(token => STAT_EQ.test(token))) return false;
  if (tokens.length > 1 && (NUMBER.test(tokens[0]) || LEVEL_EQ.test(tokens[0]))) return true;
  if (tokens.length > 1 && findAnimal(tokens[0])) {
    const next = tokens[1];
    if (data.findWeapon(next) || data.findPendingWeapon(next)) return true;
    if (passiveData.get(next) || passiveData.findPending(next)) return true;
    if (NUMBER.test(next) || NUMBER_LIST.test(next) || LEVEL_EQ.test(next)) return true;
  }
  return tokens.includes(',');
}

function parseInlineSide(input, { defaultLevel = data.DEFAULT_LEVEL, prefix = 'd' } = {}) {
  const tokens = tokenize(input);
  if (!tokens.length) {
    return { error: `Sebutkan hewan. Contoh: \`${prefix} sim snail sword crit mtap vs 100 snail\`.` };
  }

  const units = [];
  let current = null;
  let pending = null;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token === ',') {
      if (!current) return { error: 'Koma tidak boleh di awal atau berurutan.' };
      units.push(current);
      current = null;
      pending = null;
      i++;
      continue;
    }

    if (!current) {
      let level = defaultLevel;
      if (NUMBER.test(token)) {
        const parsed = parseLevel(token);
        if (parsed == null) {
          return { error: `Level \`${token}\` harus 1-${data.MAX_LEVEL}.` };
        }
        level = parsed;
        i++;
        if (i >= tokens.length || tokens[i] === ',') {
          return { error: `Level \`${token}\` harus diikuti nama hewan.` };
        }
      } else {
        const byEq = LEVEL_EQ.exec(token);
        if (byEq) {
          const parsed = parseLevel(byEq[1]);
          if (parsed == null) {
            return { error: `Level \`${byEq[1]}\` harus 1-${data.MAX_LEVEL}.` };
          }
          level = parsed;
          i++;
        }
      }

      const animalMatch = matchAnimal(tokens, i);
      if (!animalMatch) {
        return { error: `Hewan \`${tokens[i]}\` tidak dikenal.` };
      }
      current = { level, animal: animalMatch.found, weapon: null, passives: [] };
      i += animalMatch.length;
      pending = null;
      continue;
    }

    if (NUMBER.test(token)) {
      if (pending === 'weapon' || pending === 'passive') {
        const parsed = parseQuality(token);
        if (parsed.error) return parsed;
        if (pending === 'weapon') {
          current.weapon.quality = parsed.quality;
        } else {
          current.passives[current.passives.length - 1].quality = parsed.quality;
        }
        pending = null;
        i++;
        continue;
      }
      const parsed = parseLevel(token);
      if (parsed == null) {
        return { error: `Level \`${token}\` harus 1-${data.MAX_LEVEL}.` };
      }
      current.level = parsed;
      i++;
      continue;
    }

    if (NUMBER_LIST.test(token)) {
      const parsed = parseQuality(token);
      if (parsed.error) return parsed;
      if (pending === 'weapon') {
        current.weapon.quality = parsed.quality;
      } else if (pending === 'passive') {
        current.passives[current.passives.length - 1].quality = parsed.quality;
      } else {
        return { error: `Quality \`${token}\` harus mengikuti senjata atau pasif.` };
      }
      pending = null;
      i++;
      continue;
    }

    const byEq = LEVEL_EQ.exec(token);
    if (byEq) {
      const parsed = parseLevel(byEq[1]);
      if (parsed == null) {
        return { error: `Level \`${byEq[1]}\` harus 1-${data.MAX_LEVEL}.` };
      }
      current.level = parsed;
      pending = null;
      i++;
      continue;
    }

    if (!current.weapon) {
      const weaponMatch = matchWeapon(tokens, i);
      if (weaponMatch) {
        if (weaponMatch.pending) {
          return { error: `Senjata **${weaponMatch.found.name}** belum punya data simulasi.` };
        }
        current.weapon = { id: weaponMatch.found.id };
        i += weaponMatch.length;
        pending = 'weapon';
        continue;
      }
    }

    const passiveMatch = matchPassive(tokens, i);
    if (passiveMatch) {
      if (!current.weapon) {
        return { error: `Pasif **${passiveMatch.found.name}** butuh senjata.` };
      }
      if (passiveMatch.pending || !passiveData.hasMechanic(passiveMatch.found.id)) {
        return { error: `Pasif **${passiveMatch.found.name}** belum punya mekanik simulasi.` };
      }
      current.passives.push({ id: passiveMatch.found.id });
      i += passiveMatch.length;
      pending = 'passive';
      continue;
    }

    return { error: `Token \`${token}\` tidak dikenal di komposisi.` };
  }

  if (current) units.push(current);
  if (!units.length) return { error: 'Komposisi kosong.' };

  const specs = [];
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const coeffs = coeffsOf(unit.animal);
    if (!coeffs) return { error: `Stat \`${unit.animal.name}\` tidak lengkap.` };

    if (unit.passives.length && !unit.weapon) {
      return { error: `Unit ${index + 1}: pasif butuh senjata.` };
    }
    if (unit.weapon) {
      const def = data.weapons().find(weapon => weapon.id === unit.weapon.id);
      const { min, max } = data.passiveRange(def);
      if (unit.passives.length < min || unit.passives.length > max) {
        const slotText = min === max ? `${max} pasif` : `${min}-${max} pasif`;
        return {
          error: `Unit ${index + 1}: **${def.name}** butuh ${slotText}, kamu menyebut ${unit.passives.length}.`,
        };
      }
    }

    specs.push({
      slot: index + 1,
      label: unit.animal.name,
      level: unit.level,
      coeffs,
      customStats: false,
      animal: unit.animal,
      weapon: unit.weapon
        ? {
          id: unit.weapon.id,
          quality: unit.weapon.quality,
          passives: unit.passives.map(passive => (
            passive.quality == null
              ? { id: passive.id }
              : { id: passive.id, quality: passive.quality }
          )),
        }
        : null,
    });
  }

  return { specs, label: units.map(unit => unit.animal.name).join(' + ') };
}

module.exports = { tokenize, parseQuality, looksInline, parseInlineSide, findAnimal };
