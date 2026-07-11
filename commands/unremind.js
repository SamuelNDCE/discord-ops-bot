const { SlashCommandBuilder } = require('discord.js');
const store = require('../reminders-store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unremind')
    .setDescription('Cancel a pending reminder')
    .addStringOption((o) => o.setName('id').setDescription('id shown by /reminders').setRequired(true)),
  async execute(interaction) {
    const id = interaction.options.getString('id', true);
    const ok = store.cancel(id);
    await interaction.reply({
      content: ok ? `Cancelled reminder \`${id}\`.` : `No pending reminder with id \`${id}\`.`,
      ephemeral: !ok,
    });
  },
};
