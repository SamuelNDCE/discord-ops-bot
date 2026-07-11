require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  throw new Error('Set DISCORD_TOKEN and GUILD_ID in discord-bot/.env first');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channels = await guild.channels.fetch();
    const changes = channels.find((c) => c.name === 'changes' && c.type === ChannelType.GuildText);
    if (!changes) throw new Error('#changes channel not found — run setup-channels.js first');

    const webhooks = await changes.fetchWebhooks();
    let hook = webhooks.find((w) => w.name === 'commit-notifier');
    if (hook) {
      console.log('Webhook already exists, reusing it.');
    } else {
      hook = await changes.createWebhook({ name: 'commit-notifier' });
      console.log('Created webhook.');
    }

    fs.writeFileSync(
      path.join(__dirname, 'changes-webhook.json'),
      JSON.stringify({ url: hook.url }, null, 2)
    );
    console.log('Saved discord-bot/changes-webhook.json');
  } catch (err) {
    console.error('Failed to set up webhook:', err.message);
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_TOKEN);
