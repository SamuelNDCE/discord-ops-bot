const { SlashCommandBuilder } = require('discord.js');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adactivate')
    .setDescription('Turn a paused Meta ad live (e.g. one staged for creative review)')
    .addStringOption((o) => o.setName('ad_id').setDescription('The Meta ad ID to activate').setRequired(true)),
  async execute(interaction) {
    await interaction.deferReply();
    const adId = interaction.options.getString('ad_id');
    try {
      const res = await fetch(`${GRAPH_API}/${adId}?access_token=${process.env.FB_ACCESS_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'status=ACTIVE',
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message);
      await interaction.editReply(`✅ Ad \`${adId}\` is now ACTIVE.`);
    } catch (err) {
      await interaction.editReply(`Failed to activate \`${adId}\`: ${String(err.message).slice(0, 1500)}`);
    }
  },
};
