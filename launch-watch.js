const fs = require('node:fs');
const path = require('node:path');
const { shopifyQuery, postToChangelog, formatShopifyEventLine, matchBigTicketEvent, draftChangelogArticle, BUSINESS_NAME } = require('./lib');

const CHECK_INTERVAL_MS = 3 * 60_000;
const STATUS_QUERY_FILE = path.join(__dirname, 'queries', 'launch-status.graphql');
const EVENTS_QUERY_FILE = path.join(__dirname, 'queries', 'recent-events.graphql');
const LIVE_THEME_QUERY_FILE = path.join(__dirname, 'queries', 'live-theme.graphql');
const STATE_PATH = path.join(__dirname, 'launch-watch-state.json');
const MAX_EVENT_LINES = 20;
const AREA = 'shopify'; // each change belongs in exactly one changelog channel, not duplicated
const WHATS_NEW_BLOG_ID = process.env.WHATS_NEW_BLOG_ID; // set in .env after create-whats-new-blog.js runs

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

// Password/domain/active-count: the launch-critical signals, checked directly (belt-and-suspenders —
// these should also show up in checkEvents, but this guarantees they're never missed).
async function checkStatusFields() {
  let data;
  try {
    data = await shopifyQuery(STATUS_QUERY_FILE);
  } catch (err) {
    console.error('[launch-watch] status check failed:', err.message);
    return;
  }

  const current = {
    passwordWalled: data.onlineStore.passwordProtection.enabled,
    domain: data.shop.primaryDomain.host,
    activeProducts: data.activeProductsCount.count,
  };

  const prev = loadState();
  const hadPrev = 'passwordWalled' in prev;
  saveState(current);
  if (!hadPrev) return; // first run ever — establish baseline only

  const changes = [];
  if (prev.passwordWalled !== current.passwordWalled) {
    changes.push(
      current.passwordWalled
        ? '🔒 Storefront password turned ON'
        : '🎉 Storefront password REMOVED — store may be publicly visible now!'
    );
  }
  if (prev.domain !== current.domain) changes.push(`🌐 Domain changed: ${prev.domain} → ${current.domain}`);
  if (prev.activeProducts !== current.activeProducts) {
    changes.push(`📦 Active products: ${prev.activeProducts} → ${current.activeProducts}`);
  }

  if (changes.length) await postToChangelog(AREA, `**${BUSINESS_NAME} status changed:**\n${changes.join('\n')}`);
}

// General activity feed: catches everything (product edits, publishes, collection/discount/page changes,
// etc.) via Shopify's own audit log, WITH attribution — attributeToUser + author tells us if a real
// staff member (e.g. you or a colleague, if invited as Shopify staff) made the change in the Admin UI,
// vs. an app/API/CLI action.
async function checkEvents() {
  let data;
  try {
    data = await shopifyQuery(EVENTS_QUERY_FILE);
  } catch (err) {
    console.error('[launch-watch] events check failed:', err.message);
    return;
  }

  const events = [...data.events.edges].reverse().map((e) => e.node); // oldest-first
  if (!events.length) return;

  const state = loadState();
  const lastSeenId = state.lastEventId;
  saveState({ lastEventId: events[events.length - 1].id });
  if (!lastSeenId) return; // first run ever — establish baseline only, don't dump history

  const idx = events.findIndex((e) => e.id === lastSeenId);
  const missedSome = idx === -1; // more than 50 events happened since the last check — some weren't retained
  const newEvents = missedSome ? events : events.slice(idx + 1);
  if (!newEvents.length) return;

  const lines = newEvents.slice(0, MAX_EVENT_LINES).map(formatShopifyEventLine);
  if (newEvents.length > MAX_EVENT_LINES) lines.push(`…and ${newEvents.length - MAX_EVENT_LINES} more`);
  if (missedSome) lines.unshift('_(more activity happened than could be retained — showing the most recent)_');

  await postToChangelog(AREA, `**${BUSINESS_NAME} activity:**\n${lines.join('\n')}`);

  if (WHATS_NEW_BLOG_ID) {
    for (const event of newEvents) {
      const match = matchBigTicketEvent(event.message);
      if (!match) continue;
      try {
        await draftChangelogArticle({ blogId: WHATS_NEW_BLOG_ID, ...match });
      } catch (err) {
        console.error('[launch-watch] draft article failed:', err.message);
      }
    }
  }
}

// Shopify's Events API has NO subject type for theme/storefront-design edits (confirmed against
// their own EventSubjectType schema — only ARTICLE, COLLECTION, PRODUCT, PAGE, ORDER, etc. exist).
// So a live-theme customizer edit (colors, sections, layout) never shows up in checkEvents, no
// matter what. This is the only signal Shopify exposes for that: the published theme's own
// updatedAt timestamp. It proves THAT the site's design changed and WHEN, but not WHO or WHAT
// specifically — Shopify doesn't expose that via API for theme edits.
async function checkThemeUpdate() {
  let data;
  try {
    data = await shopifyQuery(LIVE_THEME_QUERY_FILE);
  } catch (err) {
    console.error('[launch-watch] theme check failed:', err.message);
    return;
  }

  const theme = data.themes.edges[0]?.node;
  if (!theme) return;

  const state = loadState();
  const hadPrev = 'themeUpdatedAt' in state;
  saveState({ themeUpdatedAt: theme.updatedAt, themeName: theme.name });
  if (!hadPrev) return; // first run ever — establish baseline only

  if (theme.updatedAt !== state.themeUpdatedAt) {
    await postToChangelog(
      AREA,
      `🎨 **Live theme was edited**: "${theme.name}" changed at ${theme.updatedAt} (Shopify doesn't expose who or what specifically via API — check Online Store → Themes → Edit code → version history for details)`
    );
  }
}

async function checkOnce() {
  await checkStatusFields();
  await checkEvents();
  await checkThemeUpdate();
}

function start() {
  checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, checkEvents };
