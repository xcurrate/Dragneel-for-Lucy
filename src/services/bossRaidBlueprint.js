// Membaca kartu raid OwO menjadi komposisi inline untuk `d sim`.
// OCR hanya untuk teks; senjata/pasif memakai fingerprint ikon.
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { createWorker } = require('tesseract.js');
const fingerprintData = require('../data/battleIconFingerprints.json');

const ICON_SIZE = 16;
const OCR_SCALE = 4;

const layouts = {
  ringkas: {
    lefts: [1 / 60, 7 / 20, 41 / 60],
    cardWidth: 0.3,
    level: { x: 0.02, y: 0.06, w: 0.96, h: 0.075 },
    name: { x: 0.02, y: 0.135, w: 0.96, h: 0.065 },
    hp: { x: 0.05, y: 0.585, w: 0.9, h: 0.07 },
    rows: [
      { y: [0.7, 0.77], right: [0.38, 0.74], role: 'wp' },
      { y: [0.79, 0.86], left: [0.1, 0.47], right: [0.38, 0.74], role: 'att', rightRole: 'mag' },
      { y: [0.875, 0.945], left: [0.1, 0.47], right: [0.38, 0.74], role: 'pr', rightRole: 'mr', leftPercent: true, rightPercent: true },
    ],
    weapon: { x: 0.665, y: 0.7, size: 80 / 1200 },
    passives: [[0.6722, 0.8056]],
    passiveY: 0.8667,
    passiveSize: 32 / 1200,
  },
  penuh: {
    lefts: [20 / 1536, 526 / 1536, 1030 / 1536],
    cardWidth: 486 / 1536,
    level: { x: 0.02, y: 0.07, w: 0.96, h: 0.065 },
    name: { x: 0.02, y: 0.14, w: 0.96, h: 0.08 },
    hp: { x: 0.05, y: 0.58, w: 0.9, h: 0.09 },
    rows: [
      { y: [0.675, 0.745], right: [0.38, 0.62], role: 'wp' },
      { y: [0.765, 0.835], left: [0.08, 0.32], right: [0.38, 0.62], role: 'att', rightRole: 'pr', rightPercent: true },
      { y: [0.855, 0.925], left: [0.08, 0.32], right: [0.38, 0.62], role: 'mag', rightRole: 'mr', rightPercent: true },
    ],
    weaponX: [0.714, 0.704, 0.706],
    weapon: { y: 0.685, size: 80 / 1536 },
    passives: [[0.718, 0.829], [0.708, 0.819], [0.702, 0.813]],
    passiveY: 0.8353,
    passiveSize: 39 / 1536,
  },
};

const RANKS = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical']);

let workerPromise;
let workerClosed = false;

function normalize(values) {
  const mean = [0, 0, 0];
  for (let i = 0; i < values.length; i += 3) {
    for (let c = 0; c < 3; c++) mean[c] += values[i + c];
  }
  const pixels = values.length / 3;
  for (let c = 0; c < 3; c++) mean[c] /= pixels;
  let variance = 0;
  for (let i = 0; i < values.length; i += 3) {
    for (let c = 0; c < 3; c++) variance += (values[i + c] - mean[c]) ** 2;
  }
  const sd = Math.sqrt(variance / values.length) || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 3) {
    for (let c = 0; c < 3; c++) out[i + c] = (values[i + c] - mean[c]) / sd;
  }
  return out;
}

function histogram(values) {
  const out = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i < values.length; i += 3) {
    const max = Math.max(values[i], values[i + 1], values[i + 2]);
    const min = Math.min(values[i], values[i + 1], values[i + 2]);
    if (max < 38) continue;
    const w = max - min + 1;
    out[0] += values[i] * w;
    out[1] += values[i + 1] * w;
    out[2] += values[i + 2] * w;
    weight += w;
  }
  return weight ? out.map(value => value / weight) : out;
}

function colorDistance(a, b) {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 255;
}

const fingerprints = fingerprintData.items.map(item => {
  const raw = Float32Array.from(Buffer.from(item.data, 'base64'));
  return { ...item, fp: raw, normalized: normalize(raw), histogram: histogram(raw) };
});

function cropPng(image, x, y, w, h) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const width = Math.min(image.width - x0, Math.max(1, Math.round(w)));
  const height = Math.min(image.height - y0, Math.max(1, Math.round(h)));
  const out = new PNG({ width, height });
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const si = ((y0 + cy) * image.width + (x0 + cx)) * 4;
      const di = (cy * width + cx) * 4;
      out.data[di] = image.data[si];
      out.data[di + 1] = image.data[si + 1];
      out.data[di + 2] = image.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

function resizePng(image, size) {
  const out = new PNG({ width: size, height: size });
  const sw = image.width;
  const sh = image.height;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) * sw / size - 0.5;
      const fy = (y + 0.5) * sh / size - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const y0 = Math.max(0, Math.floor(fy));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const ty = Math.min(1, Math.max(0, fy - y0));
      for (let c = 0; c < 3; c++) {
        const p00 = image.data[(y0 * sw + x0) * 4 + c];
        const p10 = image.data[(y0 * sw + x1) * 4 + c];
        const p01 = image.data[(y1 * sw + x0) * 4 + c];
        const p11 = image.data[(y1 * sw + x1) * 4 + c];
        const value = (p00 * (1 - tx) + p10 * tx) * (1 - ty)
          + (p01 * (1 - tx) + p11 * tx) * ty;
        out.data[(y * size + x) * 4 + c] = Math.round(value);
      }
      out.data[(y * size + x) * 4 + 3] = 255;
    }
  }
  return out;
}

function fingerprint(image) {
  return Float32Array.from(resizePng(image, ICON_SIZE).data.filter((_, index) => index % 4 !== 3));
}

function mse(query, candidate) {
  let best = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let sum = 0;
      for (let y = 0; y < ICON_SIZE; y++) {
        for (let x = 0; x < ICON_SIZE; x++) {
          const qi = (y * ICON_SIZE + x) * 3;
          const ci = ((((y + dy + ICON_SIZE) % ICON_SIZE) * ICON_SIZE)
            + ((x + dx + ICON_SIZE) % ICON_SIZE)) * 3;
          sum += (query[qi] - candidate[ci]) ** 2
            + (query[qi + 1] - candidate[ci + 1]) ** 2
            + (query[qi + 2] - candidate[ci + 2]) ** 2;
        }
      }
      best = Math.min(best, sum / (ICON_SIZE * ICON_SIZE * 3));
    }
  }
  return best;
}

function matchIcon(icon, kind) {
  const raw = fingerprint(icon);
  const normalized = normalize(raw);
  const hist = histogram(raw);
  let best = null;
  let second = null;
  for (const item of fingerprints) {
    if (item.kind !== kind) continue;
    const score = mse(normalized, item.normalized) + colorDistance(hist, item.histogram) * 0.35;
    if (!best || score < best.score) {
      second = best;
      best = { id: item.id, name: item.name, score };
    } else if (!second || score < second.score) {
      second = { id: item.id, name: item.name, score };
    }
  }
  return best ? { ...best, margin: second ? second.score - best.score : Infinity } : null;
}

async function getWorker() {
  if (workerClosed) throw new Error('OCR worker sudah ditutup.');
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch(error => { workerPromise = null; throw error; });
  }
  return workerPromise;
}

function preparedPng(image, whiteOnly) {
  const out = new PNG({ width: image.width * OCR_SCALE, height: image.height * OCR_SCALE });
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const si = (y * image.width + x) * 4;
      const r = image.data[si];
      const g = image.data[si + 1];
      const b = image.data[si + 2];
      const white = Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 70;
      const ink = whiteOnly ? white : (0.299 * r + 0.587 * g + 0.114 * b > 140);
      const value = ink ? 0 : 255;
      for (let sy = 0; sy < OCR_SCALE; sy++) {
        for (let sx = 0; sx < OCR_SCALE; sx++) {
          const di = (((y * OCR_SCALE + sy) * out.width) + (x * OCR_SCALE + sx)) * 4;
          out.data[di] = value;
          out.data[di + 1] = value;
          out.data[di + 2] = value;
          out.data[di + 3] = 255;
        }
      }
    }
  }
  return PNG.sync.write(out);
}

let ocrChain = Promise.resolve();

async function recognizeNow(image, whitelist, psm, whiteOnly) {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: String(psm),
  });
  const { data: result } = await worker.recognize(preparedPng(image, whiteOnly));
  return result.text.trim();
}

// Satu worker dipakai semua kartu; antrekan agar parameter OCR tidak saling
// menimpa saat dua permintaan berjalan bersamaan.
function recognize(image, { whitelist, psm = 7, whiteOnly = true } = {}) {
  const job = ocrChain.then(
    () => recognizeNow(image, whitelist, psm, whiteOnly),
    () => recognizeNow(image, whitelist, psm, whiteOnly),
  );
  ocrChain = job.catch(() => {});
  return job;
}

async function recognizeVote(image, { whitelist, psms = [6, 7, 8, 13], whiteOnly = true } = {}) {
  const tally = new Map();
  for (const psm of psms) {
    const text = await recognize(image, { whitelist, psm, whiteOnly });
    const key = text.replace(/\s+/g, ' ').trim();
    if (!key) continue;
    const entry = tally.get(key) || { count: 0, priority: 0 };
    entry.count += 1;
    entry.priority += psm === 8 ? 2 : 1;
    tally.set(key, entry);
  }
  let best = '';
  let bestCount = 0;
  let bestPriority = -1;
  for (const [text, entry] of tally) {
    if (entry.count > bestCount || (entry.count === bestCount && entry.priority > bestPriority)) {
      best = text;
      bestCount = entry.count;
      bestPriority = entry.priority;
    }
  }
  return best;
}

function textGroups(image, { gap = 4, minHeight = 2, minWidth = 5 } = {}) {
  const columns = new Int32Array(image.width);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const si = (y * image.width + x) * 4;
      const r = image.data[si];
      const g = image.data[si + 1];
      const b = image.data[si + 2];
      if (Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 70) columns[x]++;
    }
  }
  const groups = [];
  let start = -1;
  let last = -1;
  for (let x = 0; x < columns.length; x++) {
    if (columns[x] >= minHeight) {
      if (start < 0) start = x;
      last = x;
    } else if (start >= 0 && x - last > gap) {
      groups.push([start, last + 1]);
      start = -1;
    }
  }
  if (start >= 0) groups.push([start, last + 1]);
  return groups.filter(([a, b]) => b - a >= minWidth);
}

function parseInteger(text) {
  const digits = String(text).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function parseHp(text) {
  const match = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(String(text));
  if (!match) return null;
  const current = Number(match[1].replace(/,/g, ''));
  const max = Number(match[2].replace(/,/g, ''));
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(max) || max < 1 || current > max) return null;
  return { current, max };
}

function normalizeName(text) {
  return String(text).replace(/\s+/g, ' ').replace(/[|_]+/g, ' ').trim();
}

function splitName(name) {
  const cleaned = normalizeName(name);
  const match = /^([A-Za-z]+)\s+(.+)$/.exec(cleaned);
  if (match && RANKS.has(match[1].toLowerCase())) {
    return { rank: match[1], animal: match[2].trim() };
  }
  return { rank: null, animal: cleaned };
}

function levelFromOcr(text) {
  const match = /(\d+)\s*$/.exec(String(text));
  return match ? Number(match[1]) : null;
}

async function readCell(region, cardWidth, percent, role) {
  const groups = textGroups(region);
  const wanted = groups.find(([start, end]) => start >= 0.02 * cardWidth && end - start >= 6);
  if (!wanted) return null;
  const cell = cropPng(region, wanted[0] - 3, 0, wanted[1] - wanted[0] + 6, region.height);
  const raw = await recognizeVote(cell, {
    whitelist: percent ? '0123456789%' : '0123456789',
    psms: [6, 7, 8, 13],
  });
  let value = parseInteger(raw);
  if (value == null) return null;
  if (percent && value > 100) value = Number(String(value).slice(0, 2));
  return { role, value };
}

async function readCard(image, layout, index) {
  const cardLeft = layout.lefts[index] * image.width;
  const cardWidth = layout.cardWidth * image.width;

  const levelImage = cropPng(
    image,
    cardLeft + layout.level.x * cardWidth,
    layout.level.y * image.height,
    layout.level.w * cardWidth,
    layout.level.h * image.height,
  );
  const level = levelFromOcr(await recognize(levelImage, {
    whitelist: '0123456789', psm: 7, whiteOnly: false,
  }));

  const nameImage = cropPng(
    image,
    cardLeft + layout.name.x * cardWidth,
    layout.name.y * image.height,
    layout.name.w * cardWidth,
    layout.name.h * image.height,
  );
  const nameText = normalizeName(await recognize(nameImage, {
    whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' -",
    psm: 7, whiteOnly: false,
  }));
  const { rank, animal } = splitName(nameText);

  const hpRegion = cropPng(
    image,
    cardLeft + layout.hp.x * cardWidth,
    layout.hp.y * image.height,
    layout.hp.w * cardWidth,
    layout.hp.h * image.height,
  );
  const hp = parseHp(await recognizeVote(hpRegion, {
    whitelist: '0123456789,/',
    psms: [6, 7],
  }));

  const stats = hp ? { hpCurrent: hp.current, hpMax: hp.max } : {};
  for (const row of layout.rows) {
    const cells = [
      [row.role, Boolean(row.leftPercent), row.left],
      [row.rightRole || row.role, Boolean(row.rightPercent), row.right],
    ];
    for (const [role, percent, range] of cells) {
      if (!range) continue;
      const region = cropPng(
        image,
        cardLeft + range[0] * cardWidth,
        row.y[0] * image.height,
        (range[1] - range[0]) * cardWidth,
        (row.y[1] - row.y[0]) * image.height,
      );
      const cell = await readCell(region, cardWidth, percent, role);
      if (cell) stats[cell.role] = cell.value;
    }
  }

  const weaponX = layout.weaponX ? layout.weaponX[index] : layout.weapon.x;
  const weaponImage = cropPng(
    image,
    cardLeft + weaponX * cardWidth,
    layout.weapon.y * image.height,
    layout.weapon.size * image.width,
    layout.weapon.size * image.width,
  );
  const weapon = matchIcon(weaponImage, 'weapon');
  const passives = [];
  if (weapon) {
    for (const offset of (layout.passives[index] || layout.passives[0])) {
      const passiveImage = cropPng(
        image,
        cardLeft + offset * cardWidth,
        layout.passiveY * image.height,
        layout.passiveSize * image.width,
        layout.passiveSize * image.width,
      );
      const match = matchIcon(passiveImage, 'passive');
      if (match) passives.push(match);
    }
  }

  const complete = stats.hpCurrent != null && stats.hpMax != null
    && ['att', 'pr', 'wp', 'mag', 'mr'].every(key => Number.isFinite(stats[key]))
    && stats.pr <= 100 && stats.mr <= 100;

  return {
    slot: index + 1,
    level,
    rank,
    animal,
    name: nameText,
    stats: complete ? {
      hpCurrent: stats.hpCurrent,
      hpMax: stats.hpMax,
      att: stats.att,
      pr: stats.pr,
      wp: stats.wp,
      mag: stats.mag,
      mr: stats.mr,
    } : null,
    weapon,
    passives,
  };
}

function rawMessage(message) {
  return typeof message?.toJSON === 'function' ? message.toJSON() : message;
}

function collectImageUrls(value, out, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) collectImageUrls(child, out, seen);
    return;
  }
  if (Number(value.type) === 12) {
    for (const item of value.items || []) {
      const url = item?.media?.url;
      if (typeof url === 'string') out.push(url);
    }
    if (typeof value.media?.url === 'string') out.push(value.media.url);
  }
  if (typeof value.image?.url === 'string') out.push(value.image.url);
  if (typeof value.thumbnail?.url === 'string') out.push(value.thumbnail.url);
  for (const [key, child] of Object.entries(value)) {
    if (['media', 'url', 'proxy_url', 'image', 'thumbnail'].includes(key)) continue;
    collectImageUrls(child, out, seen);
  }
}

function attachmentsOf(message, raw) {
  if (message?.attachments?.values) return [...message.attachments.values()];
  return Array.isArray(raw?.attachments) ? raw.attachments : [];
}

// Pesan boss Lucy memakai Components V2, bukan attachment biasa. Ambil gambar
// raid dari media gallery/embed; kalau media memakai attachment://, ganti
// dengan URL attachment aslinya.
function findRaidImageUrl(message) {
  const raw = rawMessage(message);
  const urls = [];
  collectImageUrls(raw?.components, urls, new Set());
  collectImageUrls(raw?.embeds, urls, new Set());
  const attachments = attachmentsOf(message, raw);
  for (const attachment of attachments) {
    if (isImageAttachment(attachment) && typeof attachment.url === 'string') urls.push(attachment.url);
  }
  const resolved = urls.map(url => {
    if (!url.startsWith('attachment://')) return url;
    const name = url.slice('attachment://'.length);
    return attachments.find(attachment => attachment.name === name)?.url || null;
  }).filter(Boolean);
  return resolved.find(url => /(?:raid|boss)/i.test(url)) || resolved[0] || null;
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (String(attachment.contentType || '').startsWith('image/')) return true;
  return /\.(png|jpe?g|webp)$/i.test(attachment.name || '');
}

async function parseBossRaidImage(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  let image;
  try {
    image = PNG.sync.read(buffer);
  } catch {
    return { error: 'Gambar tidak bisa dibaca. Kirim screenshot PNG kartu raid OwO.' };
  }
  if (image.width < 300 || image.height < 150) {
    return { error: 'Gambar terlalu kecil. Kirim kartu raid dengan resolusi asli.' };
  }
  const ratio = image.height / image.width;
  const layout = ratio > 0.475 ? layouts.ringkas : layouts.penuh;
  const cards = [];
  for (let i = 0; i < 3; i++) cards.push(await readCard(image, layout, i));
  return { cards, layout: ratio > 0.475 ? 'ringkas' : 'penuh', width: image.width, height: image.height };
}

function slug(name) {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildBossBlueprint(cards, { prefix = 'd', player = '<tim>' } = {}) {
  const warnings = [];
  const units = [];
  for (const card of cards) {
    if (!card.stats) {
      warnings.push(`Kartu ${card.slot} dilewati: stat final tidak lengkap.`);
      continue;
    }
    const stats = card.stats;
    const parts = [];
    if (card.level != null) parts.push(String(card.level));
    parts.push('??');
    if (card.weapon) {
      parts.push(slug(card.weapon.name));
      for (const passive of card.passives) parts.push(slug(passive.name));
    } else {
      warnings.push(`Kartu ${card.slot}: senjata tidak dikenali, pasif tidak dipakai.`);
    }
    parts.push(`~${stats.hpCurrent}/${stats.hpMax},${stats.att},${stats.pr},${stats.wp},${stats.mag},${stats.mr}`);
    units.push(parts.join(' '));
  }
  if (!units.length) {
    return { error: 'Tidak ada kartu yang bisa dijadikan blueprint.', warnings };
  }
  const blueprint = units.join(', ');
  return {
    blueprint,
    command: `${prefix} sim ${player} vs ${blueprint} -eboss`,
    units,
    warnings,
  };
}

function blueprintText(built, { title = 'Blueprint siap salin' } = {}) {
  // Inline code (satu backtick) bisa disentuh untuk langsung menyalin teks;
  // code block tiga backtick tidak memberi perilaku itu di Discord mobile.
  return [
    `**${title}**`,
    '**Blueprint**',
    `\`${built.blueprint}\``,
    '**Command**',
    `\`${built.command}\``,
  ].join('\n');
}

async function closeBossOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerClosed = true;
  workerPromise = null;
  if (worker) await worker.terminate();
}

module.exports = {
  parseBossRaidImage,
  buildBossBlueprint,
  blueprintText,
  findRaidImageUrl,
  matchIcon,
  closeBossOcrWorker,
  layouts,
};
