// Halaman log battle. Membaca ID dari hash URL (#<id>), lalu merender JSON
// yang dikirim server. Semua teks dibuat lewat textContent supaya isi log
// (nama hewan, nama senjata) tidak bisa menyuntik HTML.

const WINNER_TEXT = {
  player: 'Tim pemain menang',
  enemy: 'Tim lawan menang',
  tie: 'Seri',
};

const ACTION_TEXT = {
  attack: 'menyerang',
  ability: 'memakai ability',
  ability_fail: 'ability gagal, lanjut serangan biasa',
  blocked: 'tidak bisa menyerang (dibekukan)',
  skip: 'melewati giliran',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function idFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  return /^[a-f0-9]{32}$/.test(raw) ? raw : null;
}

function unitCard(unit) {
  const card = el('div', 'unit' + (unit.hp <= 0 ? ' dead' : ''));
  const top = el('div', 'unit-top');
  top.append(el('span', null, unit.name));
  top.append(el('span', 'num', `${unit.hp}/${unit.maxHp}`));
  card.append(top);

  const weapon = unit.weapon
    ? unit.weapon + (unit.passives.length ? ` · ${unit.passives.join(', ')}` : '')
    : 'tanpa senjata';
  card.append(el('div', 'unit-weapon', weapon));

  const bar = el('div', 'hpbar');
  const fill = el('i');
  fill.style.width = `${Math.max(0, Math.min(100, (unit.hp / Math.max(1, unit.maxHp)) * 100))}%`;
  bar.append(fill);
  card.append(bar);
  return card;
}

function describe(event, names) {
  const nameOf = ref => (ref == null ? '?' : names[ref] || '?');
  switch (event.k) {
    case 'act': {
      const text = ACTION_TEXT[event.kind] || event.kind;
      return { tag: 'aksi', body: `${nameOf(event.a)} ${text}${event.n ? ` (${event.n})` : ''}` };
    }
    case 'dmg':
      return {
        tag: 'damage',
        body: `${nameOf(event.a)} → ${nameOf(event.r)}: ${event.v} ${event.ty === 'm' ? 'magic' : event.ty === 't' ? 'true' : 'physical'}`,
        hint: `HP ${nameOf(event.r)} ${event.hp}`,
      };
    case 'heal':
      return {
        tag: 'heal',
        body: `${nameOf(event.r)} pulih ${event.v}${event.s != null ? ` (dari ${nameOf(event.s)})` : ''}`,
        hint: `HP ${nameOf(event.r)} ${event.hp}`,
      };
    case 'wp':
      return { tag: 'wp', body: `${nameOf(event.r)} +${event.v} WP`, hint: `WP ${event.wp}` };
    case 'buff':
      return {
        tag: event.d ? 'debuff' : 'buff',
        body: `${event.n} → ${nameOf(event.r)}${event.s != null ? ` (dari ${nameOf(event.s)})` : ''}`,
      };
    case 'death':
      return { tag: 'gugur', body: `${nameOf(event.r)} gugur` };
    default:
      return { tag: event.k, body: JSON.stringify(event) };
  }
}

function renderTurn(turn, events, names) {
  const section = el('div', 'turn');
  section.append(el('div', 'turn-head', `TURN ${turn}`));
  const body = el('div', 'turn-body');

  // Kejadian identik yang berurutan diringkas jadi satu baris `×N`. Ini penting
  // untuk Frostbite: Frozen Armor menempelkan 10-20 stack per serangan yang
  // diterima, sehingga satu turn bisa berisi 20 baris yang sama persis.
  let group = null;
  const flush = () => {
    if (!group) return;
    const row = el('div', `ev ${group.kind}`);
    row.append(el('span', 'ev-tag', group.info.tag));
    const content = el('div', 'ev-body');
    content.append(el('span', null, group.info.body));
    if (group.count > 1) {
      content.append(document.createTextNode(' '));
      content.append(el('span', 'hint', `×${group.count}`));
    }
    if (group.info.hint) {
      content.append(document.createTextNode(' '));
      content.append(el('span', 'hint', group.info.hint));
    }
    row.append(content);
    body.append(row);
    group = null;
  };

  for (const event of events) {
    const info = describe(event, names);
    const key = `${event.k}|${info.tag}|${info.body}`;
    if (group && group.key === key) {
      group.count += 1;
      // Baris ringkas memakai HP terakhir supaya angkanya tetap benar.
      group.info = info;
      continue;
    }
    flush();
    group = { key, kind: event.k, info, count: 1 };
  }
  flush();

  section.append(body);
  return section;
}

async function main() {
  const id = idFromHash();
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const errorBox = document.getElementById('error');
  const errorText = document.getElementById('error-text');
  const content = document.getElementById('content');

  if (!id) {
    title.textContent = 'Tautan tidak valid';
    subtitle.textContent = 'URL harus berisi ID log 32 karakter heksadesimal.';
    errorBox.hidden = false;
    errorText.textContent = 'Salin ulang tautan lengkap dari pesan bot.';
    return;
  }

  let payload;
  try {
    const response = await fetch(`/api/battle-log/${id}`);
    payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Log tidak ditemukan.');
  } catch (error) {
    title.textContent = 'Log tidak ditemukan';
    subtitle.textContent = '';
    errorBox.hidden = false;
    errorText.textContent = error.message;
    return;
  }

  const log = payload.log;
  // Kotak error dibuang dari DOM, bukan hanya disembunyikan, supaya teks
  // "Log tidak ditemukan" tidak pernah ikut terbaca saat log berhasil dimuat.
  errorBox.remove();
  const names = {};
  for (const unit of log.units) names[unit.ref] = unit.name;

  title.textContent = `${WINNER_TEXT[log.winner] || log.winner} · ${log.turns} turn`;
  subtitle.textContent = log.timeout
    ? 'Pertarungan mencapai batas turn.'
    : `Seed ${log.seed ?? '-'} · ${log.events.length} kejadian`;

  const player = document.getElementById('team-player');
  const enemy = document.getElementById('team-enemy');
  player.append(el('div', 'team-name', 'TIM PEMAIN'));
  enemy.append(el('div', 'team-name', 'TIM LAWAN'));
  for (const unit of log.units) {
    (unit.side === 'player' ? player : enemy).append(unitCard(unit));
  }

  const meta = document.getElementById('meta');
  meta.append(el('span', null, `Dibuat ${new Date(payload.createdAt).toLocaleString('id-ID')}`));
  meta.append(el('span', null, `Kedaluwarsa ${new Date(payload.expiresAt).toLocaleString('id-ID')}`));
  if (log.dropped) meta.append(el('span', null, `${log.dropped} kejadian dipotong (batas ukuran)`));

  const byTurn = new Map();
  for (const event of log.events) {
    if (!byTurn.has(event.t)) byTurn.set(event.t, []);
    byTurn.get(event.t).push(event);
  }
  const turns = document.getElementById('turns');
  for (const [turn, events] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    turns.append(renderTurn(turn, events, names));
  }

  document.getElementById('count').textContent = `${log.events.length} kejadian`;
  const filter = document.getElementById('filter-all');
  filter.addEventListener('change', () => {
    for (const row of turns.querySelectorAll('.ev')) {
      row.style.display = filter.checked || ['dmg', 'heal', 'death', 'buff'].includes(row.classList[1]) ? '' : 'none';
    }
  });

  content.hidden = false;
}

main();
