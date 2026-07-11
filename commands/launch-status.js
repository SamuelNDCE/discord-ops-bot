const { SlashCommandBuilder } = require('discord.js');
const path = require('node:path');
const { shopifyQuery, BUSINESS_NAME } = require('../lib');
const launchWatch = require('../launch-watch');

const QUERY_FILE = path.join(__dirname, '..', 'queries', 'launch-status.graphql');

// Manually tracked — not visible via the Shopify API. Edit this list as your own blockers clear.
const MANUAL_BLOCKERS = [
  // 'Example: waiting on supplier product images',
  // 'Example: business bank account application pending',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('launch-status')
    .setDescription(`Show what's blocking ${BUSINESS_NAME} from going live`),
  async execute(interaction) {
    await interaction.deferReply();
    launchWatch.checkOnce().catch(() => {}); // also refresh the background watcher's baseline + alert #change-log if anything moved

    let data;
    try {
      data = await shopifyQuery(QUERY_FILE);
    } catch (err) {
      await interaction.editReply(`Launch status check failed: ${String(err.message).slice(0, 1500)}`);
      return;
    }

    const passwordWalled = data.onlineStore.passwordProtection.enabled;
    const customDomain = !data.shop.primaryDomain.host.endsWith('.myshopify.com');
    const { count: total } = data.productsCount;
    const { count: active } = data.activeProductsCount;

    const live = [
      `${passwordWalled ? '🔒' : '✅'} Storefront password: ${passwordWalled ? 'ON (visitors blocked)' : 'OFF (public)'}`,
      `${customDomain ? '✅' : '🔒'} Domain: ${data.shop.primaryDomain.host}${customDomain ? '' : ' (default, no custom domain yet)'}`,
      `${active > 0 ? '✅' : '🔒'} Products: ${active}/${total} active`,
    ];

    const manual = MANUAL_BLOCKERS.map((b) => `🔒 ${b}`);

    await interaction.editReply(
      [
        `**${data.shop.name} — launch status**`,
        '_Live from Shopify:_',
        ...live,
        '',
        '_Manually tracked (not API-visible, may be stale):_',
        ...manual,
      ].join('\n')
    );
  },
};
