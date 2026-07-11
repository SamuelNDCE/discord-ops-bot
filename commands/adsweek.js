const { SlashCommandBuilder } = require('discord.js');
const { buildWeekSummary } = require('../meta-ads-watch');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adsweek')
    .setDescription('Show the last 7 days of Meta Ads spend vs Shopify revenue'),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      await interaction.editReply(await buildWeekSummary());
    } catch (err) {
      await interaction.editReply(`Meta Ads stats failed: ${String(err.message).slice(0, 1500)}`);
    }
  },
};
