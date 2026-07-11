const { SlashCommandBuilder } = require('discord.js');
const { buildTodaySummary } = require('../meta-ads-watch');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adsnow')
    .setDescription("Meta Ads spend right now (today so far) — don't wait for the hourly post"),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      await interaction.editReply(await buildTodaySummary());
    } catch (err) {
      await interaction.editReply(`Meta Ads stats failed: ${String(err.message).slice(0, 1500)}`);
    }
  },
};
