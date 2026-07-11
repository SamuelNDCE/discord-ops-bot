require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  throw new Error('Set DISCORD_TOKEN and GUILD_ID in discord-bot/.env first');
}

const CHANNELS = [
  { name: 'changes', topic: "Post what you're working on so the other person can see." },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const existing = await guild.channels.fetch();

    for (const { name, topic } of CHANNELS) {
      const found = existing.find((c) => c.name === name && c.type === ChannelType.GuildText);
      if (found) {
        console.log(`#${name} already exists, skipping.`);
        continue;
      }
      const channel = await guild.channels.create({ name, type: ChannelType.GuildText, topic });
      console.log(`Created #${channel.name}`);
    }
  } catch (err) {
    console.error('Failed to set up channels:', err.message);
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_TOKEN);
