const donationStore = require('./donationStorage');

// Daftar donatur utama dikelola lewat dashboard Donasi Global. Env DONOR_IDS
// tetap dibaca sebagai fallback untuk deployment lama.
function donorIds() {
  const ids = new Set(
    String(process.env.DONOR_IDS || process.env.DONATUR_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  try {
    for (const id of donationStore.getDonation().donors || []) ids.add(String(id));
  } catch { /* dashboard belum bisa dibaca: pakai env saja */ }
  return ids;
}

function isDonor(value) {
  const id = value && typeof value === 'object'
    ? (value.author?.id || value.user?.id || value.id)
    : value;
  return Boolean(id) && donorIds().has(String(id));
}

module.exports = { isDonor, donorIds };
