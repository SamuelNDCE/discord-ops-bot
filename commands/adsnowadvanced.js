const { SlashCommandBuilder } = require('discord.js');
const { buildTodayAdvancedSummary } = require('../meta-ads-watch');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adsnowadvanced')
    .setDescription('Meta Ads today-so-far, broken down by age/gender with CTR and conversion rate per segment'),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      await interaction.editReply(await buildTodayAdvancedSummary());
    } catch (err) {
      await interaction.editReply(`Meta Ads stats failed: ${String(err.message).slice(0, 1500)}`);
    }
  },
};
