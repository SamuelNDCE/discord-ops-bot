const { SlashCommandBuilder } = require('discord.js');
const path = require('node:path');
const { shopifyQuery, replyChunks, shopifyEventActor, BUSINESS_NAME } = require('../lib');

const QUERY_FILE = path.join(__dirname, '..', 'queries', 'recent-events.graphql');
const MAX_SHOWN = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Show recent Shopify changes — who did what'),
  async execute(interaction) {
    await interaction.deferReply();

    let data;
    try {
      data = await shopifyQuery(QUERY_FILE);
    } catch (err) {
      await interaction.editReply(`Activity check failed: ${String(err.message).slice(0, 1500)}`);
      return;
    }

    const events = data.events.edges.map((e) => e.node).slice(0, MAX_SHOWN); // query is already newest-first
    if (!events.length) {
      await interaction.editReply('No recent activity.');
      return;
    }

    const lines = events.map((e) => {
      const who = shopifyEventActor(e);
      const icon = e.attributeToUser ? '👤' : '🤖';
      const clean = e.message.replace(/<[^>]+>/g, '');
      const when = new Date(e.createdAt).toLocaleString('en-GB', {
        timeZone: 'Europe/London',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `${icon} **${who}** (${when}): ${clean}`;
    });

    await replyChunks(interaction, `**${BUSINESS_NAME} — recent activity**\n${lines.join('\n')}`);
  },
};
