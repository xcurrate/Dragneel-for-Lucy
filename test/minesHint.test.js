const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const hint = require('../src/services/minesHint');

const PLAYER = '1515658233174294569';

function button(index, opened = false) {
  return {
    type: 2,
    custom_id: `mines_tile_${index}`,
    ...(opened ? { disabled: true } : {}),
    emoji: opened ? { name: '💎' } : { id: '1522595651571941560', name: 'blank', animated: false },
    label: null,
    style: 2,
  };
}

function row(ids, disabled = []) {
  return { type: 1, components: ids.map(id => button(id, disabled.includes(id))) };
}

function minesMessage({ disabled = [], next = '1 (1.41x)', cashout = '—' } = {}) {
  return {
    id: '1576266407027413134',
    channelId: '1563479019624857710',
    guildId: '1554454222416646145',
    author: { id: '1438615298012872817', bot: true },
    components: [{
      type: 17,
      components: [
        { type: 10, content: `# 💣 <@${PLAYER}> sedang bermain mines.` },
        { type: 10, content: `-# **Taruhan:** \`1\` **Ranjau:** \`3\`\n-# **Cash Out:** ${cashout}\n-# **Berikutnya:** \`1\` (${next}x)` },
        row([0, 1, 2], disabled),
        row([3, 4, 5], disabled),
        row([6, 7, 8], disabled),
      ],
    }],
  };
}

describe('mines board parsing', () => {
  it('membaca 3x3, 3 ranjau, multiplier, dan pemain', () => {
    const parsed = hint.parseMinesMessage(minesMessage());
    assert.ok(parsed);
    assert.equal(parsed.playerId, PLAYER);
    assert.equal(parsed.mines, 3);
    assert.equal(parsed.opened, 0);
    assert.equal(parsed.remaining, 9);
    assert.equal(parsed.nextMultiplier, 1.41);
    assert.equal(parsed.cashout, null);
    assert.equal(hint.safeProbability(parsed), 6 / 9);
    assert.equal(hint.recommend(parsed).action, 'open');
  });

  it('menghitung peluang setelah satu tile terbuka', () => {
    const parsed = hint.parseMinesMessage(minesMessage({ disabled: [0] }));
    assert.equal(parsed.opened, 1);
    assert.equal(parsed.remaining, 8);
    assert.equal(hint.safeProbability(parsed), 5 / 8);
  });

  it('membaca tile terbuka dari disabled dan emoji 💎 seperti debug asli', () => {
    const parsed = hint.parseMinesMessage(minesMessage({ disabled: [1, 8], cashout: '2 (2.26x)', next: '3 (3.95x)' }));
    assert.equal(parsed.opened, 2);
    assert.equal(parsed.remaining, 7);
    assert.equal(hint.safeProbability(parsed), 4 / 7);
    assert.equal(parsed.cashout, 2.26);
    assert.equal(parsed.nextMultiplier, 3.95);
    assert.equal(hint.recommend(parsed).action, 'cashout');
  });

  it('mengambil versi pesan terbaru saat pesan diedit', async () => {
    const edited = minesMessage({ disabled: [0] });
    let fetchCalls = 0;
    const source = await hint.resolveSource({
      id: 'command',
      reference: { messageId: edited.id, resolved: minesMessage() },
      channel: { messages: { fetch: async () => { fetchCalls += 1; return edited; } } },
    }, {});
    assert.equal(fetchCalls, 1);
    assert.equal(source.message, edited);
    assert.equal((await hint.freshMessage({ fetch: async () => edited })), edited);
  });

  it('mendeteksi papan selesai saat semua tile disabled', () => {
    const parsed = hint.parseMinesMessage(minesMessage({ disabled: [0, 1, 2, 3, 4, 5, 6, 7, 8] }));
    assert.equal(parsed.finished, true);
    assert.equal(hint.recommend(parsed), null);
  });
});

describe('mines recommendation', () => {
  it('menyarankan cashout kalau nilai cashout lebih tinggi dari EV', () => {
    const parsed = hint.parseMinesMessage(minesMessage({ disabled: [0], cashout: '1', next: '1.41' }));
    const result = hint.recommend(parsed);
    assert.equal(result.action, 'cashout');
  });

  it('embed menampilkan peluang dan status', () => {
    const embed = hint.buildHintEmbed(hint.parseMinesMessage(minesMessage())).toJSON();
    assert.equal(embed.title, '💣 Mines Hint');
    assert.match(embed.description, /66,7%/);
    assert.match(embed.description, /BUKA TILE ACAK/);
  });
});

describe('mines command and developer gate', () => {
  it('mem-parsing perintah mhint', () => {
    assert.deepEqual(hint.parseCommand('d mhint', 'd'), { args: [] });
    assert.deepEqual(hint.parseCommand('!mines 1576266407027413134', 'd'), { args: ['1576266407027413134'] });
    assert.equal(hint.parseOptions(['debug']).debug, true);
  });

  it('auto-react hanya untuk papan mines developer', async () => {
    const previous = process.env.DEVELOPER_IDS;
    process.env.DEVELOPER_IDS = PLAYER;
    try {
      const reactions = [];
      assert.equal(await hint.autoReact({ ...minesMessage(), react: async emoji => { reactions.push(emoji); } }), true);
      assert.deepEqual(reactions, ['🎯']);
      const other = minesMessage();
      other.components[0].components[0].content = '# 💣 <@123456789012345678> sedang bermain mines.';
      assert.equal(await hint.autoReact({ ...other, react: async () => {} }), false);
    } finally {
      if (previous == null) delete process.env.DEVELOPER_IDS;
      else process.env.DEVELOPER_IDS = previous;
    }
  });

  it('pengguna non-developer ditolak', async () => {
    let reply = null;
    await hint.handleMessage({
      author: { id: 'user-biasa', bot: false },
      content: 'd mhint',
      reply: async payload => { reply = payload; },
    });
    assert.match(reply.content, /khusus developer/);
  });
});
