const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { postToChangelog, shopifyQuery } = require('./lib');

// Daily proactive quality audit for your Shopify store - distinct from launch-watch/order-watch,
// which only catch CHANGES (new orders, status flips, activity log entries). This catches
// drift/bugs that exist quietly with nothing "changing" to trigger a watcher: silently-thin
// margins, products that fell out of sync with the Facebook & Instagram catalog, and description
// text that promises a variant/size choice that no longer exists on the product. Deliberately
// scoped to pure Shopify Admin API reads only - a supplier freight-recalculation sweep belongs in
// an occasional/on-demand deep audit, not a daily job, since suppliers are often rate-limited.

const TARGET_HOUR_UK = 9;
const TARGET_MINUTE_UK = 30;
const AREA = 'shopify';
const STATE_PATH = path.join(__dirname, 'store-audit-state.json');
// Facebook & Instagram sales channel publication - verified live 2026-07-06 (same session that
// found and fixed the 122/203 products missing from this channel).
const FB_PUBLICATION_ID = 'gid://shopify/Publication/355469132114';
const MARGIN_RATIO_FLOOR = 2;
const MARGIN_ABS_FLOOR = 8; // matches the store's own policy: under-2x is fine for expensive items
// with healthy absolute profit, only a real problem when BOTH the ratio and the absolute profit are thin.

function ukNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

function lastPostedDate() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).lastPosted; } catch { return null; }
}
function markPosted(date) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ lastPosted: date }));
}

async function fetchAllActiveProducts() {
  let all = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const after = cursor ? `, after: "${cursor}"` : '';
    const query = `{ products(first: 100${after}, query: "status:active") { pageInfo { hasNextPage endCursor } nodes {
      id title descriptionHtml
      onFB: publishedOnPublication(publicationId: "${FB_PUBLICATION_ID}")
      variants(first: 10) { nodes { price inventoryItem { unitCost { amount } } } }
    } } }`;
    const qf = path.join(os.tmpdir(), `store-audit-q-${Date.now()}-${page}.graphql`);
    fs.writeFileSync(qf, query);
    let data;
    try {
      data = await shopifyQuery(qf);
    } finally {
      try { fs.unlinkSync(qf); } catch {}
    }
    const conn = data.products;
    all = all.concat(conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return all;
}

function checkMargins(products) {
  const flagged = [];
  for (const p of products) {
    const v = p.variants.nodes[0];
    const cost = Number(v?.inventoryItem?.unitCost?.amount || 0);
    const price = Number(v?.price || 0);
    if (!cost) continue; // no cost recorded at all - that's checkMissingCost's job, not a margin call
    const ratio = price / cost;
    const profit = price - cost;
    if (ratio < MARGIN_RATIO_FLOOR && profit < MARGIN_ABS_FLOOR) flagged.push({ title: p.title, price, cost, ratio, profit });
  }
  return flagged;
}

function checkCatalogGap(products) {
  return products.filter((p) => !p.onFB).map((p) => p.title);
}

function checkMissingCost(products) {
  return products.filter((p) => !p.variants.nodes.some((v) => Number(v.inventoryItem?.unitCost?.amount || 0) > 0));
}

// Heuristic for a common product-listing bug: description promises a size/pack choice but only
// one real variant exists. Deliberately narrow pattern to keep false positives low - flags for a
// human to glance at, not an auto-fix.
const SIZE_HINT_RE = /choose[^.]{0,40}(?:size|pack)|\d+\s*(?:\/\s*\d+){1,}\s*(?:-?\s*)?(?:capsule|tablet|serving)/i;
function checkVariantMismatch(products) {
  return products.filter((p) => p.variants.nodes.length <= 1 && SIZE_HINT_RE.test(p.descriptionHtml || '')).map((p) => p.title);
}

async function buildAuditReport() {
  const products = await fetchAllActiveProducts();
  const marginIssues = checkMargins(products);
  const catalogGaps = checkCatalogGap(products);
  const missingCost = checkMissingCost(products);
  const variantMismatches = checkVariantMismatch(products);

  const lines = [`**🩺 Daily store audit — ${products.length} active products checked**`];

  lines.push(
    marginIssues.length
      ? `⚠️ **${marginIssues.length} product(s) below margin floor** (<${MARGIN_RATIO_FLOOR}x AND <£${MARGIN_ABS_FLOOR} profit):\n` +
          marginIssues
            .slice(0, 10)
            .map((m) => `  - ${m.title}: cost £${m.cost.toFixed(2)} → price £${m.price.toFixed(2)} (${m.ratio.toFixed(2)}x, £${m.profit.toFixed(2)} profit)`)
            .join('\n') +
          (marginIssues.length > 10 ? `\n  …and ${marginIssues.length - 10} more` : '')
      : '✅ No margin-floor violations'
  );

  lines.push(
    catalogGaps.length
      ? `⚠️ **${catalogGaps.length} product(s) missing from the Facebook & Instagram catalog:**\n` +
          catalogGaps.slice(0, 10).map((t) => `  - ${t}`).join('\n') +
          (catalogGaps.length > 10 ? `\n  …and ${catalogGaps.length - 10} more` : '')
      : '✅ Facebook & Instagram catalog fully synced'
  );

  lines.push(`ℹ️ ${missingCost.length} product(s) still have no cost data recorded (can't check their margin) — not new, tracked since the 2026-07-06 audit`);

  lines.push(
    variantMismatches.length
      ? `⚠️ **${variantMismatches.length} product(s) may be missing size/variant options** (description offers a size/pack choice, only 1 real variant exists):\n` +
          variantMismatches.map((t) => `  - ${t}`).join('\n')
      : '✅ No description/variant mismatches detected'
  );

  return lines.join('\n\n');
}

function start() {
  setInterval(async () => {
    const { date, hour, minute } = ukNow();
    const pastTarget = hour > TARGET_HOUR_UK || (hour === TARGET_HOUR_UK && minute >= TARGET_MINUTE_UK);
    if (!pastTarget) return;
    if (lastPostedDate() === date) return;
    markPosted(date); // mark before building, so a slow build can't cause a double-post

    try {
      const report = await buildAuditReport();
      await postToChangelog(AREA, report);
    } catch (err) {
      console.error('[store-audit-watch] failed:', err.message);
    }
  }, 60_000);
}

module.exports = { start, buildAuditReport };
