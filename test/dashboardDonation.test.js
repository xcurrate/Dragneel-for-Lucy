const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

let tempDir;
let server;
let baseUrl;
const TOKEN = 'd'.repeat(32);

function resetModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('donationStorage.js') || key.includes(path.sep + 'dashboard' + path.sep + 'server.js')) delete require.cache[key];
  }
}

function call(method, pathname, body, token = TOKEN) {
  return fetch(baseUrl + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-dash-donation-'));
  process.chdir(tempDir);
  process.env.DASHBOARD_TOKEN = TOKEN;
  process.env.DASHBOARD_PORT = '0';
  resetModules();
  const { startDashboard } = require('../src/dashboard/server');
  server = startDashboard({ guilds: { cache: new Map() } }, {});
  await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  delete process.env.DASHBOARD_TOKEN;
  delete process.env.DASHBOARD_PORT;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('dashboard donation API', () => {
  it('requires the dashboard token', async () => {
    const res = await call('GET', '/api/donation', undefined, '');
    assert.strictEqual(res.status, 401);
  });

  it('returns disabled defaults when no file exists', async () => {
    const res = await call('GET', '/api/donation');
    assert.strictEqual(res.status, 200);
    const { settings } = await res.json();
    assert.strictEqual(settings.enabled, false);
    assert.deepStrictEqual(settings.links, {
      saweria: '', trakteer: '', kofi: '', paypal: '', qris: '',
    });
    assert.deepStrictEqual(settings.donors, []);
  });

  it('saves global donation settings and reads them back', async () => {
    const settings = {
      enabled: true,
      title: 'Dukung Dragneel',
      description: 'Bantu server.',
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
      donors: ['123456789012345678', '223456789012345678'],
    };
    const saved = await call('PUT', '/api/donation', { settings });
    assert.strictEqual(saved.status, 200);
    assert.strictEqual((await saved.json()).settings.collected, 25000);

    const loaded = await call('GET', '/api/donation');
    const { settings: loadedSettings } = await loaded.json();
    assert.strictEqual(loadedSettings.enabled, true);
    assert.strictEqual(loadedSettings.links.paypal, 'https://paypal.me/dragneel');
    assert.strictEqual(loadedSettings.goal, 100000);
    assert.deepStrictEqual(loadedSettings.donors, ['123456789012345678', '223456789012345678']);
  });

  it('rejects invalid URLs and negative totals', async () => {
    const base = { enabled: true, title: 'Dukung', description: 'Tes' };
    const badUrl = await call('PUT', '/api/donation', {
      settings: { ...base, links: { saweria: 'http://saweria.co/dragneel' } },
    });
    assert.strictEqual(badUrl.status, 400);
    assert.match((await badUrl.json()).error, /https/);

    const negative = await call('PUT', '/api/donation', {
      settings: { ...base, collected: -1 },
    });
    assert.strictEqual(negative.status, 400);
    assert.match((await negative.json()).error, /Total donasi/);

    const badDonor = await call('PUT', '/api/donation', {
      settings: { ...base, donors: ['bukan-id'] },
    });
    assert.strictEqual(badDonor.status, 400);
    assert.match((await badDonor.json()).error, /ID donatur/);
  });
});
