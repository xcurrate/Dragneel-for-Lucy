const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const hint = require('../src/services/blackjackHint');

function message(fields, overrides = {}) {
  return {
    id: '1576257300212228260',
    channelId: '1563479019624857710',
    guildId: '1554454222416646145',
    guild: { ownerId: 'dev-owner', members: { cache: new Map([['dev-owner', { nickname: 'nnneozen', displayName: 'nnneozen', user: { username: 'nnneozen' } }]]) } },
    author: { id: '1438615298012872817', bot: true },
    embeds: [{ fields }],
    ...overrides,
  };
}

function sampleMessage() {
  return message([
    { name: 'Dealer `[10+?]`', value: '<:10h:1541963700536344657> <:cardback:1541961419371843625>', inline: true },
    { name: 'nnneozen `[14]`', value: '<:8s:1541962639259734026> <:6s:1541962567017177120>', inline: true },
  ]);
}

function parsedWith(playerCards, dealerCard = '<:10h:1>') {
  const base = hint.parseBlackjackMessage(sampleMessage());
  const player = hint.handValue(hint.parseCards(playerCards));
  const dealerUp = hint.parseCards(dealerCard)[0];
  return { ...base, playerCards: hint.parseCards(playerCards), player, dealerUp };
}

describe('blackjack card parsing', () => {
  it('membaca kartu player dan upcard dealer dari embed Lucy', () => {
    const parsed = hint.parseBlackjackMessage(sampleMessage());
    assert.ok(parsed);
    assert.equal(parsed.playerName, 'nnneozen');
    assert.equal(parsed.dealerUp.label, '10♥');
    assert.equal(parsed.player.total, 14);
    assert.equal(parsed.player.soft, false);
    assert.deepEqual(parsed.playerCards.map(card => card.label), ['8♠', '6♠']);
    assert.equal(hint.recommend(parsed).action, 'hit');
  });

  it('menghitung Ace sebagai 11 atau 1 sesuai kebutuhan', () => {
    const soft = hint.handValue(hint.parseCards('<:as:1> <:6s:2>'));
    assert.equal(soft.total, 17);
    assert.equal(soft.soft, true);
    const hard = hint.handValue(hint.parseCards('<:as:1> <:6s:2> <:10h:3>'));
    assert.equal(hard.total, 17);
    assert.equal(hard.soft, false);
    const blackjack = hint.handValue(hint.parseCards('<:as:1> <:kh:2>'));
    assert.equal(blackjack.blackjack, true);
  });

  it('mengabaikan pesan selain kartu blackjack', () => {
    assert.equal(hint.parseBlackjackMessage(message([{ name: 'Lain', value: '<:as:1>' }])), null);
  });
});

describe('blackjack basic strategy', () => {
  it('stand pada hard 12 vs 4-6, hit di luar itu', () => {
    assert.equal(hint.recommend(parsedWith('<:8s:1> <:4s:2>', '<:6h:1>')).action, 'stand');
    assert.equal(hint.recommend(parsedWith('<:8s:1> <:4s:2>', '<:7h:1>')).action, 'hit');
  });

  it('stand pada hard 13-16 vs 2-6 dan hard 17+', () => {
    assert.equal(hint.recommend(parsedWith('<:10s:1> <:5s:2>', '<:2h:1>')).action, 'stand');
    assert.equal(hint.recommend(parsedWith('<:10s:1> <:5s:2>', '<:10h:1>')).action, 'hit');
    assert.equal(hint.recommend(parsedWith('<:10s:1> <:7s:2>', '<:10h:1>')).action, 'stand');
  });

  it('soft 18 stand vs 2-8 dan hit vs 9-A', () => {
    assert.equal(hint.recommend(parsedWith('<:as:1> <:7s:2>', '<:8h:1>')).action, 'stand');
    assert.equal(hint.recommend(parsedWith('<:as:1> <:7s:2>', '<:9h:1>')).action, 'hit');
  });

  it('hit pada soft 17 atau kurang', () => {
    assert.equal(hint.recommend(parsedWith('<:as:1> <:6s:2>', '<:6h:1>')).action, 'hit');
  });
});

describe('blackjack command and output', () => {
  it('mem-parsing perintah bjhint', () => {
    assert.deepEqual(hint.parseCommand('d bjhint', 'd'), { args: [] });
    assert.deepEqual(hint.parseCommand('!bj 1576257300212228260', 'd'), { args: ['1576257300212228260'] });
  });

  it('embed hint menampilkan rekomendasi hit/stand', () => {
    const embed = hint.buildHintEmbed(hint.parseBlackjackMessage(sampleMessage())).toJSON();
    assert.equal(embed.title, '🃏 Blackjack Hint');
    assert.match(embed.description, /👊 HIT/);
    assert.match(embed.description, /8♠ \+ 6♠ = \*\*14\*\*/);
  });

  it('auto-react 🎯 khusus developer dan hanya pada kartu blackjack Lucy', async () => {
    const previous = process.env.DEVELOPER_IDS;
    process.env.DEVELOPER_IDS = 'dev-owner';
    try {
      const reactions = [];
      const ok = await hint.autoReact({ ...sampleMessage(), react: async emoji => { reactions.push(emoji); } });
      assert.equal(ok, true);
      assert.deepEqual(reactions, ['🎯']);
      const otherGuild = message([{ name: 'Lain', value: '<:as:1>' }], { guild: { ownerId: 'orang-biasa' }, react: async () => {} });
      assert.equal(await hint.autoReact(otherGuild), false);
      const otherPlayer = message([
        { name: 'Dealer `[10+?]`', value: '<:10h:1> <:cardback:2>' },
        { name: 'orang-lain `[14]`', value: '<:8s:3> <:6s:4>' },
      ], { react: async () => {} });
      assert.equal(await hint.autoReact(otherPlayer), false);
    } finally {
      if (previous == null) delete process.env.DEVELOPER_IDS;
      else process.env.DEVELOPER_IDS = previous;
    }
  });

  it('pengguna non-developer ditolak saat memakai perintah', async () => {
    let replyPayload = null;
    const handled = await hint.handleMessage({
      author: { id: 'user-biasa', bot: false },
      content: 'd bjhint',
      reply: async payload => { replyPayload = payload; },
    });
    assert.equal(handled, true);
    assert.match(replyPayload.content, /khusus developer/);
  });

  it('developer menerima hint lewat DM, bukan pesan publik', async () => {
    const previous = process.env.DEVELOPER_IDS;
    process.env.DEVELOPER_IDS = 'dev-owner';
    try {
      let dm = null;
      let replied = false;
      const source = sampleMessage();
      source.reply = async () => { replied = true; };
      const handled = await hint.handleReaction({
        emoji: { name: '🎯' },
        message: source,
        client: null,
      }, {
        id: 'dev-owner',
        bot: false,
        send: async payload => { dm = payload; },
      });
      assert.equal(handled, true);
      assert.equal(replied, false);
      assert.equal(dm.embeds[0].toJSON().title, '🃏 Blackjack Hint');
    } finally {
      if (previous == null) delete process.env.DEVELOPER_IDS;
      else process.env.DEVELOPER_IDS = previous;
    }
  });

  it('mengabaikan reaksi pada pesan mines', async () => {
    let replied = false;
    const handled = await hint.handleReaction({
      emoji: { name: '🎯' },
      message: { id: 'mines', components: [{ type: 17, components: [] }], reply: async () => { replied = true; } },
    }, { id: 'user-biasa', bot: false });
    assert.equal(handled, false);
    assert.equal(replied, false);
  });

  it('pengguna non-developer ditolak saat menekan reaksi hint', async () => {
    let replyPayload = null;
    const source = sampleMessage();
    source.reply = async payload => { replyPayload = payload; };
    const handled = await hint.handleReaction({
      emoji: { name: '🎯' },
      message: source,
      client: null,
    }, { id: 'user-biasa', bot: false });
    assert.equal(handled, true);
    assert.match(replyPayload.content, /khusus developer/);
  });
});
