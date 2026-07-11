const { SlashCommandBuilder } = require('discord.js');
const { netlifyApi, replyChunks, SECOND_BUSINESS_NAME, SECOND_BUSINESS_DOMAIN } = require('../lib');
const { formatDeployLine } = require('../netlify-watch');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deploys')
    .setDescription(`Show recent Netlify deploys for the ${SECOND_BUSINESS_NAME} site`),
  async execute(interaction) {
    await interaction.deferReply();

    let deploys;
    try {
      deploys = await netlifyApi('listSiteDeploys', { per_page: 10 });
    } catch (err) {
      await interaction.editReply(`Deploy check failed: ${String(err.message).slice(0, 1500)}`);
      return;
    }

    if (!deploys.length) {
      await interaction.editReply('No deploys found.');
      return;
    }

    const lines = deploys.map(formatDeployLine);
    await replyChunks(interaction, `**${SECOND_BUSINESS_DOMAIN} — recent deploys**\n${lines.join('\n')}`);
  },
};
