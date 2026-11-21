#!/usr/bin/env node
// Uji manual dari sudut pandang akun user: kirim perintah seperti manusia,
// lalu baca balasan bot di kanal yang sama. Tidak memakai gateway, jadi cukup
// token user (USER_DISCORD_TOKEN) dan token bot untuk membaca balasan.
//
// Pemakaian:
//   node scripts/live-user-test.js            # semua skenario
//   node scripts/live-user-test.js --keep     # jangan hapus pesan uji
//
// Skenario sengaja memakai user yang belum punya tim untuk memastikan pesan
// bantuan muncul, lalu membuat tim sementara dan menghapusnya lagi.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API = 'https://discord.com/api/v10';
const CHANNEL = process.env.LIVE_TEST_CHANNEL || '1554454470211936266';
const PREFIX = process.env.LIVE_TEST_PREFIX || 'd';
const KEEP = process.argv.includes('--keep');
const TEAM = process.env.LIVE_TEST_TEAM || 'uji-otomatis';
const ANIMAL = process.env.LIVE_TEST_ANIMAL || 'pidgeotto';

const userToken = process.env.USER_DISCORD_TOKEN;
const botToken = process.env.DISCORD_TOKEN;
const botId = process.env.LUCY_BOT_ID;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(token, route, opts = {}) {
  const res = await fetch(API + route, {
    ...opts,
    headers: { Authorization: token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${opts.method || 'GET'} ${route} -> ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function preflight() {
  const missing = [
    !userToken && 'USER_DISCORD_TOKEN',
    !botToken && 'DISCORD_TOKEN',
    !botId && 'LUCY_BOT_ID',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`❌ Variabel belum ada: ${missing.join(', ')}`);
    console.error('   USER_DISCORD_TOKEN diisi token akun sendiri (bukan token bot).');
    return false;
  }
  return true;
}

// Bot menjawab dengan pesan baru, lalu hasil akhirnya menimpa pesan yang sama.
// Tunggu sampai isi pesan berhenti berubah agar yang dibaca adalah hasil akhir.
async function waitReply(afterId, { timeout = 120000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const msgs = await call(botToken, `/channels/${CHANNEL}/messages?limit=15`);
    const mine = msgs.filter(m => m.author.id === botId && BigInt(m.id) > BigInt(afterId));
    if (mine.length) {
      const current = mine[0];
      const sig = JSON.stringify(current.embeds?.[0] || current.content);
      if (sig === last) {
        if (++stable >= 2) return current;
      } else {
        last = sig;
        stable = 0;
      }
    }
    await sleep(1000);
  }
  return null;
}

function render(label, msg) {
  if (!msg) {
    console.log(`  ✖ ${label}: bot tidak menjawab (timeout)`);
    return null;
  }
  const embed = msg.embeds?.[0];
  console.log(`  ${label}`);
  if (embed?.title) console.log(`    [${embed.title}]`);
  for (const line of String(embed?.description || msg.content || '').split('\n')) {
    if (line.trim()) console.log(`    ${line}`);
  }
  for (const field of embed?.fields || []) {
    const [first] = String(field.value).split('\n');
    console.log(`    • ${field.name}: ${first}`);
  }
  return embed;
}

(async () => {
  if (!preflight()) process.exit(2);

  try {
    const me = await call(userToken, '/users/@me');
    console.log(`Login sebagai ${me.username} (${me.id})\n`);
  } catch (err) {
    console.error(`❌ Token user ditolak Discord: ${err.message}`);
    process.exit(2);
  }
  try {
    await call(botToken, '/users/@me');
  } catch (err) {
    console.error(`❌ Token bot ditolak Discord: ${err.message}`);
    process.exit(2);
  }

  const created = [];
  async function run(label, command) {
    const sent = await call(userToken, `/channels/${CHANNEL}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: command }),
    });
    created.push(sent.id);
    const reply = await waitReply(sent.id);
    render(`${label}  »  ${command}`, reply);
    console.log();
    return reply;
  }

  console.log('=== 1. user belum punya tim ===');
  await run('sim global', `${PREFIX} sim global`);
  await run('sim biasa', `${PREFIX} sim`);

  console.log('=== 2. buat tim sementara ===');
  await run('team new', `${PREFIX} team new ${TEAM}`);
  await run('team add', `${PREFIX} team add 1 ${ANIMAL}`);
  await run('team use', `${PREFIX} team use ${TEAM}`);

  console.log('=== 3. simulasi global sebagai user baru ===');
  await run('sim global', `${PREFIX} sim global -m 10`);

  console.log('=== 4. bersih-bersih ===');
  await run('team del', `${PREFIX} team del ${TEAM}`);

  if (!KEEP) {
    for (const id of created) {
      await call(userToken, `/channels/${CHANNEL}/messages/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    console.log('Pesan uji dihapus (pakai --keep untuk menyimpannya).');
  }
})().catch(err => {
  console.error(`GAGAL: ${err.message}`);
  process.exit(1);
});
