// Pemutar battle log. Data datang dari `/api/battle-log/:id` dan berisi
// `actions[]` (snapshot HP/WP/buff tiap aksi), jadi seekbar bisa melompat ke
// aksi mana pun tanpa menjalankan ulang simulasi.

const WINNER_TEXT = { player: 'Tim pemain menang', enemy: 'Tim lawan menang', tie: 'Seri' };
const ACTION_TEXT = {
  attack: 'menyerang',
  ability: 'memakai ability',
  ability_fail: 'ability gagal, lanjut serangan biasa',
  skip: 'melewati giliran',
  blocked: 'tidak bisa menyerang (dibekukan)',
};

const $ = id => document.getElementById(id);
const state = { log: null, id: null, actions: [], index: 0, playing: false, timer: null };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function idFromHash() {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  const hit = /^([a-f0-9]{32})(?:\/\d+)?$/.exec(raw);
  return hit ? hit[1] : null;
}

// `#<id>/<aksi>` menunjuk langsung ke satu aksi, jadi tautan bisa dibagikan
// pada momen yang penting ("lihat turn 5, di situ boss dibekukan").
function actionFromHash() {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  const hit = /^[a-f0-9]{32}\/(\d+)$/.exec(raw);
  return hit ? Number(hit[1]) : 0;
}

function pct(value, max) {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function nameOf(ref) {
  const unit = state.log.units[ref];
  return unit ? unit.name : '???';
}

function describe(event) {
  const name = ref => nameOf(ref);
  switch (event.k) {
    case 'dmg': {
      const type = event.ty === 'm' ? 'magic' : event.ty === 't' ? 'true' : 'physical';
      return { tag: 'damage', body: `${name(event.a)} → ${name(event.r)}: ${event.v} ${type}`, hint: `HP ${event.hp}` };
    }
    case 'heal':
      return {
        tag: 'heal',
        body: `${name(event.r)} pulih ${event.v}${event.s != null ? ` (dari ${name(event.s)})` : ''}`,
        hint: `HP ${event.hp}`,
      };
    case 'wp':
      return { tag: 'wp', body: `${name(event.r)} +${event.v} WP`, hint: `WP ${event.wp}` };
    case 'buff':
      return {
        tag: event.d ? 'debuff' : 'buff',
        body: `${event.n} → ${name(event.r)}${event.s != null ? ` (dari ${name(event.s)})` : ''}`,
      };
    case 'death':
      return { tag: 'gugur', body: `${name(event.r)} gugur` };
    case 'act': {
      const base = ACTION_TEXT[event.kind] || event.kind;
      return { tag: 'aksi', body: `${name(event.a)} ${base}${event.n ? ` (${event.n})` : ''}` };
    }
    default:
      return { tag: event.k, body: JSON.stringify(event) };
  }
}

// ---------------------------------------------------------------- arena

function buildArena() {
  for (const side of ['player', 'enemy']) {
    const host = $('side-' + side);
    host.className = 'side ' + side;
    host.textContent = '';
    const units = state.log.units.filter(u => u.side === side);
    units.sort((a, b) => a.slot - b.slot);
    for (const unit of units) host.append(buildSlot(unit));
  }
}

function buildSlot(unit) {
  const slot = el('div', 'slot');
  slot.dataset.ref = String(unit.ref);

  const avatar = el('div', 'avatar');
  if (unit.image) {
    const img = document.createElement('img');
    img.src = unit.image;
    img.alt = unit.name;
    img.loading = 'lazy';
    // Gambar Discord bisa hilang; jatuh ke inisial, jangan biarkan kotak kosong.
    img.addEventListener('error', () => {
      img.remove();
      avatar.textContent = (unit.name || '?').slice(0, 2).toUpperCase();
    });
    avatar.append(img);
  } else {
    avatar.textContent = (unit.name || '?').slice(0, 2).toUpperCase();
  }

  const body = el('div', 'unit-body');
  const top = el('div', 'unit-top');
  top.append(el('span', 'unit-name', unit.name));
  top.append(el('span', 'unit-lv', 'Lv ' + unit.level));
  body.append(top);

  if (unit.weapon) body.append(el('div', 'unit-weapon', unit.weapon));

  const hpBar = el('div', 'bar hp');
  hpBar.append(el('i'));
  const wpBar = el('div', 'bar wp');
  wpBar.append(el('i'));
  body.append(hpBar, wpBar);

  const statline = el('div', 'statline');
  statline.append(el('span', 'hp-text', ''));
  statline.append(el('span', 'wp-text', ''));
  body.append(statline);

  const buffs = el('div', 'buffs');
  body.append(buffs);

  slot.append(avatar, body);
  return slot;
}

function slotFor(ref) {
  return document.querySelector(`.slot[data-ref="${ref}"]`);
}

// Tandai efek visual singkat. Kelas dilepas lagi setelah animasi selesai,
// supaya aksi berikutnya bisa memicu animasi yang sama.
function flash(ref, className) {
  const slot = slotFor(ref);
  if (!slot) return;
  slot.classList.remove(className);
  void slot.offsetWidth;
  slot.classList.add(className);
  setTimeout(() => slot.classList.remove(className), 400);
}

function paintState(snap, activeRef) {
  for (const unit of state.log.units) {
    const slot = slotFor(unit.ref);
    if (!slot) continue;
    const now = snap[unit.ref];
    const hp = now ? now.hp : 0;
    const wp = now ? now.wp : 0;
    const dead = hp <= 0;

    slot.classList.toggle('dead', dead);
    slot.classList.toggle('active', activeRef != null && unit.ref === activeRef);

    const hpFill = slot.querySelector('.bar.hp > i');
    const hpBar = slot.querySelector('.bar.hp');
    hpFill.style.width = pct(hp, unit.maxHp) + '%';
    hpBar.classList.toggle('low', pct(hp, unit.maxHp) <= 30);
    slot.querySelector('.bar.wp > i').style.width = pct(wp, unit.maxWp) + '%';

    slot.querySelector('.hp-text').textContent = `${hp}/${unit.maxHp}`;
    slot.querySelector('.wp-text').textContent = `${wp} WP`;

    const buffs = slot.querySelector('.buffs');
    buffs.textContent = '';
    for (const buff of (now ? now.b : [])) {
      const chip = el('span', 'chip ' + (buff.d ? 'debuff' : 'buff'), buff.c > 1 ? `${buff.n} ×${buff.c}` : buff.n);
      if (buff.dur != null) chip.title = `${buff.n} (${buff.dur} turn)`;
      buffs.append(chip);
    }
  }
}

// Kelompokkan event identik yang berurutan menjadi satu baris `×N`. Frozen
// Armor menempelkan 10-20 stack Frostbite per serangan yang diterima, jadi
// tanpa ini satu turn bisa berisi 20 baris yang sama persis.
function groupEvents(events) {
  const groups = [];
  for (let i = 0; i < events.length; i++) {
    const info = describe(events[i]);
    const key = `${events[i].k}|${info.tag}|${info.body}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.to === i) {
      last.to = i + 1;
      last.count += 1;
      // Baris ringkas memakai nilai terakhir supaya angka HP-nya tetap benar.
      last.info = info;
      continue;
    }
    groups.push({ key, kind: events[i].k, info, count: 1, from: i, to: i + 1 });
  }
  return groups;
}

function renderEventRow(info, count) {
  const row = el('div', 'ev ' + info.kind);
  row.append(el('span', 'ev-tag', info.tag));
  const body = el('div', 'ev-body');
  body.append(el('span', null, info.body));
  if (count > 1) {
    body.append(document.createTextNode(' '));
    body.append(el('span', 'hint', `×${count}`));
  }
  if (info.hint) {
    body.append(document.createTextNode(' '));
    body.append(el('span', 'hint', info.hint));
  }
  row.append(body);
  return row;
}

// ---------------------------------------------------------------- feed

function buildFeed() {
  const host = $('feed');
  host.textContent = '';
  let turn = null;
  for (const group of groupEvents(state.log.events)) {
    const event = state.log.events[group.from];
    if (event.t !== turn) {
      turn = event.t;
      host.append(el('div', 'turn-sep', `TURN ${turn}`));
    }
    const row = renderEventRow(group.info, group.count);
    row.dataset.evFrom = String(group.from);
    row.dataset.evTo = String(group.to);
    host.append(row);
  }
  $('count').textContent = `${state.log.events.length} kejadian`;
}

function focusFeed(from, to) {
  for (const node of document.querySelectorAll('.ev.current')) node.classList.remove('current');
  const all = $('filter-all').checked;
  let first = null;
  for (const row of document.querySelectorAll('#feed .ev')) {
    const evFrom = Number(row.dataset.evFrom);
    const evTo = Number(row.dataset.evTo);
    if (evTo <= from || evFrom >= to) continue;
    // Saat filter dimatikan, hanya kejadian "besar" yang disorot.
    const big = ['dmg', 'heal', 'death'].includes(state.log.events[evFrom].k);
    if (all || big) {
      row.classList.add('current');
      if (!first) first = row;
    }
  }
  if (first) first.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- playback

function renderNow() {
  const host = $('now');
  host.textContent = '';
  const action = state.actions[state.index];
  if (!action) {
    host.append(el('div', 'now-empty', 'Akhir log.'));
    return;
  }
  const head = el('div', 'now-head', `TURN ${action.t} · aksi ${state.index + 1}/${state.actions.length}`);
  host.append(head);

  const body = el('div', 'now-body');
  const rows = state.log.events.slice(action.from, action.to);
  if (!rows.length) {
    body.append(el('div', 'now-empty', action.a == null ? 'Efek akhir turn.' : 'Tidak ada kejadian.'));
  } else {
    for (const group of groupEvents(rows)) {
      body.append(renderEventRow(group.info, group.count));
    }
  }
  host.append(body);
}

function goTo(index, { animate = true } = {}) {
  if (!state.actions.length) return;
  const clamped = Math.max(0, Math.min(state.actions.length - 1, index));
  state.index = clamped;
  const action = state.actions[clamped];

  paintState(action.s, action.a);
  $('turn-badge').textContent = 'TURN ' + action.t;
  $('seek').value = String(clamped);
  $('counter').textContent = `${clamped + 1} / ${state.actions.length}`;
  renderNow();
  focusFeed(action.from, action.to);

  if (animate) {
    if (action.a != null) flash(action.a, 'attacking');
    for (const event of state.log.events.slice(action.from, action.to)) {
      if (event.k === 'dmg' && event.r != null) flash(event.r, 'hit');
      if (event.k === 'heal' && event.r != null) flash(event.r, 'healed');
    }
  }

  // Simpan posisi di URL supaya "bagikan tautan aksi ini" bekerja tanpa
  // tombol tambahan. replaceState dipakai agar tombol Back tidak menumpuk
  // satu entri per aksi saat memutar ulang.
  if (state.id) history.replaceState(null, '', `#${state.id}/${clamped}`);

  $('btn-prev').disabled = clamped === 0;
  $('btn-next').disabled = clamped === state.actions.length - 1;
  if (clamped === state.actions.length - 1) stop();
}

function step(delta) {
  stop();
  goTo(state.index + delta);
}

function stop() {
  state.playing = false;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  const btn = $('btn-play');
  if (btn) btn.textContent = state.index >= state.actions.length - 1 ? 'Putar ulang' : 'Putar';
}

function tick() {
  if (!state.playing) return;
  if (state.index >= state.actions.length - 1) { stop(); return; }
  goTo(state.index + 1);
  const delay = Number($('speed').value) || 700;
  state.timer = setTimeout(tick, delay);
}

function play() {
  if (state.playing) { stop(); return; }
  if (state.index >= state.actions.length - 1) goTo(0, { animate: false });
  state.playing = true;
  $('btn-play').textContent = 'Jeda';
  tick();
}

// ---------------------------------------------------------------- main

async function main() {
  const id = idFromHash();
  const title = $('title');
  const subtitle = $('subtitle');
  const errorBox = $('error');

  if (!id) {
    title.textContent = 'Tautan tidak valid';
    subtitle.textContent = 'ID log tidak ada di alamat halaman.';
    errorBox.hidden = false;
    $('error-text').textContent = 'Buka halaman ini lewat tautan yang dikirim bot.';
    return;
  }

  let payload;
  try {
    const res = await fetch('/api/battle-log/' + id);
    payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  } catch (err) {
    title.textContent = 'Log tidak bisa dimuat';
    subtitle.textContent = '';
    errorBox.hidden = false;
    $('error-text').textContent = err.message || 'Coba lagi beberapa saat lagi.';
    return;
  }

  const log = payload.log;
  // Dibuang dari DOM, bukan disembunyikan, supaya teks error tidak pernah
  // ikut terbaca saat log berhasil dimuat.
  errorBox.remove();
  state.log = log;
  state.id = id;
  state.actions = Array.isArray(log.actions) ? log.actions : [];

  title.textContent = `${WINNER_TEXT[log.winner] || log.winner} · ${log.turns} turn`;
  subtitle.textContent = `Seed ${log.seed ?? '-'} · ${log.events.length} kejadian · ${state.actions.length} aksi`;

  buildArena();
  buildFeed();

  const meta = $('meta');
  meta.textContent = '';
  const add = (label, value) => {
    const node = el('span', null, '');
    node.append(el('b', null, label + ': '), document.createTextNode(value));
    meta.append(node);
  };
  add('Dibuat', new Date(payload.createdAt).toLocaleString('id-ID'));
  add('Kedaluwarsa', new Date(payload.expiresAt).toLocaleString('id-ID'));
  if (log.timeout) add('Catatan', 'battle mentok di batas turn');
  if (log.dropped) add('Kejadian dipotong', String(log.dropped));

  $('content').hidden = false;

  if (!state.actions.length) {
    // Log versi lama (sebelum snapshot ada): tetap tampilkan feed saja.
    $('seek').max = '0';
    $('counter').textContent = '0 / 0';
    $('btn-prev').disabled = true;
    $('btn-next').disabled = true;
    $('btn-play').disabled = true;
    $('now').textContent = '';
    $('now').append(el('div', 'now-empty', 'Log ini dibuat sebelum fitur putar ulang ada, jadi hanya teksnya yang tersedia.'));
    const last = log.units.map(u => ({ hp: u.hp, wp: 0, b: [] }));
    paintState(last, null);
    return;
  }

  $('seek').max = String(state.actions.length - 1);
  $('seek').addEventListener('input', () => { stop(); goTo(Number($('seek').value)); });
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-play').addEventListener('click', play);
  $('speed').addEventListener('change', () => {
    if (!state.playing) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(tick, Number($('speed').value) || 700);
  });
  $('filter-all').addEventListener('change', () => {
    const action = state.actions[state.index];
    if (action) focusFeed(action.from, action.to);
  });
  // Shortcut hanya berlaku saat fokus bukan di kontrol interaktif. Tanpa
  // penjagaan ini, Space di tombol Putar memicu klik native + shortcut
  // sekaligus (dua toggle), dan panah di seekbar menggeser dua langkah.
  const isTypingTarget = target =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName));

  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.key === ' ') { event.preventDefault(); play(); }
  });

  goTo(actionFromHash(), { animate: false });
}

main();
