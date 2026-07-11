const { SlashCommandBuilder } = require('discord.js');
const { askOllama, replyChunks } = require('../lib');
const memory = require('../ask-memory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Prompt the local AI (remembers recent context per-user, per-channel)')
    .addStringOption((option) =>
      option.setName('prompt').setDescription('What do you want to ask?').setRequired(true)
    )
    .addBooleanOption((option) =>
      option.setName('new').setDescription('Start a fresh conversation, ignoring earlier context')
    ),
  async execute(interaction) {
    await interaction.deferReply();
    const prompt = interaction.options.getString('prompt', true);
    const startNew = interaction.options.getBoolean('new') ?? false;

    if (startNew) memory.clear(interaction.channelId, interaction.user.id);

    try {
      const history = memory.getHistory(interaction.channelId, interaction.user.id);
      const text = await askOllama([...history, { role: 'user', content: prompt }]);

      memory.append(interaction.channelId, interaction.user.id, 'user', prompt);
      memory.append(interaction.channelId, interaction.user.id, 'assistant', text);

      await replyChunks(interaction, text);
    } catch (err) {
      await interaction.editReply(err.message);
    }
  },
};
