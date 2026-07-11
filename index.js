require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Events, Partials } = require('discord.js');
const todoStore = require('./todo-store');
const progressMap = require('./progress-map');
const { postToChangelog } = require('./lib');

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  throw new Error('Set DISCORD_TOKEN in discord-bot/.env first');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Reaction events only fire for cached messages by default — the todo list needs to catch
  // reactions on items posted before the bot's last restart too, so old messages/reactions
  // must be fetchable instead of silently dropped.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.commands = new Collection();

for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(__dirname, 'commands', file));
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, (c) => {
  console.log(`Hub bot online as ${c.user.tag}`);
  require('./reminders-store').scheduleAllPending(client);
  require('./daily-summary').start(client);
  require('./launch-watch').start();
  require('./order-watch').start();
  require('./store-audit-watch').start();
  require('./meta-ads-watch').start();
  require('./fb-auto-post').start();
  require('./netlify-watch').start();
  require('./contact-watch').start(client);
  require('./email-watch').start(client);
  require('./support-email-watch').start();
  require('./support-reply-bridge').start(client);
  require('./news-watch').start();
  require('./free-games-watch').start(client);
});

// Reacting is the entire #todo-list UX: 🙋 start, ✅ finish, ❌ remove — ignore the bot's own
// auto-added reactions (added when a task is posted) so they never self-trigger any of the three.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const emoji = reaction.emoji.name;

    if (emoji === todoStore.DONE_EMOJI) {
      const todo = todoStore.markDone(reaction.message.id, user.username);
      if (todo) await todoStore.renderMessage(todo);
      return;
    }

    if (emoji === todoStore.REMOVE_EMOJI) {
      const removed = todoStore.removeTodo(reaction.message.id);
      if (removed) await todoStore.deleteMessage(reaction.message.id);
      return;
    }

    if (emoji === todoStore.CLAIM_EMOJI) {
      const todo = todoStore.claimByReaction(reaction.message.id, user.username, user.id);
      if (!todo) return;
      await todoStore.renderMessage(todo);

      const area = progressMap.getArea(user.id);
      if (area) await postToChangelog(area, await todoStore.buildStartedMessage(todo));

      // No ephemeral reply exists for a reaction (unlike /todo accept) — DM the same quick
      // guide instead, same pattern as contact-watch.js's DM alerts. Not fatal if DMs are closed.
      const guide =
        `You've started: "${todo.text}".` +
        (area
          ? ` Logged to your **${area}** progress channel.`
          : ` No progress channel registered for you yet — run \`/todo myprogress area:<your-area>\` once to enable that.`) +
        `\n\n📋 Post updates as you work with \`/log area:${area || '<your-area>'} update:"..."\`, react ${todoStore.DONE_EMOJI} on it in <#${todoStore.TODO_CHANNEL_ID}> when done, or ${todoStore.REMOVE_EMOJI} to remove it.`;
      try {
        await user.send(guide);
      } catch {
        // DMs closed — the task state itself is already updated, this is just a nice-to-have
      }
    }
  } catch (err) {
    console.error('[todo] reaction handling failed:', err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const reply = { content: 'Something went wrong running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(DISCORD_TOKEN);
