const fs = require('node:fs');
const path = require('node:path');
const { shopifyQuery, postToChangelog, BUSINESS_NAME } = require('./lib');

const CHECK_INTERVAL_MS = 3 * 60_000;
const ORDERS_QUERY_FILE = path.join(__dirname, 'queries', 'recent-orders.graphql');
const STATE_PATH = path.join(__dirname, 'order-watch-state.json');
const AREA = 'orders';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(patch) {
  const state = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

function formatOrderLine(order) {
  const total = order.currentTotalPriceSet.shopMoney;
  const customer = order.customer?.displayName || 'Guest';
  const items = order.lineItems.edges.map((e) => `${e.node.quantity}x ${e.node.title}`).join(', ') || '(no line items)';
  return `🛒 **${order.name}** — ${customer} — ${total.amount} ${total.currencyCode}\n  ${items}\n  _${order.displayFinancialStatus} · ${order.displayFulfillmentStatus}_`;
}

async function checkOnce() {
  let data;
  try {
    data = await shopifyQuery(ORDERS_QUERY_FILE);
  } catch (err) {
    console.error('[order-watch] check failed:', err.message);
    return;
  }

  const orders = [...data.orders.edges].reverse().map((e) => e.node); // oldest-first
  const state = loadState();
  const hadPrev = 'lastOrderId' in state;

  if (!orders.length) {
    // Store genuinely has zero orders (e.g. pre-launch). Establish an empty baseline so the
    // very first real order, whenever it happens, is treated as new rather than swallowed as
    // "history" the next time this runs.
    if (!hadPrev) saveState({ lastOrderId: null });
    return;
  }

  const lastSeenId = state.lastOrderId;
  saveState({ lastOrderId: orders[orders.length - 1].id });
  if (!hadPrev) return; // first run ever, WITH pre-existing orders — don't dump order history

  let newOrders;
  let missedSome = false;
  if (!lastSeenId) {
    newOrders = orders; // baseline was "zero orders" — every order present now is genuinely new
  } else {
    const idx = orders.findIndex((o) => o.id === lastSeenId);
    missedSome = idx === -1; // more than 20 orders happened since the last check
    newOrders = missedSome ? orders : orders.slice(idx + 1);
  }
  if (!newOrders.length) return;

  const lines = newOrders.map(formatOrderLine);
  if (missedSome) lines.unshift('_(more orders happened than could be retained — showing the most recent)_');

  await postToChangelog(AREA, `**New ${BUSINESS_NAME} order(s):**\n${lines.join('\n')}`);
}

function start() {
  checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, formatOrderLine };
