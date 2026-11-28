// Sekali pakai: render chart senjata/pasif/buff-debuff bergaya tabel.
// Jalankan: node scripts/weapon-chart-image.js
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const battle = require('../src/data/owoBattle');
const { all: allPassives } = require('../src/data/owoPassives');

const OUT = path.join(__dirname, '..', 'WeaponChart2.3-lucy.png');
const WIDTH = 2400;
const MARGIN = 40;
const GAP = 20;

const WEAPON_W = 1180;
const PASSIVE_W = 560;
const BUFF_W = WIDTH - MARGIN * 2 - WEAPON_W - PASSIVE_W - GAP * 2;
const X_WEAPON = MARGIN;
const X_PASSIVE = X_WEAPON + WEAPON_W + GAP;
const X_BUFF = X_PASSIVE + PASSIVE_W + GAP;

const HEADER_H = 196;
const COL_HEADER_H = 64;
const ROW_TOP_GAP = 12;
const COL_BOTTOM_GAP = 14;
const STATS_H = 360;
const FOOTER_H = 76;

const FONT = 'DejaVu Sans';
const MONO = 'DejaVu Sans Mono';
const F_HERO = `bold 54px "${FONT}"`;
const F_SUB = `19px "${FONT}"`;
const F_SMALL = `14px "${FONT}"`;
const F_COL = `bold 25px "${FONT}"`;
const F_ROW_TITLE = `bold 21px "${FONT}"`;
const F_ROW_TITLE_SM = `bold 19px "${FONT}"`;
const F_META = `15px "${FONT}"`;
const F_BODY = `17px "${FONT}"`;
const F_BODY_SM = `16px "${FONT}"`;
const F_BADGE = `bold 12px "${FONT}"`;
const F_STAT_LABEL = `bold 17px "${FONT}"`;
const F_MONO = `14px "${MONO}"`;

const LH_TITLE = 26;
const LH_TITLE_SM = 24;
const LH_META = 21;
const LH_BODY = 23;
const LH_BODY_SM = 22;

const C = {
  bg: '#0b0e14',
  panel: '#11151f',
  panelAlt: '#0e121a',
  row: '#121722',
  rowAlt: '#0f141d',
  border: '#293145',
  borderSoft: '#202738',
  text: '#e6e9f2',
  muted: '#98a2b8',
  dim: '#6f7a92',
  white: '#ffffff',
  weapon: '#5b9dff',
  passive: '#43d9a3',
  buff: '#ffb454',
  debuff: '#ff6b6b',
  disabled: '#ff8a5c',
};

const measureCanvas = createCanvas(10, 10);
const measure = measureCanvas.getContext('2d');

// ---------- formatting ----------

function rangeText(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return '';
  return `${pair[0]}-${pair[1]}%`;
}

function rangesText(list) {
  return (list || []).map(rangeText).filter(Boolean).join(' + ');
}

function statName(stat) {
  return { att: 'STR', mag: 'MAG' }[stat] || String(stat || '').toUpperCase();
}

function typeLabel(type) {
  return {
    PHYSICAL: 'Fisik',
    MAGICAL: 'Magis',
    HEAL: 'Heal',
    TRUE: 'True',
    TAUNT: 'Taunt',
    PASSIVE: 'Pasif',
    BUFF: 'Buff',
    MANA: 'Mana',
    REVIVE: 'Revive',
    DEBUFF: 'Debuff',
    MIXED: 'Mixed',
  }[type] || type || '-';
}

function weaponId(w) {
  if (w.owoId) return w.owoId;
  if (Number(w.id) <= 22) return Number(w.id) + 100;
  return w.id;
}

function buffOf(id) {
  return battle.buffById(id);
}

function buffName(id) {
  return buffOf(id)?.name || '';
}

function weaponDescription(w) {
  if (w.abilityNote) return w.abilityNote;
  const ab = w.ability || {};
  const q0 = rangeText(w.qualityList[0]);
  const q1 = rangeText(w.qualityList[1]);
  const q2 = rangeText(w.qualityList[2]);
  const stat = statName(ab.stat);
  const duration = ab.duration ? ` ${ab.duration} turn` : '';
  const buff = w.buffList?.[0] ? buffOf(w.buffList[0]) : null;
  const bName = buff ? buff.name : 'buff';
  const stack = ab.stacks ? `${ab.stacks} stack ` : '';

  switch (ab.kind) {
    case 'damage_all':
      return `Menyerang semua musuh dengan ${q0} ${stat}.`;
    case 'damage_one':
      return `Menyerang satu musuh dengan ${q0} ${stat}.`;
    case 'damage_all_heal_team':
      return `Menyerang semua musuh ${q0} MAG; total damage dibagi rata sebagai heal ke seluruh tim.`;
    case 'damage_one_buff':
      return `Menyerang satu musuh ${q0} ${stat} lalu memasang ${stack}${bName}${duration}.`;
    case 'damage_one_steal_wp':
      return `Menyerang satu musuh ${q0} MAG, lalu mencuri ${q1} dari damage sebagai WP untuk sekutu dengan WP terendah.`;
    case 'heal_lowest':
      return `Menyembuhkan sekutu dengan HP terendah sebesar ${q0} MAG. Boleh overheal.`;
    case 'heal_all_buff':
      return `Menyembuhkan seluruh tim ${q0} MAG lalu memasang ${bName}${duration}.`;
    case 'replenish_ally':
      return `Mengisi WP sekutu dengan WP terendah sebesar ${q0} MAG. Boleh melebihi batas.`;
    case 'revive':
      return `Menghidupkan rekan pertama yang mati lalu menyembuhkannya ${q0} MAG.`;
    case 'taunt': {
      const reduce = buff && buff.qualityList.length
        ? `damage masuk dikurangi ${rangesText(buff.qualityList)}`
        : 'mengurangi damage masuk';
      return `Memaksa musuh menyerang pemakai${duration}; ${reduce}.`;
    }
    case 'attack_up_chain': {
      const names = (w.buffList || []).map(id => buffName(id)).filter(Boolean);
      return `Memasang ${names.join(' → ')} ke seluruh tim${duration}. Saat buff hampir habis, tier naik.`;
    }
    case 'celebration':
      return `Memakai Celebration pada sekutu HP terendah${duration}. ${buff ? buff.note : ''}`.trim();
    case 'curse_all':
      return `Mengutuk semua musuh${duration}. ${buff ? buff.note : ''}`.trim();
    case 'anniversary':
      return `Tiap ${ab.interval || 4} giliran memasang ${bName}${duration} ke seluruh tim.`;
    case 'bleeding_gaze':
      return `Biaya ${q2} Max HP: satu musuh dipaksa menyerang sekutunya (${q0} efektivitas). Jika sendirian, damage ${q1} MAG.`;
    case 'conduit':
      return `Memindahkan satu debuff musuh ke sekutu dengan buff terbanyak, efektivitas -${q0}, lalu damage ${q1} MAG.`;
    case 'corrupt_buff':
      return `Menurunkan efektivitas buff musuh menjadi ${q0}, lalu buff itu mengenai pemakai sebesar ${q1} STR.`;
    case 'purify':
      return `Membersihkan satu debuff dari rekan acak, heal ${q0} MAG, lalu memasang ${bName}${duration}.`;
    case 'luck_hits':
      return `Menyerang satu musuh ${ab.hits || 5} kali; tiap hit acak fisik/magis memakai ${rangesText(w.qualityList)}.`;
    case 'heavy_arrow':
      return `Memuat Heavy Arrow tanpa WP. Tembakan berikutnya ${q0} STR + ${q1} stack Exposed; WP dibayar saat menembak.`;
    case 'none':
      if (w.name === 'Rune of the Forgotten') {
        return `Serangan dasar 65% STR + 65% MAG sebagai TRUE damage (tembus PR/MR). Tidak ada ability aktif; +${q0} ke semua stat. Status: disabled, tidak bisa di-roll baru.`;
      }
      if (w.name === 'Orb of Potency') {
        return 'Tidak ada ability aktif. Fokus pada slot pasif 2-3; tidak menyerang dengan ability khusus.';
      }
      return 'Tidak ada ability aktif.';
    default:
      return w.sourceText || 'Tidak ada deskripsi ability.';
  }
}

function weaponMeta(w) {
  const pr = battle.passiveRange(w);
  const parts = [`#${weaponId(w)}`, typeLabel(w.type), `WP ${w.manaRange ? `${w.manaRange[0]} → ${w.manaRange[1]}` : '0'}`, `Pasif ${pr.min}-${pr.max}`];
  if (w.qualityList.length) parts.push(`Q ${rangesText(w.qualityList)}`);
  if (w.buffList.length) parts.push(`Buff: ${w.buffList.map(buffName).join(', ')}`);
  if (w.disabled) parts.push('DISABLED');
  return parts.join(' · ');
}

function passiveMeta(p) {
  const parts = [`#${p.id}`, p.category || 'passive'];
  if (p.qualityList.length) parts.push(rangesText(p.qualityList));
  return parts.join(' · ');
}

function buffMeta(b) {
  const parts = [b.debuff ? 'DEBUFF' : 'BUFF'];
  if (b.qualityList.length) parts.push(rangesText(b.qualityList));
  return parts.join(' · ');
}

function buffUsers(b) {
  return battle.weapons()
    .filter(w => (w.buffList || []).includes(b.id))
    .map(w => w.name);
}

// ---------- text ----------

function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

function setFont(ctx, font) {
  ctx.font = font;
}

// ---------- icons ----------

function emojiToken(raw) {
  const m = String(raw || '').match(/<a?:(\w+):(\d+)>/);
  return m ? { name: m[1], id: m[2] } : null;
}

function weaponToken(w) {
  const raw = (w.emojis && w.emojis.length) ? w.emojis[w.emojis.length - 1] : w.defaultEmoji;
  return emojiToken(raw);
}

function passiveToken(p) {
  const raw = (p.emojis && p.emojis.length) ? p.emojis[p.emojis.length - 1] : null;
  return emojiToken(raw);
}

// Emoji efek asli OwO. Semua 19 efek punya token; BUFF_TWEMOJI disiapkan
// sebagai cadangan bila nanti ada efek baru tanpa token publik.
const BUFF_EMOJI = {
  1: '<:taunt:546615322598440960>',
  2: '<:poison:572311805704273920>',
  3: '<:flame:572915106854469633>',
  4: '<:dfup:572988965838258176>',
  5: '<:freeze:618621661486514176>',
  6: '<:attup:618734436506140675>',
  7: '<:attupp:619405867543953408>',
  8: '<:attuppp:619405867548147712>',
  9: '<:mortality:619458869730476042>',
  10: '<:celebration:1080450615806803968>',
  11: '<:leech:1107927378816159754>',
  12: '<:stinky:1154636430937698364>',
  13: '<:sacredward:1478918468182212758>',
  14: '<:wither:1571819762739187722>',
  15: '<:mcurse:1559091907588522054>',
  16: '<:annivblessing:1570881262728781854>',
  17: '<:frostbite:1478912393299103947>',
  18: '<:pest:1478913440541179904>',
  19: '<:exposed:1478945223072551004>',
};

const BUFF_TWEMOJI = {};

function discordIcon(token) {
  return token
    ? { id: token.id, url: `https://cdn.discordapp.com/emojis/${token.id}.png?size=96&quality=lossless` }
    : null;
}

function weaponIcon(w) {
  return discordIcon(weaponToken(w));
}

function passiveIcon(p) {
  return discordIcon(passiveToken(p));
}

function buffIcon(b) {
  const token = emojiToken(BUFF_EMOJI[b.id]);
  if (token) return discordIcon(token);
  const code = BUFF_TWEMOJI[b.id];
  if (code) {
    return {
      id: `twemoji-${code}`,
      url: `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`,
    };
  }
  return null;
}

const iconCache = new Map();
let iconFailures = 0;

async function fetchIcon(icon) {
  if (!icon) return null;
  if (iconCache.has(icon.id)) return iconCache.get(icon.id);
  try {
    const res = await fetch(icon.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    iconCache.set(icon.id, img);
    return img;
  } catch {
    iconFailures += 1;
    iconCache.set(icon.id, null);
    return null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawIcon(ctx, img, x, y, size, label, color) {
  ctx.save();
  ctx.fillStyle = '#080b11';
  roundRect(ctx, x, y, size, size, 9);
  ctx.fill();
  if (img) {
    ctx.save();
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 8);
    ctx.clip();
    ctx.drawImage(img, x + 2, y + 2, size - 4, size - 4);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 8);
    ctx.fill();
    ctx.font = `bold ${Math.round(size * 0.42)}px "${FONT}"`;
    ctx.fillStyle = '#0b0e14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(label || '?').slice(0, 1).toUpperCase(), x + size / 2, y + size / 2 + 1);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, size, size, 9);
  ctx.stroke();
  ctx.restore();
}

function drawBuffIcons(ctx, ids, rightX, y) {
  const size = 22;
  const gap = 5;
  const n = ids.length;
  for (let i = 0; i < n; i += 1) {
    const b = buffOf(ids[i]);
    if (!b) continue;
    const x = rightX - (n - i) * (size + gap);
    drawIcon(ctx, iconCache.get(buffIcon(b)?.id) || null, x, y, size, b.name, b.debuff ? C.debuff : C.buff);
  }
}

// ---------- row layout ----------

function makeWeaponRow(w) {
  const iconSize = 64;
  const textX = 12 + iconSize + 14;
  const textW = WEAPON_W - textX - 14;
  setFont(measure, F_ROW_TITLE);
  const titleLines = wrapText(measure, w.name, textW - 90);
  setFont(measure, F_META);
  const metaLines = wrapText(measure, weaponMeta(w), textW);
  setFont(measure, F_BODY);
  const descLines = wrapText(measure, weaponDescription(w), textW);

  const titleH = titleLines.length * LH_TITLE;
  const metaH = metaLines.length * LH_META;
  const descH = descLines.length * LH_BODY;
  const height = Math.max(iconSize + 24, 12 + titleH + 3 + metaH + 5 + descH + 12);
  return { type: 'weapon', item: w, iconSize, textX, textW, titleLines, metaLines, descLines, height };
}

function makePassiveRow(p) {
  const iconSize = 48;
  const textX = 12 + iconSize + 12;
  const textW = PASSIVE_W - textX - 12;
  setFont(measure, F_ROW_TITLE_SM);
  const titleLines = wrapText(measure, p.name, textW);
  setFont(measure, F_META);
  const metaLines = wrapText(measure, passiveMeta(p), textW);
  setFont(measure, F_BODY_SM);
  const descLines = wrapText(measure, p.summary || p.sourceText || 'Tidak ada deskripsi.', textW);

  const titleH = titleLines.length * LH_TITLE_SM;
  const metaH = metaLines.length * LH_META;
  const descH = descLines.length * LH_BODY_SM;
  const height = Math.max(iconSize + 22, 10 + titleH + 2 + metaH + 5 + descH + 10);
  return { type: 'passive', item: p, iconSize, textX, textW, titleLines, metaLines, descLines, height };
}

function makeBuffRow(b) {
  const iconSize = 48;
  const textX = 12 + iconSize + 12;
  const textW = BUFF_W - textX - 12;
  setFont(measure, F_ROW_TITLE_SM);
  const titleLines = wrapText(measure, b.name, textW - 66);
  setFont(measure, F_META);
  const metaLines = wrapText(measure, buffMeta(b), textW);
  setFont(measure, F_BODY_SM);
  const descLines = wrapText(measure, b.note || 'Tidak ada catatan.', textW);

  const titleH = titleLines.length * LH_TITLE_SM;
  const metaH = metaLines.length * LH_META;
  const descH = descLines.length * LH_BODY_SM;
  const height = Math.max(iconSize + 22, 10 + titleH + 2 + metaH + 5 + descH + 10);
  return { type: 'buff', item: b, iconSize, textX, textW, titleLines, metaLines, descLines, height };
}

// ---------- drawing ----------

function drawColumnHeader(ctx, x, y, width, title, subtitle, color) {
  ctx.fillStyle = '#171c29';
  roundRect(ctx, x, y, width, COL_HEADER_H, 10);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, COL_HEADER_H, 10);
  ctx.stroke();

  ctx.fillStyle = color;
  roundRect(ctx, x, y, 6, COL_HEADER_H, 3);
  ctx.fill();

  ctx.textBaseline = 'top';
  setFont(ctx, F_COL);
  ctx.fillStyle = C.white;
  ctx.fillText(title, x + 22, y + 16);

  setFont(ctx, F_SMALL);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.fillText(subtitle, x + width - 18, y + 23);
  ctx.textAlign = 'left';
}

function drawWeaponRow(ctx, row, x, y, index) {
  const w = row.item;
  ctx.fillStyle = index % 2 ? C.rowAlt : C.row;
  ctx.fillRect(x, y, WEAPON_W, row.height);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + row.height);
  ctx.lineTo(x + WEAPON_W, y + row.height);
  ctx.stroke();

  const icon = weaponIcon(w);
  drawIcon(ctx, iconCache.get(icon?.id) || null, x + 12, y + 12, row.iconSize, w.name, C.weapon);

  let cy = y + 12;
  ctx.textBaseline = 'top';
  setFont(ctx, F_ROW_TITLE);
  ctx.fillStyle = C.white;
  for (const line of row.titleLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_TITLE;
  }

  cy += 3;
  setFont(ctx, F_META);
  ctx.fillStyle = C.muted;
  for (const line of row.metaLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_META;
  }

  cy += 5;
  setFont(ctx, F_BODY);
  ctx.fillStyle = C.text;
  for (const line of row.descLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_BODY;
  }

  if (w.buffList.length) drawBuffIcons(ctx, w.buffList, x + WEAPON_W - 12, y + 12);
}

function drawPassiveRow(ctx, row, x, y, index) {
  const p = row.item;
  ctx.fillStyle = index % 2 ? C.rowAlt : C.row;
  ctx.fillRect(x, y, PASSIVE_W, row.height);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + row.height);
  ctx.lineTo(x + PASSIVE_W, y + row.height);
  ctx.stroke();

  const icon = passiveIcon(p);
  drawIcon(ctx, iconCache.get(icon?.id) || null, x + 12, y + 10, row.iconSize, p.name, C.passive);

  let cy = y + 10;
  ctx.textBaseline = 'top';
  setFont(ctx, F_ROW_TITLE_SM);
  ctx.fillStyle = C.white;
  for (const line of row.titleLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_TITLE_SM;
  }

  cy += 2;
  setFont(ctx, F_META);
  ctx.fillStyle = C.muted;
  for (const line of row.metaLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_META;
  }

  cy += 5;
  setFont(ctx, F_BODY_SM);
  ctx.fillStyle = C.text;
  for (const line of row.descLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_BODY_SM;
  }
}

function drawBuffRow(ctx, row, x, y, index) {
  const b = row.item;
  ctx.fillStyle = index % 2 ? C.rowAlt : C.row;
  ctx.fillRect(x, y, BUFF_W, row.height);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + row.height);
  ctx.lineTo(x + BUFF_W, y + row.height);
  ctx.stroke();

  const icon = buffIcon(b);
  drawIcon(ctx, iconCache.get(icon?.id) || null, x + 12, y + 10, row.iconSize, b.name, b.debuff ? C.debuff : C.buff);

  let cy = y + 10;
  ctx.textBaseline = 'top';
  setFont(ctx, F_ROW_TITLE_SM);
  ctx.fillStyle = b.debuff ? '#ff8f8f' : '#ffd08a';
  for (const line of row.titleLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_TITLE_SM;
  }

  // Badge BUFF/DEBUFF di kanan atas.
  const badge = b.debuff ? 'DEBUFF' : 'BUFF';
  setFont(ctx, F_BADGE);
  const bw = ctx.measureText(badge).width + 14;
  const bh = 19;
  const bx = x + BUFF_W - 12 - bw;
  const by = y + 10;
  ctx.fillStyle = b.debuff ? C.debuff : C.buff;
  roundRect(ctx, bx, by, bw, bh, 7);
  ctx.fill();
  ctx.fillStyle = '#0b0e14';
  ctx.fillText(badge, bx + 7, by + 3);

  cy += 2;
  setFont(ctx, F_META);
  ctx.fillStyle = C.muted;
  for (const line of row.metaLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_META;
  }

  cy += 5;
  setFont(ctx, F_BODY_SM);
  ctx.fillStyle = C.text;
  for (const line of row.descLines) {
    ctx.fillText(line, x + row.textX, cy);
    cy += LH_BODY_SM;
  }
}

function drawColumnPanel(ctx, x, y, width, height) {
  ctx.fillStyle = C.panel;
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 12);
  ctx.stroke();
}

function drawHeader(ctx) {
  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEADER_H);
  grad.addColorStop(0, '#151d2e');
  grad.addColorStop(1, '#0b0e14');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEADER_H);

  ctx.textBaseline = 'top';
  setFont(ctx, F_HERO);
  ctx.fillStyle = C.white;
  const title = 'LUCY BATTLE CHART';
  const titleW = ctx.measureText(title).width;
  ctx.fillText(title, MARGIN, 46);

  // Badge versi.
  const badge = 'v2.3-lucy';
  setFont(ctx, `bold 16px "${FONT}"`);
  const bw = ctx.measureText(badge).width + 20;
  ctx.fillStyle = C.weapon;
  roundRect(ctx, MARGIN + titleW + 16, 58, bw, 28, 8);
  ctx.fill();
  ctx.fillStyle = '#0b0e14';
  ctx.fillText(badge, MARGIN + titleW + 26, 64);

  setFont(ctx, F_SUB);
  ctx.fillStyle = C.muted;
  ctx.fillText('Senjata · Pasif · Buff/Debuff — data owoBattle.json + owoPassives.json', MARGIN, 114);

  setFont(ctx, F_SMALL);
  ctx.fillStyle = C.dim;
  ctx.fillText('Quality q0-q100 · TRUE damage tembus PR/MR · deskripsi mengikuti ability/note di data', MARGIN, 146);

  const counts = [
    ['SENJATA', battle.weapons().length, C.weapon],
    ['PASIF', allPassives().length, C.passive],
    ['BUFF/DEBUFF', battle.buffs().length, C.buff],
  ];
  let cx = WIDTH - MARGIN - 430;
  for (const [label, n, color] of counts) {
    setFont(ctx, F_SMALL);
    ctx.fillStyle = C.muted;
    ctx.fillText(label, cx, 60);
    setFont(ctx, `bold 30px "${FONT}"`);
    ctx.fillStyle = color;
    ctx.fillText(String(n), cx, 80);
    cx += 145;
  }
}

function drawStats(ctx, x, y, width) {
  ctx.fillStyle = C.panel;
  roundRect(ctx, x, y, width, STATS_H, 12);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, STATS_H, 12);
  ctx.stroke();

  ctx.textBaseline = 'top';
  setFont(ctx, F_COL);
  ctx.fillStyle = C.white;
  ctx.fillText('STAT & FORMULA', x + 22, y + 16);

  setFont(ctx, F_SMALL);
  ctx.fillStyle = C.muted;
  ctx.fillText('Stat dasar level 1-1000; quality hanya menggeser nilai min-max.', x + 22, y + 48);

  const stats = [
    ['HP', battle.formulas.hp],
    ['STR', battle.formulas.att],
    ['PR', battle.formulas.pr],
    ['WP', battle.formulas.wp],
    ['MAG', battle.formulas.mag],
    ['MR', battle.formulas.mr],
  ];
  const boxW = (width - 44 - 2 * 18) / 3;
  const boxH = 62;
  for (let i = 0; i < stats.length; i += 1) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const bx = x + 22 + col * (boxW + 18);
    const by = y + 78 + row * (boxH + 12);
    ctx.fillStyle = C.panelAlt;
    roundRect(ctx, bx, by, boxW, boxH, 8);
    ctx.fill();
    setFont(ctx, F_STAT_LABEL);
    ctx.fillStyle = C.text;
    ctx.fillText(stats[i][0], bx + 12, by + 10);
    setFont(ctx, F_MONO);
    ctx.fillStyle = C.muted;
    ctx.fillText(stats[i][1], bx + 12, by + 33);
  }

  const notes = [
    'Quality: min + (max - min) × quality / 100.',
    `Damage: ${battle.formulas.damage}.`,
    `Resistance: ${battle.formulas.resistance}.`,
    'Tanpa senjata: serangan dasar 100% STR ke musuh acak.',
    'Status disabled: Rune of the Forgotten, Rune of Celebration, Rune of Luck.',
    'Ikon efek: 19 emoji OwO.',
  ];
  setFont(ctx, F_SMALL);
  ctx.fillStyle = C.dim;
  let ny = y + 78 + 2 * (boxH + 12) + 4;
  for (const line of notes) {
    ctx.fillText(line, x + 22, ny);
    ny += 19;
  }
}

// ---------- main ----------

async function main() {
  const weapons = battle.weapons();
  const passives = allPassives();
  const buffs = battle.buffs();

  const weaponRows = weapons.map(makeWeaponRow);
  const passiveRows = passives.map(makePassiveRow);
  const buffRows = buffs.map(makeBuffRow);

  const weaponH = weaponRows.reduce((n, r) => n + r.height, 0);
  const passiveH = passiveRows.reduce((n, r) => n + r.height, 0);
  const buffH = buffRows.reduce((n, r) => n + r.height, 0);
  const rowsTop = HEADER_H + COL_HEADER_H + ROW_TOP_GAP;
  const columnsH = Math.max(weaponH, passiveH, buffH);
  const statsY = rowsTop + columnsH + 30;
  const totalH = statsY + STATS_H + FOOTER_H;

  const canvas = createCanvas(WIDTH, totalH);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, WIDTH, totalH);

  drawHeader(ctx);

  // Panel kolom.
  drawColumnPanel(ctx, X_WEAPON, HEADER_H, WEAPON_W, COL_HEADER_H + ROW_TOP_GAP + weaponH + COL_BOTTOM_GAP);
  drawColumnPanel(ctx, X_PASSIVE, HEADER_H, PASSIVE_W, COL_HEADER_H + ROW_TOP_GAP + passiveH + COL_BOTTOM_GAP);
  drawColumnPanel(ctx, X_BUFF, HEADER_H, BUFF_W, COL_HEADER_H + ROW_TOP_GAP + buffH + COL_BOTTOM_GAP);

  drawColumnHeader(ctx, X_WEAPON, HEADER_H, WEAPON_W, 'WEAPON INFO', `${weapons.length} senjata`, C.weapon);
  drawColumnHeader(ctx, X_PASSIVE, HEADER_H, PASSIVE_W, 'PASSIVE INFO', `${passives.length} pasif`, C.passive);
  drawColumnHeader(ctx, X_BUFF, HEADER_H, BUFF_W, 'BUFF / DEBUFF', `${buffs.length} efek`, C.buff);

  // Ikon: kumpulkan semua token unik lalu unduh paralel.
  const icons = [];
  for (const w of weapons) { const i = weaponIcon(w); if (i) icons.push(i); }
  for (const p of passives) { const i = passiveIcon(p); if (i) icons.push(i); }
  for (const b of buffs) { const i = buffIcon(b); if (i) icons.push(i); }
  const unique = [...new Map(icons.map(i => [i.id, i])).values()];
  await Promise.all(unique.map(fetchIcon));

  let y = rowsTop;
  weaponRows.forEach((row, i) => { drawWeaponRow(ctx, row, X_WEAPON, y, i); y += row.height; });

  y = rowsTop;
  passiveRows.forEach((row, i) => { drawPassiveRow(ctx, row, X_PASSIVE, y, i); y += row.height; });

  y = rowsTop;
  buffRows.forEach((row, i) => { drawBuffRow(ctx, row, X_BUFF, y, i); y += row.height; });

  drawStats(ctx, MARGIN, statsY, WIDTH - MARGIN * 2);

  const twemojiEffects = buffs.filter(b => !emojiToken(BUFF_EMOJI[b.id]) && BUFF_TWEMOJI[b.id]).length;
  setFont(ctx, F_SMALL);
  ctx.fillStyle = C.dim;
  ctx.textBaseline = 'top';
  ctx.fillText(
    `Dibuat sekali pakai oleh scripts/weapon-chart-image.js · ${iconFailures} ikon gagal dimuat`,
    MARGIN,
    totalH - 48
  );

  fs.writeFileSync(OUT, canvas.toBuffer('image/png'));
  console.log(`Wrote ${OUT} (${WIDTH}x${totalH}) · ${twemojiEffects} Twemoji fallback · ${iconFailures} icon gagal`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
