const { SlashCommandBuilder } = require('discord.js');
const store = require('../todo-store');
const progressMap = require('../progress-map');
const { replyChunks, postToChangelog, changelogAreaExists, listChangelogAreas } = require('../lib');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('todo')
    .setDescription(
      `Shared team todo list in #todo-list — react ${store.CLAIM_EMOJI} to start, ${store.DONE_EMOJI} to finish, ${store.REMOVE_EMOJI} to remove`
    )
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Add a task')
        .addStringOption((o) => o.setName('task').setDescription('What needs doing').setRequired(true))
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('Show open tasks'))
    .addSubcommand((sc) =>
      sc
        .setName('accept')
        .setDescription("Claim a task as in-progress — logs it to your progress channel")
        .addStringOption((o) =>
          o.setName('task').setDescription('The task, or part of its text').setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Remove a task entirely (same as reacting ❌ on it)')
        .addStringOption((o) =>
          o.setName('task').setDescription('The task, or part of its text').setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('edit')
        .setDescription("Edit a task's text — re-syncs the post, refreshes progress channel if accepted")
        .addStringOption((o) =>
          o.setName('task').setDescription('The task, or part of its text').setRequired(true)
        )
        .addStringOption((o) => o.setName('newtext').setDescription('The new task text').setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName('myprogress')
        .setDescription('One-time: register which changelog area is your progress channel')
        .addStringOption((o) =>
          o.setName('area').setDescription('e.g. samuel-progress, owens-progress').setRequired(true)
        )
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const task = interaction.options.getString('task', true);
      const result = await store.addTodo({ text: task, addedBy: interaction.user.username });
      await interaction.reply({
        content: result.ok
          ? `Added to <#${store.TODO_CHANNEL_ID}>. React ${store.CLAIM_EMOJI}/${store.DONE_EMOJI}/${store.REMOVE_EMOJI} there to start/finish/remove it.`
          : `Failed: ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const query = interaction.options.getString('task', true);
      const result = store.removeByQuery(query);
      if (!result.ok) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }
      await store.deleteMessage(result.todo.messageId);
      await interaction.reply({ content: `Removed: "${result.todo.text}".`, ephemeral: true });
      return;
    }

    if (sub === 'myprogress') {
      const area = interaction.options.getString('area', true).toLowerCase().trim();
      if (!changelogAreaExists(area)) {
        await interaction.reply({
          content: `No changelog area "${area}" exists yet. Existing: ${listChangelogAreas().join(', ')}.`,
          ephemeral: true,
        });
        return;
      }
      progressMap.setArea(interaction.user.id, area);
      await interaction.reply({ content: `Got it — your progress area is now "${area}".`, ephemeral: true });
      return;
    }

    if (sub === 'edit') {
      const query = interaction.options.getString('task', true);
      const newtext = interaction.options.getString('newtext', true);
      const result = await store.editTodo({ query, newText: newtext });
      if (!result.ok) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }
      const pushed = Boolean(result.todo.acceptedById && progressMap.getArea(result.todo.acceptedById));
      await interaction.reply({
        content: `Updated: "${result.todo.text}".${pushed ? ' Pushed a fresh update to the progress channel too.' : ''}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'accept') {
      const query = interaction.options.getString('task', true);
      const result = await store.acceptTodo({
        query,
        acceptedBy: interaction.user.username,
        acceptedById: interaction.user.id,
      });
      if (!result.ok) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }
      await store.renderMessage(result.todo);

      const area = progressMap.getArea(interaction.user.id);
      let progressLine;
      if (area) {
        await postToChangelog(area, await store.buildStartedMessage(result.todo));
        progressLine = `Logged to your **${area}** channel.`;
      } else {
        progressLine = `No progress channel registered for you yet — run \`/todo myprogress area:<your-area>\` once (e.g. \`samuel-progress\`) so this logs there automatically next time.`;
      }
      await interaction.reply({
        content:
          `You've accepted: "${result.todo.text}". ${progressLine}\n\n` +
          `📋 Quick guide: post updates as you work with \`/log area:${area || '<your-area>'} update:"..."\`, ` +
          `react ${store.DONE_EMOJI} on it in <#${store.TODO_CHANNEL_ID}> when it's finished, or ${store.REMOVE_EMOJI} to remove it.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();
    const open = store.listOpen();
    if (!open.length) {
      await interaction.editReply('Nothing open — todo list is clear.');
      return;
    }
    const lines = open.map((t) =>
      t.acceptedBy ? `🔵 ${t.text} _(added by ${t.addedBy}, in progress: ${t.acceptedBy})_` : `☐ ${t.text} _(added by ${t.addedBy})_`
    );
    await replyChunks(interaction, lines.join('\n'));
  },
};
