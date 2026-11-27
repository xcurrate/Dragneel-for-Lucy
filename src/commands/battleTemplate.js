// Pengelolaan template tim pembanding damage boss.
const templates = require('../services/bossTemplates');
const { usageEmbed, errorEmbed, okEmbed } = require('../ui/battlePanel');

function usage(prefix) {
  return [
    `\`${prefix} sim template\` — lihat daftar template`,
    `\`${prefix} sim template add <komposisi>\` — tambah template (maks ${templates.MAX_TEMPLATES})`,
    `\`${prefix} sim template set <nomor> <komposisi>\` — ganti template`,
    `\`${prefix} sim template remove <nomor>\` — hapus template`,
    `\`${prefix} sim template reset\` — kembalikan template bawaan`,
    '',
    'Contoh komposisi:',
    '`60 lizard pdagger gslay, 60 void2 pdagger gslay, 60 ellie crune dc`',
  ].join('\n');
}

async function listEmbed(guildId) {
  const list = templates.listTemplates(guildId);
  await templates.ensureTemplateEmojis(list.map(item => item.text));
  const lines = list.length
    ? list.map(item => `${item.index}. ${item.display}`)
    : ['Belum ada template. Tambahkan dengan `sim template add`.'];
  return usageEmbed('📋 Template Damage Boss', lines);
}

async function handleTemplateCommand(message, args, prefix, deps = {}) {
  const send = deps.sendEmbed || ((m, embed) => m.reply({ embeds: [embed] }));
  if (!message.guildId) return send(message, errorEmbed('Template hanya bisa diatur di dalam server.'));

  const sub = (args[0] || 'list').toLowerCase();
  if (['help', 'bantuan'].includes(sub)) {
    return send(message, usageEmbed('📋 Template Damage Boss', usage(prefix)));
  }
  if (['list', 'daftar'].includes(sub)) {
    return send(message, await listEmbed(message.guildId));
  }

  const allowed = Boolean(
    (deps.isDeveloper && deps.isDeveloper(message))
    || (deps.isAdmin && deps.isAdmin(message))
  );
  if (!allowed) {
    return send(message, errorEmbed('Hanya developer/admin server yang bisa mengubah template.'));
  }

  if (['add', 'tambah'].includes(sub)) {
    const text = args.slice(1).join(' ').trim();
    if (!text) return send(message, errorEmbed(`Format: \`${prefix} sim template add <komposisi>\`.`));
    const result = templates.addTemplate(message.guildId, text);
    if (result.error) return send(message, errorEmbed(`❌ ${result.error}`));
    return send(message, okEmbed(`✅ Template ditambahkan (${result.templates.length}/${templates.MAX_TEMPLATES}).`));
  }

  if (['set', 'ubah', 'ganti'].includes(sub)) {
    const index = Number(args[1]);
    const text = args.slice(2).join(' ').trim();
    if (!text) return send(message, errorEmbed(`Format: \`${prefix} sim template set <nomor> <komposisi>\`.`));
    const result = templates.setTemplate(message.guildId, index, text);
    if (result.error) return send(message, errorEmbed(`❌ ${result.error}`));
    return send(message, okEmbed(`✅ Template ${index} diganti.`));
  }

  if (['remove', 'hapus', 'del', 'delete'].includes(sub)) {
    const index = Number(args[1]);
    const result = templates.removeTemplate(message.guildId, index);
    if (result.error) return send(message, errorEmbed(`❌ ${result.error}`));
    return send(message, okEmbed(`✅ Template ${index} dihapus. Sisa ${result.templates.length}.`));
  }

  if (['reset', 'bawaan'].includes(sub)) {
    templates.resetTemplates(message.guildId);
    return send(message, okEmbed('✅ Template dikembalikan ke bawaan.'));
  }

  return send(message, usageEmbed('📋 Template Damage Boss', usage(prefix)));
}

module.exports = { handleTemplateCommand, usage };
