const { SlashCommandBuilder } = require('discord.js');
const { fetchBusinessNews, formatNewsItem, replyChunks } = require('../lib');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('news')
    .setDescription('Show the latest business-relevant news for the businesses this bot tracks'),
  async execute(interaction) {
    await interaction.deferReply();

    let items;
    try {
      items = await fetchBusinessNews(3, 1, 24);
    } catch (err) {
      await interaction.editReply(`News check failed: ${String(err.message).slice(0, 1500)}`);
      return;
    }

    if (!items.length) {
      await interaction.editReply('No genuinely recent relevant news found in the last day.');
      return;
    }

    const byTopic = {};
    for (const item of items) (byTopic[item.topic] ||= []).push(item);

    const lines = ['📰 **Latest business-relevant news:**'];
    for (const [topic, topicItems] of Object.entries(byTopic)) {
      lines.push(`\n_${topic}:_`);
      for (const item of topicItems) lines.push(await formatNewsItem(item));
    }

    await replyChunks(interaction, lines.join('\n'));
  },
};
