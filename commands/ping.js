const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the hub bot is alive'),
  async execute(interaction) {
    await interaction.reply(`Pong. Latency: ${Date.now() - interaction.createdTimestamp}ms`);
  },
};
