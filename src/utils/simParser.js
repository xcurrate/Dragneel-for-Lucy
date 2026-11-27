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
const STAT_KEYS = ['hp', 'att', 'pr', 'wp', 'mag', 'mr'];
const LEVEL_EQ = /^level=(\d+)$/i;
const RANK_EQ = /^rank=(common|uncommon|rare|epic|legendary|mythical|fabled)$/i;
const STAT_EQ = /^(hp|att|attack|pr|protection|wp|wisdom|mag|magic|mr)=/i;

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
  // `~...` adalah satu token stat final; koma di dalamnya bukan pemisah unit.
  const re = /~[^\s]+|\d+(?:\s*,\s*\d+)+|\d+|[^\s,]+|,/g;
  let match;
  while ((match = re.exec(text))) {
    const token = match[0];
    // Koma pemisah unit yang menempel di akhir `~stat` harus tetap menjadi
    // token koma, bukan bagian dari nilai stat terakhir.
    if (token.startsWith('~') && token.endsWith(',')) {
      tokens.push(token.slice(0, -1), ',');
    } else {
      tokens.push(token);
    }
  }

  // `sac 10,10, 10 snail` ambigu: regex membaca `10,10, 10` sebagai satu
  // daftar quality. Kalau token berikutnya nama hewan, angka terakhir adalah
  // level unit baru, bukan quality ketiga.
  for (let i = 0; i < tokens.length - 1; i++) {
    const split = /^(\d+(?:\s*,\s*\d+)*),\s*(\d+)$/.exec(tokens[i]);
    // Hanya hewan exact yang boleh memicu pemisahan; pencarian longgar bisa
    // salah menganggap alias pasif (mis. `dc`) sebagai hewan.
    const next = tokens[i + 1];
    const nextAnimal = next ? (data.findAnimal(next) || dexStore.resolveAnimal(next)) : null;
    if (!split || !nextAnimal) continue;
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

// Unit tanpa hewan: enam koefisien `hp,att,pr,wp,mag,mr`, mis.
// `19,0,1,1,0,1 aegis fr fr`.
function parseCustomCoeffs(token) {
  if (!NUMBER_LIST.test(token)) return null;
  const values = String(token).split(',').map(Number);
  if (values.length !== STAT_KEYS.length || values.some(value => !Number.isFinite(value))) return null;
  const custom = {};
  STAT_KEYS.forEach((key, i) => { custom[key] = values[i]; });
  return custom;
}

// Stat final dari kartu raid: `~hpCurrent/hpMax,att,pr,wp,mag,mr`.
// Persentase PR/MR adalah angka yang tampil di kartu (0-100), bukan rasio.
function parseFinalStats(token) {
  const raw = String(token).replace(/^~/, '').replace(/,+$/, '').trim();
  const parts = raw.split(',').map(part => part.trim());
  if (parts.length !== 6) {
    return { error: 'Stat final harus `~hpCurrent/hpMax,att,pr,wp,mag,mr`.' };
  }
  const hp = /^(\d+)\/(\d+)$/.exec(parts[0]);
  if (!hp) return { error: 'HP final harus `current/max`, mis. `80160/80160`.' };
  const current = Number(hp[1]);
  const max = Number(hp[2]);
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(max) || max < 1 || current < 0) {
    return { error: 'HP final harus bilangan bulat, max minimal 1.' };
  }
  if (current > max) return { error: 'HP current tidak boleh lebih besar dari max.' };
  const values = parts.slice(1).map(part => Number(part.replace(/%$/, '')));
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    return { error: 'Stat final harus angka non-negatif.' };
  }
  const [att, pr, wp, mag, mr] = values;
  if (pr > 100 || mr > 100) return { error: 'PR dan MR final harus 0-100.' };
  return {
    finalStats: {
      hp: max,
      hpCurrent: current,
      att,
      pr,
      wp,
      mag,
      mr,
    },
  };
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
  if (tokens.some(token => token.startsWith('~') || token === '??')) return true;
  if (tokens.some(token => parseCustomCoeffs(token))) return true;
  if (tokens.some(token => RANK_EQ.test(token))) return true;
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
  let animalRank = null;
  let i = 0;

  while (i < tokens.length) {
    let token = tokens[i];

    if (token === ',') {
      if (!current) return { error: 'Koma tidak boleh di awal atau berurutan.' };
      units.push(current);
      current = null;
      pending = null;
      animalRank = null;
      i++;
      continue;
    }

    if (!current) {
      // Rank hewan opsional, mis. `rank=uncommon 39 rabbit ...` dari kartu raid.
      const rankEq = RANK_EQ.exec(token);
      if (rankEq) {
        animalRank = rankEq[1].toLowerCase();
        i++;
        if (i >= tokens.length || tokens[i] === ',') {
          return { error: 'Rank hewan harus diikuti level/nama hewan.' };
        }
        token = tokens[i];
      }

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

      const custom = parseCustomCoeffs(tokens[i]);
      if (custom) {
        current = { level, animal: null, custom, animalRank, weapon: null, passives: [] };
        i++;
        pending = null;
        continue;
      }

      if (tokens[i] === '??') {
        current = { level, animal: null, unknown: true, animalRank, weapon: null, passives: [] };
        i++;
        pending = null;
        continue;
      }

      const animalMatch = matchAnimal(tokens, i);
      if (!animalMatch) {
        return { error: `Hewan \`${tokens[i]}\` tidak dikenal.` };
      }
      current = { level, animal: animalMatch.found, animalRank, weapon: null, passives: [] };
      i += animalMatch.length;
      pending = null;
      continue;
    }

    if (token.startsWith('~')) {
      const parsed = parseFinalStats(token);
      if (parsed.error) return parsed;
      current.finalStats = parsed.finalStats;
      pending = null;
      i++;
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
    const coeffs = unit.custom || (unit.animal ? coeffsOf(unit.animal) : null);
    if (!coeffs && !unit.finalStats) {
      return { error: `Stat \`${unit.animal ? unit.animal.name : 'custom'}\` tidak lengkap.` };
    }

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

    const label = unit.custom
      ? STAT_KEYS.map(key => unit.custom[key]).join('.')
      : (unit.animal ? unit.animal.name : '??');
    specs.push({
      slot: index + 1,
      label,
      level: unit.level,
      coeffs,
      customStats: Boolean(unit.custom),
      animal: unit.animal || null,
      animalRank: unit.animalRank || null,
      finalStats: unit.finalStats || null,
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

  return {
    specs,
    label: units.map(unit => (
      unit.custom
        ? STAT_KEYS.map(key => unit.custom[key]).join('.')
        : (unit.animal ? unit.animal.name : '??')
    )).join(' + '),
  };
}

module.exports = { tokenize, parseQuality, parseFinalStats, looksInline, parseInlineSide, findAnimal };
