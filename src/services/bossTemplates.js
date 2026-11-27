// Template tim untuk mengukur damage terbaik melawan boss raid.
//
// Template disimpan per guild di `guild-settings.json`; template pertama
// bawaan dipakai kalau guild belum pernah mengatur daftar. Setiap template
// disimulasikan dengan seed yang sama agar peringkatnya adil.
const { getGuildSettings, updateGuildSettings } = require('../utils/storage');
const simParser = require('../utils/simParser');
const data = require('../data/owoBattle');
const sim = require('./battleSim');
const emoji = require('./battleEmoji');
const animalDex = require('./animalDex');
const dexStore = require('../utils/animalDexStorage');
const { randomSeed } = require('./battleRng');

const DEFAULT_TEMPLATE = '60 lizard pdagger gslay, 60 void2 pdagger gslay, 60 ellie crune dc';
const MAX_TEMPLATES = 4;
const TEMPLATE_RUNS = 10;
const MAX_TEMPLATE_UNITS = 3;


// Adapter penyimpanan dipisah agar test tidak menulis guild-settings bersama.
const defaultStore = { get: getGuildSettings, update: updateGuildSettings };
let templateStore = defaultStore;

function setTemplateStore(store) {
  templateStore = store || defaultStore;
}

function templatesOf(guildId) {
  const saved = templateStore.get(guildId).battleTemplates;
  if (!Array.isArray(saved)) return [DEFAULT_TEMPLATE];
  return saved.slice(0, MAX_TEMPLATES);
}

function saveTemplates(guildId, list) {
  templateStore.update(guildId, settings => ({
    ...settings,
    battleTemplates: list.slice(0, MAX_TEMPLATES),
  }));
  return templatesOf(guildId);
}

function parseTemplate(text) {
  // Tampilan memakai pemisah ` + `; terima juga saat user menyalin balik.
  const normalized = String(text || '').replace(/\s+\+\s+/g, ', ').trim();
  const parsed = simParser.parseInlineSide(normalized, { prefix: 'd' });
  if (parsed.error) return parsed;
  if (parsed.specs.length < 1 || parsed.specs.length > MAX_TEMPLATE_UNITS) {
    return { error: `Template harus berisi 1-${MAX_TEMPLATE_UNITS} hewan.` };
  }
  return parsed;
}

function dexAnimalFor(spec) {
  const animal = spec.animal;
  if (!animal) return null;
  if (animal.dexAnimal) return animal.dexAnimal;
  if (animal.imageUrl) return animal;
  return dexStore.resolveAnimal(animal.nameKey || animal.name);
}

function formatSpec(spec) {
  const animal = dexAnimalFor(spec);
  const name = spec.animal?.name || spec.label || '??';
  const pet = animal ? emoji.animalEmoji(animal) : '🐾';
  // Emoji pet saja; nama hanya dipakai saat dex tidak punya emoji.
  const parts = [pet === '🐾' ? `🐾${name}` : pet];
  if (spec.weapon) {
    const quality = Number.isFinite(Number(spec.weapon.quality))
      ? Number(spec.weapon.quality)
      : data.DEFAULT_QUALITY;
    parts.push(emoji.rankEmoji(quality), emoji.weaponEmoji(spec.weapon.id, quality));
    for (const passive of spec.weapon.passives || []) {
      const id = passive && typeof passive === 'object' ? passive.id : passive;
      const passiveQuality = passive && typeof passive === 'object' && passive.quality != null
        ? passive.quality
        : quality;
      parts.push(emoji.passiveEmoji(id, passiveQuality));
    }
  }
  return parts.join('');
}

function formatTemplate(text) {
  const parsed = parseTemplate(text);
  if (parsed.error) return text;
  return parsed.specs.map(formatSpec).join(' + ');
}

async function ensureTemplateEmojis(texts) {
  const animals = [];
  for (const text of texts || []) {
    const parsed = parseTemplate(text);
    if (parsed.error) continue;
    for (const spec of parsed.specs) {
      const animal = dexAnimalFor(spec);
      if (animal) animals.push(animal);
    }
  }
  await animalDex.ensureAnimalEmojis(animals);
}

function listTemplates(guildId) {
  return templatesOf(guildId).map((text, index) => ({
    index: index + 1,
    text,
    display: formatTemplate(text),
  }));
}

function addTemplate(guildId, text) {
  const parsed = parseTemplate(text);
  if (parsed.error) return parsed;
  const current = templatesOf(guildId);
  if (current.length >= MAX_TEMPLATES) {
    return { error: `Maksimal ${MAX_TEMPLATES} template. Hapus salah satu dulu.` };
  }
  return { templates: saveTemplates(guildId, [...current, text.trim()]) };
}

function setTemplate(guildId, index, text) {
  const parsed = parseTemplate(text);
  if (parsed.error) return parsed;
  const current = templatesOf(guildId);
  if (!Number.isInteger(index) || index < 1 || index > current.length) {
    return { error: `Nomor template harus 1-${current.length}.` };
  }
  const next = current.slice();
  next[index - 1] = text.trim();
  return { templates: saveTemplates(guildId, next) };
}

function removeTemplate(guildId, index) {
  const current = templatesOf(guildId);
  if (!Number.isInteger(index) || index < 1 || index > current.length) {
    return { error: `Nomor template harus 1-${current.length}.` };
  }
  return { templates: saveTemplates(guildId, current.filter((_, i) => i !== index - 1)) };
}

function resetTemplates(guildId) {
  return { templates: saveTemplates(guildId, [DEFAULT_TEMPLATE]) };
}

function formatDamageRange(damage) {
  const fmt = value => Number(value || 0).toLocaleString('id-ID');
  const min = damage?.playerMin ?? damage?.player ?? 0;
  const max = damage?.playerMax ?? damage?.player ?? 0;
  return `${fmt(min)}–${fmt(max)}`;
}

// Jalankan semua template melawan blueprint boss dan urutkan damage terbesar.
async function simulateTemplates(guildId, blueprint, {
  runs = TEMPLATE_RUNS, seed = randomSeed(),
} = {}) {
  const enemy = simParser.parseInlineSide(blueprint, { prefix: 'd' });
  if (enemy.error) return { error: enemy.error };
  const enemySpecs = enemy.specs.map(spec => ({ ...spec, isBoss: true }));
  const templates = templatesOf(guildId);
  await ensureTemplateEmojis(templates);

  const results = [];
  for (let index = 0; index < templates.length; index++) {
    const parsed = parseTemplate(templates[index]);
    if (parsed.error) continue;
    const result = await sim.simulate(parsed.specs, enemySpecs, { runs, seed });
    results.push({
      index: index + 1,
      text: templates[index],
      display: parsed.specs.map(formatSpec).join(' + '),
      damage: result.damage,
      result,
    });
  }
  results.sort((a, b) => (b.damage?.player || 0) - (a.damage?.player || 0));
  return { results, runs, seed, enemySpecs };
}

function renderTemplateSection(results) {
  if (!results?.length) return null;
  const lines = results.map((entry, i) => (
    `${i + 1}. ${entry.display}: **${formatDamageRange(entry.damage)}** damage`
  ));
  return [
    '__**Template Penghasil Kerusakan Terbaik**__',
    ...lines,
    '-# ℹ️ Ini adalah simulasi L.60 dari HP penuh. Gunakan Copy Command untuk melakukan simulasi yang lebih akurat.',
  ].join('\n');
}

async function sectionForBlueprint(guildId, blueprint, options = {}) {
  const result = await simulateTemplates(guildId, blueprint, options);
  if (result.error) return null;
  return renderTemplateSection(result.results);
}

module.exports = {
  DEFAULT_TEMPLATE,
  MAX_TEMPLATES,
  setTemplateStore,
  TEMPLATE_RUNS,
  templatesOf,
  listTemplates,
  addTemplate,
  setTemplate,
  removeTemplate,
  resetTemplates,
  parseTemplate,
  formatTemplate,
  formatDamageRange,
  simulateTemplates,
  renderTemplateSection,
  sectionForBlueprint,
  ensureTemplateEmojis,
};
