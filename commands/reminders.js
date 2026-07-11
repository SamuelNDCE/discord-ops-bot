const { SlashCommandBuilder } = require('discord.js');
const store = require('../reminders-store');
const { replyChunks } = require('../lib');

module.exports = {
  data: new SlashCommandBuilder().setName('reminders').setDescription('List pending reminders'),
  async execute(interaction) {
    await interaction.deferReply();

    const pending = store.list();
    if (!pending.length) {
      await interaction.editReply('No pending reminders.');
      return;
    }

    const lines = pending.map((r) => {
      const mins = Math.max(0, Math.round((r.fireAt - Date.now()) / 60_000));
      return `\`${r.id}\` <@${r.userId}> in ${mins}m — "${r.message}"`;
    });
    await replyChunks(interaction, lines.join('\n'));
  },
};
