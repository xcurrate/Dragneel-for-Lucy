// Sekali pakai: render daftar senjata, pasif, dan buff/debuff ke satu PNG.
// Jalankan: node scripts/battle-reference-image.js
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const battle = require('../src/data/owoBattle');
const { all: allPassives } = require('../src/data/owoPassives');
const passives = allPassives();

const OUT = path.join(__dirname, '..', 'battle-reference.png');
const WIDTH = 2000;
const MARGIN = 56;
const GAP = 24;
const COL_W = (WIDTH - MARGIN * 2 - GAP) / 2;
const CARD_PAD = 20;

const FONT = 'DejaVu Sans';
const F_TITLE = `bold 25px "${FONT}"`;
const F_META = `16px "${FONT}"`;
const F_BODY = `18px "${FONT}"`;
const F_SMALL = `15px "${FONT}"`;
const F_SECTION = `bold 40px "${FONT}"`;
const F_HERO = `bold 54px "${FONT}"`;
const F_SUB = `20px "${FONT}"`;

const LH_TITLE = 31;
const LH_META = 23;
const LH_BODY = 25;
const LH_SMALL = 21;

const C = {
  bg: '#0f1117',
  panel: '#191c27',
  panelAlt: '#1d2130',
  border: '#30364a',
  text: '#e8eaf6',
  muted: '#9aa3b8',
  dim: '#737d95',
  weapon: '#5b9dff',
  passive: '#43d9a3',
  buff: '#ffb454',
  debuff: '#ff6b6b',
  white: '#ffffff',
};

const measureCanvas = createCanvas(10, 10);
const measure = measureCanvas.getContext('2d');

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

function buffOf(id) {
  return battle.buffById(id);
}

function buffLine(id) {
  const b = buffOf(id);
  if (!b) return '';
  return b.name + (b.qualityList.length ? ` (${rangesText(b.qualityList)})` : '');
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
  const buffName = buff ? buff.name : 'buff';
  const stack = ab.stacks ? `${ab.stacks} stack ` : '';

  switch (ab.kind) {
    case 'damage_all':
      return `Menyerang semua musuh dengan ${q0} ${stat}.`;
    case 'damage_one':
      return `Menyerang satu musuh dengan ${q0} ${stat}.`;
    case 'damage_all_heal_team':
      return `Menyerang semua musuh ${q0} MAG; total damage dibagi rata sebagai heal ke seluruh tim.`;
    case 'damage_one_buff':
      return `Menyerang satu musuh ${q0} ${stat} lalu memasang ${stack}${buffName}${duration}.`;
    case 'damage_one_steal_wp':
      return `Menyerang satu musuh ${q0} MAG, lalu mencuri ${q1} dari damage sebagai WP untuk sekutu dengan WP terendah.`;
    case 'heal_lowest':
      return `Menyembuhkan sekutu dengan HP terendah sebesar ${q0} MAG. Boleh overheal.`;
    case 'heal_all_buff':
      return `Menyembuhkan seluruh tim ${q0} MAG lalu memasang ${buffName}${duration}.`;
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
      const names = (w.buffList || []).map(id => buffOf(id)?.name).filter(Boolean);
      return `Memasang ${names.join(' → ')} ke seluruh tim${duration}. Saat buff hampir habis, tier naik.`;
    }
    case 'celebration':
      return `Memakai Celebration pada sekutu HP terendah${duration}. ${buff ? buff.note : ''}`.trim();
    case 'curse_all':
      return `Mengutuk semua musuh${duration}. ${buff ? buff.note : ''}`.trim();
    case 'anniversary':
      return `Tiap ${ab.interval || 4} giliran memasang ${buffName}${duration} ke seluruh tim.`;
    case 'bleeding_gaze':
      return `Biaya ${q2} Max HP: satu musuh dipaksa menyerang sekutunya (${q0} efektivitas). Jika sendirian, damage ${q1} MAG.`;
    case 'conduit':
      return `Memindahkan satu debuff musuh ke sekutu dengan buff terbanyak, efektivitas -${q0}, lalu damage ${q1} MAG.`;
    case 'corrupt_buff':
      return `Menurunkan efektivitas buff musuh menjadi ${q0}, lalu buff itu mengenai pemakai sebesar ${q1} STR.`;
    case 'purify':
      return `Membersihkan satu debuff dari rekan acak, heal ${q0} MAG, lalu memasang ${buffName}${duration}.`;
    case 'luck_hits':
      return `Menyerang satu musuh ${ab.hits || 5} kali; tiap hit acak fisik/magis memakai ${rangesText(w.qualityList)}.`;
    case 'heavy_arrow':
      return `Memuat Heavy Arrow tanpa WP. Tembakan berikutnya ${q0} STR + ${q1} stack Exposed; WP dibayar saat menembak.`;
    case 'none':
      if (w.name === 'Rune of the Forgotten') {
        return `Serangan dasar 65% STR + 65% MAG sebagai TRUE damage (tembus PR/MR). Tidak ada ability aktif; +${q0} ke semua stat. Status: disabled, tidak bisa di-roll baru.`;
      }
      if (w.name === 'Orb of Potency') {
        return `Tidak ada ability aktif. Fokus pada slot pasif 2-3; tidak menyerang dengan ability khusus.`;
      }
      return 'Tidak ada ability aktif.';
    default:
      return w.sourceText || 'Tidak ada deskripsi ability.';
  }
}

function weaponMeta(w) {
  const pr = battle.passiveRange(w);
  const parts = [typeLabel(w.type), `Pasif ${pr.min}-${pr.max}`];
  if (w.manaRange) parts.push(`WP ${w.manaRange[0]}-${w.manaRange[1]}`);
  if (w.qualityList.length) parts.push(`Quality ${rangesText(w.qualityList)}`);
  if (w.disabled) parts.push('DISABLED');
  return parts.join(' · ');
}

function passiveDescription(p) {
  return p.summary || p.sourceText || 'Tidak ada deskripsi.';
}

function passiveMeta(p) {
  const parts = [p.category || 'passive'];
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

function buildCard({ title, meta, body, small, accent, badge }) {
  measure.font = F_TITLE;
  const titleLines = wrapText(measure, title, COL_W - CARD_PAD * 2);
  measure.font = F_META;
  const metaLines = meta ? wrapText(measure, meta, COL_W - CARD_PAD * 2) : [];
  measure.font = F_BODY;
  const bodyLines = body ? wrapText(measure, body, COL_W - CARD_PAD * 2) : [];
  measure.font = F_SMALL;
  const smallLines = small ? wrapText(measure, small, COL_W - CARD_PAD * 2) : [];

  const height = CARD_PAD * 2 +
    titleLines.length * LH_TITLE +
    (metaLines.length ? 4 + metaLines.length * LH_META : 0) +
    (bodyLines.length ? 8 + bodyLines.length * LH_BODY : 0) +
    (smallLines.length ? 8 + smallLines.length * LH_SMALL : 0);

  return { title, meta, body, small, accent, badge, titleLines, metaLines, bodyLines, smallLines, height };
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

function drawCard(ctx, card, x, y) {
  ctx.fillStyle = C.panel;
  roundRect(ctx, x, y, COL_W, card.height, 14);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Strip aksen di kiri.
  ctx.fillStyle = card.accent;
  roundRect(ctx, x, y, 6, card.height, 3);
  ctx.fill();

  let cy = y + CARD_PAD;
  ctx.textBaseline = 'top';

  ctx.font = F_TITLE;
  ctx.fillStyle = C.white;
  for (const line of card.titleLines) {
    ctx.fillText(line, x + CARD_PAD, cy);
    cy += LH_TITLE;
  }

  if (card.badge) {
    ctx.font = F_SMALL;
    const bw = ctx.measureText(card.badge).width + 18;
    const bh = 24;
    const bx = x + COL_W - CARD_PAD - bw;
    const by = y + CARD_PAD - 2;
    ctx.fillStyle = card.badge === 'DEBUFF' ? C.debuff : C.buff;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.fillStyle = C.bg;
    ctx.fillText(card.badge, bx + 9, by + 4);
  }

  if (card.metaLines.length) {
    cy += 4;
    ctx.font = F_META;
    ctx.fillStyle = C.muted;
    for (const line of card.metaLines) {
      ctx.fillText(line, x + CARD_PAD, cy);
      cy += LH_META;
    }
  }

  if (card.bodyLines.length) {
    cy += 8;
    ctx.font = F_BODY;
    ctx.fillStyle = C.text;
    for (const line of card.bodyLines) {
      ctx.fillText(line, x + CARD_PAD, cy);
      cy += LH_BODY;
    }
  }

  if (card.smallLines.length) {
    cy += 8;
    ctx.font = F_SMALL;
    ctx.fillStyle = C.dim;
    for (const line of card.smallLines) {
      ctx.fillText(line, x + CARD_PAD, cy);
      cy += LH_SMALL;
    }
  }
}

function layoutSection(cards) {
  const rows = [];
  let height = 0;
  for (let i = 0; i < cards.length; i += 2) {
    const left = cards[i];
    const right = cards[i + 1] || null;
    const rowHeight = Math.max(left.height, right?.height || 0);
    rows.push({ left, right, height: rowHeight });
    height += rowHeight + GAP;
  }
  return { rows, height: Math.max(0, height - GAP) };
}

function main() {
  const weaponCards = battle.weapons().map(w => buildCard({
    title: `${w.id}. ${w.name}`,
    meta: weaponMeta(w),
    body: weaponDescription(w),
    small: w.aliases?.length ? `Alias: ${w.aliases.join(', ')}` : '',
    accent: C.weapon,
  }));

  const passiveCards = passives.map(p => buildCard({
    title: `${p.id}. ${p.name}`,
    meta: passiveMeta(p),
    body: passiveDescription(p),
    small: p.aliases?.length ? `Alias: ${p.aliases.join(', ')}` : '',
    accent: C.passive,
  }));

  const buffCards = battle.buffs().map(b => buildCard({
    title: b.name,
    meta: buffMeta(b),
    body: b.note || 'Tidak ada catatan.',
    small: buffUsers(b).length ? `Senjata: ${buffUsers(b).join(', ')}` : '',
    accent: b.debuff ? C.debuff : C.buff,
    badge: b.debuff ? 'DEBUFF' : 'BUFF',
  }));

  const sections = [
    { title: 'SENJATA', color: C.weapon, cards: weaponCards, count: weaponCards.length },
    { title: 'PASIF', color: C.passive, cards: passiveCards, count: passiveCards.length },
    { title: 'BUFF & DEBUFF', color: C.buff, cards: buffCards, count: buffCards.length },
  ];

  const headerH = 230;
  let totalH = headerH;
  for (const s of sections) {
    s.layout = layoutSection(s.cards);
    s.height = 92 + s.layout.height;
    totalH += s.height;
  }
  totalH += 90;

  const canvas = createCanvas(WIDTH, totalH);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, WIDTH, totalH);

  // Header.
  const grad = ctx.createLinearGradient(0, 0, WIDTH, headerH);
  grad.addColorStop(0, '#131a2a');
  grad.addColorStop(1, '#0f1117');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, headerH);

  ctx.textBaseline = 'top';
  ctx.font = F_HERO;
  ctx.fillStyle = C.white;
  ctx.fillText('OWO BATTLE REFERENCE', MARGIN, 52);

  ctx.font = F_SUB;
  ctx.fillStyle = C.muted;
  ctx.fillText(
    `${weaponCards.length} senjata · ${passiveCards.length} pasif · ${buffCards.length} buff/debuff`,
    MARGIN,
    122
  );

  ctx.font = F_SMALL;
  ctx.fillStyle = C.dim;
  ctx.fillText(
    'Sumber: src/data/owoBattle.json + src/data/owoPassives.json · quality q0-q100',
    MARGIN,
    156
  );
  ctx.fillText(
    'Dibuat sekali pakai oleh scripts/battle-reference-image.js — bukan bagian runtime bot.',
    MARGIN,
    182
  );

  let y = headerH;
  for (const s of sections) {
    ctx.font = F_SECTION;
    ctx.fillStyle = s.color;
    ctx.fillText(s.title, MARGIN, y);
    const titleWidth = ctx.measureText(s.title).width;
    ctx.font = F_META;
    ctx.fillStyle = C.muted;
    ctx.fillText(`${s.count} entri`, MARGIN + titleWidth + 18, y + 12);

    y += 62;
    const startY = y;
    const x0 = MARGIN;
    const x1 = MARGIN + COL_W + GAP;
    let cy = startY;
    for (const row of s.layout.rows) {
      drawCard(ctx, row.left, x0, cy);
      if (row.right) drawCard(ctx, row.right, x1, cy);
      cy += row.height + GAP;
    }
    y += s.layout.height + 30;
  }

  ctx.font = F_SMALL;
  ctx.fillStyle = C.dim;
  ctx.fillText(
    'Angka adalah rentang quality 0-100. Deskripsi disusun dari ability, abilityNote, summary, dan note di data.',
    MARGIN,
    totalH - 58
  );

  fs.writeFileSync(OUT, canvas.toBuffer('image/png'));
  console.log(`Wrote ${OUT} (${WIDTH}x${totalH})`);
}

main();
