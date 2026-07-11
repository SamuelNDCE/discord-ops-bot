const { SlashCommandBuilder } = require('discord.js');
const path = require('node:path');
const { shopifyQuery } = require('../lib');

const QUERY_FILE = path.join(__dirname, '..', 'queries', 'store-stats.graphql');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show Shopify store stats (orders, products, revenue)'),
  async execute(interaction) {
    await interaction.deferReply();

    let data;
    try {
      data = await shopifyQuery(QUERY_FILE);
    } catch (err) {
      await interaction.editReply(`Shopify stats failed: ${String(err.message).slice(0, 1500)}`);
      return;
    }

    const revenue = data.orders.edges.reduce(
      (sum, { node }) => sum + Number(node.totalPriceSet.shopMoney.amount),
      0
    );
    const currency = data.orders.edges[0]?.node.totalPriceSet.shopMoney.currencyCode ?? 'GBP';

    await interaction.editReply(
      [
        `**${data.shop.name}**`,
        `Orders (paid): ${data.ordersCount.count}${data.ordersCount.precision === 'AT_LEAST' ? '+' : ''}`,
        `Revenue (paid, last 250 orders): ${revenue.toFixed(2)} ${currency}`,
        `Products: ${data.productsCount.count} total, ${data.activeProductsCount.count} active`,
        `Customers: ${data.customersCount.count}`,
      ].join('\n')
    );
  },
};
