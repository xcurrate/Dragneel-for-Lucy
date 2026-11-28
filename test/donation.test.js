const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const store = require(path.join(ROOT, 'src/utils/donationStorage'));
const donation = require(path.join(ROOT, 'src/commands/donation'));
const { handlePrefixCommand } = require(path.join(ROOT, 'src/commands/prefix'));

let memory = {};
function reset() {
  memory = {};
  store.setDonationStore({
    read: () => ({ ...memory, links: { ...(memory.links || {}) } }),
    write: value => { memory = value; },
  });
}

test.after(() => store.setDonationStore(null));

test('donasi nonaktif menampilkan pesan tanpa tombol', () => {
  reset();
  const payload = donation.buildDonationPayload();
  assert.match(payload.embeds[0].toJSON().description, /belum diaktifkan/);
  assert.equal(payload.components, undefined);
});

test('donasi aktif menampilkan semua platform, progress, dan QRIS', () => {
  reset();
  store.saveDonation({
    enabled: true,
    title: 'Dukung Dragneel',
    description: 'Bantu biaya server.',
    links: {
      saweria: 'https://saweria.co/dragneel',
      trakteer: 'https://trakteer.id/dragneel',
      kofi: 'https://ko-fi.com/dragneel',
      paypal: 'https://paypal.me/dragneel',
      qris: 'https://example.com/qris',
    },
    qrisImageUrl: 'https://example.com/qris.png',
    goal: 100000,
    collected: 25000,
  });

  const payload = donation.buildDonationPayload(store.getDonation());
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, 'Dukung Dragneel');
  assert.match(embed.fields[0].value, /25%/);
  assert.match(embed.fields[0].value, /Rp\s*25\.000/);
  assert.match(embed.fields[0].value, /Rp\s*100\.000/);
  assert.equal(embed.image.url, 'https://example.com/qris.png');

  const row = payload.components[0].toJSON();
  assert.deepEqual(row.components.map(button => button.label), ['Saweria', 'Trakteer', 'Ko-fi', 'PayPal', 'QRIS']);
  assert.deepEqual(row.components.map(button => button.url), [
    'https://saweria.co/dragneel',
    'https://trakteer.id/dragneel',
    'https://ko-fi.com/dragneel',
    'https://paypal.me/dragneel',
    'https://example.com/qris',
  ]);
});

test('donasi hanya menampilkan tombol yang diisi', () => {
  reset();
  store.saveDonation({
    enabled: true,
    title: 'Dukung',
    description: 'Tes',
    links: { saweria: 'https://saweria.co/dragneel' },
  });
  const payload = donation.buildDonationPayload(store.getDonation());
  assert.equal(payload.components[0].toJSON().components.length, 1);
});

test('daftar donatur dari dashboard dipakai untuk status donatur', () => {
  reset();
  delete process.env.DONOR_IDS;
  store.saveDonation({
    enabled: true,
    title: 'Dukung',
    description: 'Tes',
    donors: ['123456789012345678', '223456789012345678', '123456789012345678'],
  });
  assert.deepEqual(store.getDonation().donors, ['123456789012345678', '223456789012345678']);
  const donor = require(path.join(ROOT, 'src/utils/donor'));
  assert.equal(donor.isDonor('123456789012345678'), true);
  assert.equal(donor.isDonor('323456789012345678'), false);
});

test('validasi donasi menolak ID donatur yang bukan snowflake', () => {
  reset();
  assert.throws(() => store.validateDonation({
    enabled: true,
    title: 'Dukung',
    description: 'Tes',
    donors: ['bukan-id'],
  }), /ID donatur/);
});

test('validasi donasi menolak URL non-https dan nominal negatif', () => {
  reset();
  assert.throws(() => store.validateDonation({
    enabled: true,
    title: 'Dukung',
    description: 'Tes',
    links: { saweria: 'http://saweria.co/dragneel' },
  }), /https/);
  assert.throws(() => store.validateDonation({
    enabled: true,
    title: 'Dukung',
    description: 'Tes',
    goal: -1,
  }), /Target donasi/);
});

test('command prefix d donasi memakai konfigurasi global', async () => {
  reset();
  store.saveDonation({
    enabled: true,
    title: 'Dukung Dragneel',
    description: 'Bantu server.',
    links: { saweria: 'https://saweria.co/dragneel' },
  });
  const calls = [];
  const message = {
    guildId: 'guild-donation',
    author: { id: 'user-1', bot: false },
    content: 'd donasi',
    member: { permissions: { has: () => false } },
    guild: { channels: { fetch: async () => null }, roles: { fetch: async () => null } },
    reply: async () => {},
  };
  await handlePrefixCommand(message, null, {
    send: async (_message, payload) => calls.push(payload),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].embeds[0].toJSON().title, 'Dukung Dragneel');
  assert.equal(calls[0].components[0].toJSON().components[0].label, 'Saweria');
});

test('slash donasi mengirim payload yang sama', async () => {
  reset();
  store.saveDonation({
    enabled: true,
    title: 'Dukung',
    description: 'Tes',
    links: { paypal: 'https://paypal.me/dragneel' },
  });
  let replied = null;
  await donation.execute({ reply: async payload => { replied = payload; } });
  assert.equal(replied.embeds[0].toJSON().title, 'Dukung');
  assert.equal(replied.components[0].toJSON().components[0].label, 'PayPal');
});
