// Registry kategori dan format Custom Reminder.
//
// Kategori = APA yang diingatkan, format = BAGAIMANA ditampilkan. Keduanya
// properti terpisah; Normal dan Embed BUKAN kategori berbeda.
//
// Tiga kategori rilis ini:
//   PRAY_CURSE  — pengingat Pray/Curse
//   HUNT_BATTLE — pengingat Hunt/Battle
//   LUCY        — pengingat "Say Lucy"
//
// Pemetaan ke aksi engine lama (src/services/lucyReminder.js) sengaja
// many-to-one: engine sudah menggabungkan pray+curse jadi satu jenis (durasi
// sama) dan battle+hunt jadi satu jenis. Pengaturan server tetap bisa dipisah
// per aksi lewat `ACTIONS` di bawah, walau kategori Custom Reminder-nya sama.
const CATEGORIES = {
  PRAY_CURSE: {
    key: 'PRAY_CURSE',
    label: 'Pray/Curse Reminder',
    emoji: '🙏',
    // Aksi engine yang termasuk kategori ini (kunci server default).
    actions: ['pray', 'curse']
  },
  HUNT_BATTLE: {
    key: 'HUNT_BATTLE',
    label: 'Hunt/Battle Reminder',
    emoji: '⚔️',
    actions: ['hunt', 'battle']
  },
  LUCY: {
    key: 'LUCY',
    label: 'Lucy Reminder',
    emoji: '🐉',
    actions: ['lucy']
  }
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);

// Format: NORMAL = konten pesan biasa, EMBED = embed kaya.
const FORMATS = {
  NORMAL: { key: 'NORMAL', label: 'Normal', emoji: '💬' },
  EMBED: { key: 'EMBED', label: 'Embed', emoji: '🧩' }
};
const FORMAT_KEYS = Object.keys(FORMATS);

// Aksi engine -> kategori Custom Reminder.
const ACTION_TO_CATEGORY = (() => {
  const map = {};
  for (const category of Object.values(CATEGORIES)) {
    for (const action of category.actions) map[action] = category.key;
  }
  return map;
})();

// Label aksi untuk pengaturan server (`s pray`, `s curse`, ...).
const ACTIONS = ['pray', 'curse', 'hunt', 'battle', 'lucy'];
const ACTION_LABELS = {
  pray: 'Lucy Pray',
  curse: 'Lucy Curse',
  hunt: 'Lucy Hunt',
  battle: 'Lucy Battle',
  lucy: 'Lucy'
};

function normalizeCategory(value) {
  const text = String(value || '').trim().toUpperCase();
  return CATEGORY_KEYS.includes(text) ? text : null;
}
function normalizeFormat(value) {
  const text = String(value || '').trim().toUpperCase();
  return FORMAT_KEYS.includes(text) ? text : null;
}
function normalizeAction(value) {
  const text = String(value || '').trim().toLowerCase();
  return ACTIONS.includes(text) ? text : null;
}
function categoryForAction(action) {
  return ACTION_TO_CATEGORY[String(action || '').toLowerCase()] || null;
}
// Terima masukan kategori dari pengguna: nama kategori resmi, atau nama aksi
// yang lazim ditulis developer (`battle` -> HUNT_BATTLE, `pray` -> PRAY_CURSE).
function resolveCategoryInput(value) {
  return normalizeCategory(value) || categoryForAction(value);
}
// Semua kombinasi kategori x format (enam buah).
function combinations() {
  const out = [];
  for (const category of CATEGORY_KEYS) {
    for (const format of FORMAT_KEYS) out.push({ category, format });
  }
  return out;
}
function categoryLabel(value) {
  const key = normalizeCategory(value);
  return key ? CATEGORIES[key].label : String(value || '');
}
function formatLabel(value) {
  const key = normalizeFormat(value);
  return key ? FORMATS[key].label : String(value || '');
}
// "Pray/Curse Reminder (Embed)" — dipakai di inventory.
function displayNameFor(category, format) {
  const cat = normalizeCategory(category);
  const fmt = normalizeFormat(format);
  if (!cat || !fmt) return 'Custom Reminder';
  return CATEGORIES[cat].label + ' (' + FORMATS[fmt].label + ')';
}

module.exports = {
  CATEGORIES, CATEGORY_KEYS, FORMATS, FORMAT_KEYS,
  ACTIONS, ACTION_LABELS, ACTION_TO_CATEGORY,
  normalizeCategory, normalizeFormat, normalizeAction,
  categoryForAction, resolveCategoryInput, combinations, categoryLabel, formatLabel, displayNameFor
};
