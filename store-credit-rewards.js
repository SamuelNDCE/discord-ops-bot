const fs = require('node:fs');
const path = require('node:path');
const { shopifyQuery, shopifyMutate, postToChangelog } = require('./lib');

const CHECK_INTERVAL_MS = 3 * 60_000;
const ORDERS_QUERY_FILE = path.join(__dirname, 'queries', 'recent-paid-orders-for-rewards.graphql');
const CREDIT_MUTATION_FILE = path.join(__dirname, 'queries', 'store-credit-account-credit.graphql');
const STATE_PATH = path.join(__dirname, 'store-credit-rewards-state.json');
const AREA = 'orders';

// 10% of the order subtotal (post line-item-discount, pre shipping/tax) as store credit.
// Guest checkouts (no customer account) are skipped — there is no account to credit.
const REWARD_RATE = 0.10;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { rewardedOrderIds: [] };
  }
}

function saveState(patch) {
  const state = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

async function rewardOrder(order) {
  const amount = roundMoney(parseFloat(order.currentSubtotalPriceSet.shopMoney.amount) * REWARD_RATE);
  const currencyCode = order.currentSubtotalPriceSet.shopMoney.currencyCode;
  if (amount <= 0) return { skipped: 'zero-amount' };

  const result = await shopifyMutate(CREDIT_MUTATION_FILE, {
    customerId: order.customer.id,
    amount: amount.toFixed(2),
    currencyCode,
  });

  const payload = result.data ? result.data.storeCreditAccountCredit : result.storeCreditAccountCredit;
  if (payload.userErrors && payload.userErrors.length) {
    return { error: payload.userErrors.map((e) => e.message).join('; ') };
  }
  return {
    amount,
    currencyCode,
    newBalance: payload.storeCreditAccountTransaction.account.balance.amount,
  };
}

async function checkOnce() {
  let data;
  try {
    data = await shopifyQuery(ORDERS_QUERY_FILE);
  } catch (err) {
    console.error('[store-credit-rewards] check failed:', err.message);
    return;
  }

  const orders = (data.data ? data.data.orders : data.orders).edges.map((e) => e.node);
  const state = loadState();
  const rewarded = new Set(state.rewardedOrderIds || []);

  const toReward = orders.filter((o) => o.customer && !rewarded.has(o.id));
  if (!toReward.length) return;

  const lines = [];
  for (const order of toReward) {
    const outcome = await rewardOrder(order);
    rewarded.add(order.id); // mark processed even on error/skip — a failing order retries only via manual replay, not silently forever
    if (outcome.error) {
      lines.push(`⚠️ **${order.name}** — store credit reward failed: ${outcome.error}`);
    } else if (outcome.skipped) {
      // zero-amount order, nothing to report
    } else {
      lines.push(`💳 **${order.name}** — ${order.customer.displayName} earned ${outcome.amount} ${outcome.currencyCode} store credit (new balance: ${outcome.newBalance})`);
    }
  }

  saveState({ rewardedOrderIds: [...rewarded].slice(-500) }); // keep last 500, older orders age out of the 20-order window anyway

  if (lines.length) {
    await postToChangelog(AREA, lines.join('\n'));
  }
}

function start() {
  checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, rewardOrder, REWARD_RATE };
