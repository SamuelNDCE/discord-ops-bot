require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  throw new Error('Set DISCORD_TOKEN and GUILD_ID in discord-bot/.env first');
}

const { SHOPIFY_CATEGORY_ID, ETSY_CATEGORY_ID } = process.env; // category IDs to create the channels under

const AREAS = [
  { name: 'shopify-changelog', parentId: SHOPIFY_CATEGORY_ID, webhookFile: 'shopify-webhook.json' },
  { name: 'etsy-changelog', parentId: ETSY_CATEGORY_ID, webhookFile: 'etsy-webhook.json' },
  { name: 'ads-changelog', parentId: SHOPIFY_CATEGORY_ID, webhookFile: 'ads-webhook.json' },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channels = await guild.channels.fetch();

    for (const area of AREAS) {
      let channel = channels.find((c) => c.name === area.name && c.type === ChannelType.GuildText);
      if (channel) {
        console.log(`#${area.name} already exists, reusing.`);
      } else {
        channel = await guild.channels.create({
          name: area.name,
          type: ChannelType.GuildText,
          parent: area.parentId,
          topic: `Automated change log for ${area.name.replace('-changelog', '')}.`,
        });
        console.log(`Created #${channel.name}`);
      }

      const webhooks = await channel.fetchWebhooks();
      let hook = webhooks.find((w) => w.name === 'change-notifier');
      if (!hook) {
        hook = await channel.createWebhook({ name: 'change-notifier' });
        console.log(`Created webhook for #${channel.name}`);
      } else {
        console.log(`Webhook already exists for #${channel.name}, reusing.`);
      }

      fs.writeFileSync(
        path.join(__dirname, area.webhookFile),
        JSON.stringify({ url: hook.url }, null, 2)
      );
    }
  } catch (err) {
    console.error('Failed:', err.message);
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_TOKEN);
