// Blueprint tim = komposisi inline yang dipakai `d sim`, mis.
//   snail sword crit mtap, snail Aegis 100,50 sac 10,10
// Modul ini menghubungkan tim tersimpan dengan format tersebut.
const data = require('../data/owoBattle');
const passiveData = require('../data/owoPassives');
const dexStore = require('./animalDexStorage');

function aliasOf(entry) {
  return entry?.aliases?.[0] || String(entry?.name || '').toLowerCase();
}

function qualityText(quality) {
  return Array.isArray(quality) ? quality.join(',') : String(quality);
}

function teamToBlueprint(team) {
  const slots = [...(team?.slots || [])].sort((a, b) => a.slot - b.slot);
  if (!slots.length) return { error: 'Tim ini belum punya slot untuk diekspor.' };

  const units = [];
  for (const slot of slots) {
    const animal = slot.animalKey ? dexStore.resolveAnimal(slot.animalKey) : null;
    const animalName = animal?.name || slot.animalKey || slot.label;
    if (!animalName || !data.findAnimal(animalName)) {
      return { error: `Slot ${slot.slot} memakai stat manual/nama hewan yang tidak dikenal; blueprint hanya mendukung hewan dari data battle.` };
    }
    if (slot.custom) {
      return { error: `Slot ${slot.slot} memakai stat manual; blueprint hanya mendukung hewan dari data battle.` };
    }

    let text = `${slot.level || data.DEFAULT_LEVEL} ${animalName}`;
    if (slot.weaponId) {
      const weapon = data.weapons().find(w => w.id === slot.weaponId);
      if (!weapon) return { error: `Slot ${slot.slot}: senjata #${slot.weaponId} tidak dikenal.` };
      text += ` ${aliasOf(weapon)}`;
      if (slot.weaponQuality != null) text += ` ${qualityText(slot.weaponQuality)}`;

      for (const raw of slot.passives || []) {
        const passive = typeof raw === 'object' ? raw : { id: raw };
        const def = passiveData.get(passive.id);
        if (!def) return { error: `Slot ${slot.slot}: pasif #${passive.id} tidak dikenal.` };
        text += ` ${aliasOf(def)}`;
        if (passive.quality != null) text += ` ${qualityText(passive.quality)}`;
      }
    } else if (slot.passives?.length) {
      return { error: `Slot ${slot.slot} punya pasif tanpa senjata.` };
    }
    units.push(text);
  }
  return { blueprint: units.join(', ') };
}

// Spec hasil parseInlineSide → payload setSlot. Hewan yang ada di dex disimpan
// sebagai animalKey; kalau belum tertangkap, koefisien dari data battle dipakai
// sebagai stat manual supaya blueprint tetap bisa dipakai.
function specsToSlots(specs) {
  return specs.map(spec => {
    const dexAnimal = spec.animal ? dexStore.resolveAnimal(spec.animal.name) : null;
    const payload = {
      level: spec.level,
      label: spec.animal?.name || spec.label || null,
      weaponId: spec.weapon?.id ?? null,
      weaponQuality: spec.weapon?.quality ?? null,
      passives: spec.weapon?.passives ?? null,
    };
    if (dexAnimal) payload.animalKey = dexAnimal.nameKey;
    else payload.custom = spec.coeffs;
    return payload;
  });
}

module.exports = { teamToBlueprint, specsToSlots, qualityText, aliasOf };
