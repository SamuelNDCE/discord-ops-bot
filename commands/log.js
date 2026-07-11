const { SlashCommandBuilder } = require('discord.js');
const { postToChangelog, changelogAreaExists, listChangelogAreas } = require('../lib');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('log')
    .setDescription('Post an update to a change log so the other person can see what you did')
    .addStringOption((o) => o.setName('update').setDescription('What did you do?').setRequired(true))
    .addStringOption((o) =>
      o.setName('area').setDescription('Which changelog? (default: general). New area? Use /setup-changelog first.')
    ),
  async execute(interaction) {
    const update = interaction.options.getString('update', true);
    const area = (interaction.options.getString('area') || 'general').toLowerCase().trim();

    if (!changelogAreaExists(area)) {
      await interaction.reply({
        content: `No changelog set up for "${area}" yet. Existing: ${listChangelogAreas().join(', ')}. Run \`/setup-changelog name:${area}\` to create it.`,
        ephemeral: true,
      });
      return;
    }

    const { ok } = await postToChangelog(area, `📝 **[${area}] ${interaction.user.username}**: ${update}`);
    await interaction.reply({ content: ok ? `Logged to ${area}.` : 'Failed to post.', ephemeral: true });
  },
};
