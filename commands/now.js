const { SlashCommandBuilder } = require('discord.js');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { shopifyQuery, netlifyApi, replyChunks, shopifyEventActor } = require('../lib');

const EVENTS_QUERY_FILE = path.join(__dirname, '..', 'queries', 'recent-events.graphql');
const REPO_ROOT = path.join(__dirname, '..', '..');
const MAX_PER_SECTION = 8;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('now')
    .setDescription("What's happened across everything in the last hour")
    .addIntegerOption((o) => o.setName('hours').setDescription('How many hours back (default 1)').setMinValue(1).setMaxValue(24)),
  async execute(interaction) {
    await interaction.deferReply();

    const hours = interaction.options.getInteger('hours') ?? 1;
    const since = Date.now() - hours * 3_600_000;
    const sections = [];

    try {
      const data = await shopifyQuery(EVENTS_QUERY_FILE);
      const recent = data.events.edges.map((e) => e.node).filter((e) => new Date(e.createdAt).getTime() > since);
      if (recent.length) {
        const shown = recent.slice(0, MAX_PER_SECTION).map((e) => {
          const clean = e.message.replace(/<[^>]+>/g, '');
          return `  ${e.attributeToUser ? '👤' : '🤖'} ${shopifyEventActor(e)}: ${clean}`;
        });
        if (recent.length > MAX_PER_SECTION) shown.push(`  …and ${recent.length - MAX_PER_SECTION} more`);
        sections.push(`**🛍️ Shopify** (${recent.length})\n${shown.join('\n')}`);
      }
    } catch (err) {
      sections.push(`**🛍️ Shopify:** check failed (${err.message})`);
    }

    try {
      const deploys = await netlifyApi('listSiteDeploys', { per_page: 10 });
      const recent = deploys.filter((d) => new Date(d.created_at).getTime() > since);
      if (recent.length) {
        const shown = recent.map((d) => {
          const icon = d.state === 'ready' ? '✅' : d.state === 'error' ? '❌' : '⏳';
          return `  ${icon} Deploy \`${d.id.slice(0, 8)}\` (${d.context})`;
        });
        sections.push(`**🌐 Netlify** (${recent.length})\n${shown.join('\n')}`);
      }
    } catch (err) {
      sections.push(`**🌐 Netlify:** check failed (${err.message})`);
    }

    try {
      const log = execFileSync(
        'git',
        ['log', `--since=${hours} hours ago`, '--pretty=format:%h|%an|%s'],
        { cwd: REPO_ROOT }
      )
        .toString()
        .trim();
      const commits = log
        .split('\n')
        .filter(Boolean)
        .filter((c) => !c.includes('claude: auto-checkpoint'));
      if (commits.length) {
        const shown = commits.slice(0, MAX_PER_SECTION).map((c) => {
          const [hash, author, subject] = c.split('|');
          return `  \`${hash}\` ${author}: ${subject}`;
        });
        if (commits.length > MAX_PER_SECTION) shown.push(`  …and ${commits.length - MAX_PER_SECTION} more`);
        sections.push(`**💻 Code** (${commits.length})\n${shown.join('\n')}`);
      }
    } catch (err) {
      // best-effort — a broken git check shouldn't fail the whole command
    }

    if (!sections.length) {
      await interaction.editReply(`Nothing in the last ${hours}h.`);
      return;
    }

    await replyChunks(interaction, `**What's happened in the last ${hours}h**\n\n${sections.join('\n\n')}`);
  },
};
