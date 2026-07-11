const { SlashCommandBuilder, ChannelType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const WEBHOOKS_DIR = path.join(__dirname, '..', 'webhooks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-changelog')
    .setDescription('Create/fix a changelog channel + category for an area (e.g. meta-ads) — safe to re-run')
    .addStringOption((o) => o.setName('name').setDescription('Area name, e.g. meta-ads').setRequired(true)),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const area = interaction.options
      .getString('name', true)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!area) {
      await interaction.editReply('Give it a valid name (letters, numbers, dashes).');
      return;
    }

    const categoryName = area.toUpperCase();
    const channelName = `${area}-changelog`;

    try {
      let category = interaction.guild.channels.cache.find(
        (c) => c.name === categoryName && c.type === ChannelType.GuildCategory
      );
      if (!category) {
        category = await interaction.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
      }

      let channel = interaction.guild.channels.cache.find(
        (c) => c.name === channelName && c.type === ChannelType.GuildText
      );
      if (!channel) {
        channel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `Automated change log for ${area}.`,
        });
      } else if (channel.parentId !== category.id) {
        await channel.setParent(category.id);
      }

      const webhooks = await channel.fetchWebhooks();
      let hook = webhooks.find((w) => w.name === 'change-notifier');
      if (!hook) hook = await channel.createWebhook({ name: 'change-notifier' });

      fs.mkdirSync(WEBHOOKS_DIR, { recursive: true });
      fs.writeFileSync(path.join(WEBHOOKS_DIR, `${area}.json`), JSON.stringify({ url: hook.url }, null, 2));

      await interaction.editReply(
        `#${channelName} is set up under **${categoryName}**. Use \`/log area:${area} update:"..."\` to post there right now. Automated tracking for it (like Shopify/Netlify have) still needs real code + credentials for whatever platform this is.`
      );
    } catch (err) {
      await interaction.editReply(`Failed: ${err.message}`);
    }
  },
};
