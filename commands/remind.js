const { SlashCommandBuilder } = require('discord.js');
const store = require('../reminders-store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a reminder (survives bot restarts)')
    .addStringOption((o) => o.setName('in').setDescription('e.g. 30m, 2h, 1d — max 7d').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true)),
  async execute(interaction) {
    const durationInput = interaction.options.getString('in', true);
    const message = interaction.options.getString('message', true);

    const reminder = store.create(interaction.client, {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      message,
      durationInput,
    });

    if (!reminder) {
      await interaction.reply({ content: 'Use a duration like `30m`, `2h`, or `1d` (max 7d).', ephemeral: true });
      return;
    }

    await interaction.reply(`Got it (id \`${reminder.id}\`) — I'll remind you in ${durationInput}: "${message}"`);
  },
};
