// Konfigurasi donasi bersifat global untuk bot, bukan per server. Tracking
// nominal dilakukan manual lewat dashboard; tidak ada data donatur per orang.
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(process.cwd(), 'data');
const file = path.join(dir, 'donation.json');

const DEFAULTS = {
  enabled: false,
  title: '💖 Dukung Dragneel',
  description: 'Dragneel gratis dipakai. Kalau mau membantu biaya server dan pengembangan, donasi bisa lewat link di bawah.',
  links: {
    saweria: '',
    trakteer: '',
    kofi: '',
    paypal: '',
    qris: '',
  },
  qrisImageUrl: '',
  goal: 0,
  collected: 0,
};

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function normalize(value = {}) {
  const links = value.links || {};
  return {
    enabled: Boolean(value.enabled),
    title: text(value.title, 100) || DEFAULTS.title,
    description: text(value.description, 2000) || DEFAULTS.description,
    links: {
      saweria: text(links.saweria, 500),
      trakteer: text(links.trakteer, 500),
      kofi: text(links.kofi, 500),
      paypal: text(links.paypal, 500),
      qris: text(links.qris, 500),
    },
    qrisImageUrl: text(value.qrisImageUrl, 500),
    goal: Math.max(0, Math.trunc(Number(value.goal) || 0)),
    collected: Math.max(0, Math.trunc(Number(value.collected) || 0)),
  };
}

function validateUrl(value, label) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error(label + ' harus berupa URL yang valid.'); }
  if (url.protocol !== 'https:') throw new Error(label + ' harus memakai https://.');
  return url.toString();
}

function validateDonation(input = {}) {
  if (typeof input.enabled !== 'boolean') throw new Error('Status donasi tidak valid.');
  const title = text(input.title, 100);
  if (!title) throw new Error('Judul donasi wajib diisi.');
  const description = text(input.description, 2000);
  if (!description) throw new Error('Deskripsi donasi wajib diisi.');
  const links = input.links || {};
  const validatedLinks = {
    saweria: validateUrl(text(links.saweria, 500), 'Link Saweria'),
    trakteer: validateUrl(text(links.trakteer, 500), 'Link Trakteer'),
    kofi: validateUrl(text(links.kofi, 500), 'Link Ko-fi'),
    paypal: validateUrl(text(links.paypal, 500), 'Link PayPal'),
    qris: validateUrl(text(links.qris, 500), 'Link QRIS'),
  };
  const qrisImageUrl = validateUrl(text(input.qrisImageUrl, 500), 'Gambar QRIS');
  const goal = Math.trunc(Number(input.goal) || 0);
  const collected = Math.trunc(Number(input.collected) || 0);
  if (!Number.isSafeInteger(goal) || goal < 0) throw new Error('Target donasi harus bilangan bulat 0 atau lebih.');
  if (!Number.isSafeInteger(collected) || collected < 0) throw new Error('Total donasi tercatat harus bilangan bulat 0 atau lebih.');
  return {
    enabled: input.enabled,
    title,
    description,
    links: validatedLinks,
    qrisImageUrl,
    goal,
    collected,
  };
}

const defaultStore = {
  read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  },
  write(value) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(tmp, file);
  },
};

let donationStore = defaultStore;

function setDonationStore(store) {
  donationStore = store || defaultStore;
}

function getDonation() {
  return normalize(donationStore.read());
}

function saveDonation(input) {
  const current = getDonation();
  const value = validateDonation({
    ...current,
    ...input,
    links: { ...current.links, ...(input.links || {}) },
  });
  donationStore.write(value);
  return value;
}

module.exports = {
  DEFAULTS,
  getDonation,
  saveDonation,
  validateDonation,
  normalize,
  setDonationStore,
};
