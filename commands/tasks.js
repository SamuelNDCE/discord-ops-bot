const { SlashCommandBuilder } = require('discord.js');
const { replyChunks, readBoard, OPEN_BOARD_SECTIONS } = require('../lib');

const MAX_PER_SECTION = 8;

module.exports = {
  data: new SlashCommandBuilder().setName('tasks').setDescription('Show open items from the NV task board'),
  async execute(interaction) {
    await interaction.deferReply();

    let sections;
    try {
      sections = readBoard();
    } catch (err) {
      await interaction.editReply(`Couldn't read the task board: ${err.message}`);
      return;
    }

    const lines = ['**NV Task Board — open items**'];
    let total = 0;
    for (const name of OPEN_BOARD_SECTIONS) {
      const items = sections[name] || [];
      if (!items.length) continue;
      lines.push(`\n**${name}** (${items.length})`);
      for (const title of items.slice(0, MAX_PER_SECTION)) lines.push(`- ${title}`);
      if (items.length > MAX_PER_SECTION) lines.push(`  …and ${items.length - MAX_PER_SECTION} more`);
      total += items.length;
    }
    if (total === 0) lines.push('Nothing open — board is clear.');

    await replyChunks(interaction, lines.join('\n'));
  },
};
