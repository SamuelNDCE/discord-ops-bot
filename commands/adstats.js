const { SlashCommandBuilder } = require('discord.js');
const { buildAdsSummary } = require('../meta-ads-watch');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adstats')
    .setDescription("Show yesterday's Meta Ads spend, reach, and conversions"),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      await interaction.editReply(await buildAdsSummary());
    } catch (err) {
      await interaction.editReply(`Meta Ads stats failed: ${String(err.message).slice(0, 1500)}`);
    }
  },
};
