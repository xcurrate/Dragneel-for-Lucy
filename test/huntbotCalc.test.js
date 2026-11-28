const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../src/services/huntbotCalc');

function text(content) {
  return { type: 10, content };
}

function sampleMessage(overrides = {}) {
  return {
    id: '1575468906720657499',
    channelId: '1563479019624857710',
    guildId: '1554454222416646145',
    author: { id: '1438615298012872817', bot: true },
    components: [{
      type: 17,
      components: [
        text('## nnneozen - HuntBot\n-# Berburu'),
        text('### HUNTBOT sedang berburu!\n> `[■■■■]` **97.02%**'),
        text('### Trait HuntBot'),
        text('> **Tema Satu**\n> `Lvl 215 [MAX]`\n\n> **Tema Dua**\n> `Lvl 124 [3017/36706]`'),
        text('> **Tema Tiga**\n> `Lvl 5 [MAX]`\n\n> **Tema Empat**\n> `Lvl 200 [MAX]`'),
        text('> **Tema Lima**\n> `Lvl 200 [MAX]`\n\n> **Tema Enam**\n> `Lvl 86 [755626/3529946]`'),
        text('Essence Hewan — `492,463`\n-# `Max Autohunt saat ini: 3,096 hewan, 64,500 essence, dan 90,300 xp untuk 15,480 lucent`'),
        text('Gain - `5000 essence/H`'),
      ],
    }],
    ...overrides,
  };
}

describe('huntbot calculation formula', () => {
  it('matches the validated MAX ALL and per-trait values', () => {
    assert.equal(calc.MAX_ALL, 451002857406);
    assert.equal(calc.cumulativeXp(100, calc.TRAITS.find(t => t.key === 'radar')), 145367518);
    const efficiency = calc.TRAITS.find(t => t.key === 'efficiency');
    assert.equal(calc.cumulativeXp(200, efficiency) - calc.cumulativeXp(100, efficiency), 6556464);
  });
});

describe('huntbot message parsing', () => {
  it('reads six ordered Lvl fields even when labels are themed', () => {
    const parsed = calc.parseHuntBotMessage(sampleMessage());
    assert.ok(parsed);
    assert.deepEqual(parsed.traits.map(t => t.level), [215, 124, 5, 200, 200, 86]);
    assert.deepEqual(parsed.traits.map(t => t.currentXp), [0, 3017, 0, 0, 0, 755626]);
    assert.equal(parsed.ownedEssence, 492463);
    assert.deepEqual(parsed.autohunt, { animals: 3096, essence: 64500, xp: 90300, lucent: 15480 });
    assert.equal(parsed.gainPerHour, 5000);
  });

  it('tetap membaca kartu saat field intro dihapus', () => {
    const message = sampleMessage();
    message.components[0].components = message.components[0].components.slice(2);
    const parsed = calc.parseHuntBotMessage(message);
    assert.ok(parsed);
    assert.deepEqual(parsed.traits.map(t => t.level), [215, 124, 5, 200, 200, 86]);
  });

  it('accepts the Animal Essence label and normal embed fields', () => {
    const message = { id: '1', embeds: [{ title: 'Trait HuntBot', fields: [
      { name: 'A', value: 'Lvl 10 [100/200]' },
      { name: 'B', value: 'Lvl 20 [MAX]' },
      { name: 'C', value: 'Lvl 30 [0/100]' },
      { name: 'D', value: 'Lvl 40 [MAX]' },
      { name: 'E', value: 'Lvl 50 [10/20]' },
      { name: 'F', value: 'Lvl 60 [0/10]' },
      { name: 'Essence', value: 'Animal Essence - `1,234`' },
    ] }] };
    const parsed = calc.parseHuntBotMessage(message);
    assert.ok(parsed);
    assert.deepEqual(parsed.traits.map(t => t.level), [10, 20, 30, 40, 50, 60]);
    assert.equal(parsed.ownedEssence, 1234);
  });

  it('calculates remaining essence for the sample HuntBot', () => {
    const parsed = calc.parseHuntBotMessage(sampleMessage());
    const result = calc.calculate(parsed, {});
    assert.equal(result.total, 450884680804);
    assert.equal(result.remaining, 450884188341);
    assert.equal(result.rows.find(row => row.key === 'duration').cost, 7713299);
    assert.equal(result.rows.find(row => row.key === 'radar').cost, 450876967505);
  });

  it('supports per-trait and all-level targets', () => {
    const parsed = calc.parseHuntBotMessage(sampleMessage());
    assert.equal(calc.calculate(parsed, { targets: { radar: 250 } }).total, 3467330644);
    assert.equal(calc.calculate(parsed, { all: 100 }).total, 58624059);
    assert.equal(calc.calculate(parsed, { targets: { radar: '+25' } }).total, 122355160);
  });
});

describe('huntbot command parsing', () => {
  it('parses the command with the configured prefix or !', () => {
    assert.deepEqual(calc.parseCommand('!hbcalc radar=250', 'd'), { args: ['radar=250'] });
    assert.deepEqual(calc.parseCommand('dhbcalc', 'd'), { args: [] });
    assert.deepEqual(calc.parseCommand('! hbcalc', 'd'), { args: [] });
  });

  it('parses targets, relative levels, essence override, and source', () => {
    const options = calc.parseOptions(['radar=+25', 'all=100', 'essence=1,000,000', 'animals', '1575468906720657499']);
    assert.equal(options.targets.radar, '+25');
    assert.equal(options.all, '100');
    assert.equal(options.ownedEssence, 1000000);
    assert.equal(options.animals, true);
    assert.deepEqual(options.source, { type: 'id', id: '1575468906720657499' });
  });
});

describe('huntbot output and reactions', () => {
  it('keeps every embed page below 2000 characters', () => {
    const parsed = calc.parseHuntBotMessage(sampleMessage());
    const embeds = calc.buildCalculationEmbeds(calc.calculate(parsed, {}));
    assert.ok(embeds.length >= 1);
    for (const embed of embeds) {
      assert.ok(embed.toJSON().description.length < 2000);
    }
  });

  it('auto-reacts to a Lucy HuntBot message', async () => {
    const reactions = [];
    const message = sampleMessage({ react: async emoji => reactions.push(emoji) });
    assert.equal(await calc.autoReact(message), true);
    assert.deepEqual(reactions, ['📊']);
  });

  it('replies to a 📊 reaction with a strict payload', async () => {
    let payload;
    const message = sampleMessage({ reply: async value => { payload = value; } });
    const handled = await calc.handleReaction({ emoji: { name: '📊' }, message }, { id: 'user-1', bot: false });
    assert.equal(handled, true);
    assert.equal(payload.allowedMentions.parse.length, 0);
    assert.equal(payload.allowedMentions.repliedUser, false);
    const description = payload.embeds[0].toJSON().description;
    assert.match(description, /Total:/);
    assert.match(description, /Lucent:/);
    assert.doesNotMatch(description, /Cowoncy/i);
  });
});
