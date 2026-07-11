const fs = require('node:fs');
const path = require('node:path');
const { postToChangelog, shopifyQuery } = require('./lib');

// Auto-posts newly published products to your Facebook Page. Uses the same FB_ACCESS_TOKEN as
// meta-ads-watch.js/ad-creative-lib.js — a System User token with a CREATE_CONTENT task on the
// Page (see /me/accounts to verify) so no separate Meta app permissions/token are needed.
const GRAPH_API = 'https://graph.facebook.com/v21.0';
const PAGE_ID = process.env.FB_PAGE_ID; // your Facebook Page ID
const IG_USER_ID = process.env.IG_USER_ID; // your Instagram Business account, linked to the Page above
const AREA = 'facebook-posts';
const STATE_PATH = path.join(__dirname, 'fb-auto-post-state.json');
const STORE_DOMAIN = process.env.STORE_DOMAIN || 'business1.example.com';
const CHECK_INTERVAL_MS = 30 * 60_000; // product publishes are infrequent; 30 min is plenty responsive
const MAX_POSTS_PER_CHECK = 3; // if several products go live at once, don't flood the Page in one burst

// Defaults to true so a fresh install never posts publicly until someone deliberately sets
// FB_AUTO_POST_LIVE=true in discord-bot/.env after reviewing dry-run output in Discord.
const DRY_RUN = process.env.FB_AUTO_POST_LIVE !== 'true';

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { seenProductIds: [], initialized: false };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

function numericId(gid) {
  return gid.split('/').pop();
}

async function fetchRecentActiveProducts(limit = 20) {
  const query = `{
    products(first: ${limit}, sortKey: CREATED_AT, reverse: true, query: "status:active") {
      nodes {
        id
        title
        handle
        descriptionHtml
        featuredImage { url }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
    }
  }`;
  const file = path.join(__dirname, `_tmp-fb-post-products-${Date.now()}.graphql`);
  fs.writeFileSync(file, query);
  try {
    const data = await shopifyQuery(file);
    return data.products.nodes;
  } finally {
    fs.unlinkSync(file);
  }
}

// Page access tokens for a System User's managed pages inherit that token's lifetime (never
// expires here — confirmed via debug_token, data_access_expires_at/expires_at both 0) so fetching
// fresh each check is simple and avoids caching a token that could theoretically be rotated.
async function getPageAccessToken() {
  const { FB_ACCESS_TOKEN } = process.env;
  if (!FB_ACCESS_TOKEN) throw new Error('Set FB_ACCESS_TOKEN in discord-bot/.env first');
  const res = await fetch(`${GRAPH_API}/me/accounts?access_token=${FB_ACCESS_TOKEN}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  const page = (body.data || []).find((p) => p.id === PAGE_ID);
  if (!page) throw new Error(`Token does not manage Page ${PAGE_ID} — check FB_ACCESS_TOKEN's page access`);
  return page.access_token;
}

// Strips HTML and grabs roughly the first sentence — the caption is a teaser, not the full
// product description (which can run to several paragraphs of bullet-pointed specs).
function shortDescription(html, maxLen = 200) {
  const text = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).replace(/\s+\S*$/, '')}…`;
}

function buildPostText(product) {
  const price = Number(product.priceRangeV2.minVariantPrice.amount);
  const currency = product.priceRangeV2.minVariantPrice.currencyCode;
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : `${currency} `;
  const desc = shortDescription(product.descriptionHtml);
  const url = `https://${STORE_DOMAIN}/products/${product.handle}`;
  return [`✨ New in: ${product.title}`, `${symbol}${price.toFixed(2)}`, desc, '', `Shop now: ${url}`]
    .filter(Boolean)
    .join('\n');
}

async function postProductPhoto(product, pageToken) {
  const message = buildPostText(product);
  const imageUrl = product.featuredImage?.url;

  const endpoint = imageUrl ? `${PAGE_ID}/photos` : `${PAGE_ID}/feed`;
  const form = new URLSearchParams({ access_token: pageToken });
  if (imageUrl) {
    form.set('url', imageUrl);
    form.set('caption', message);
  } else {
    form.set('message', message);
  }

  const res = await fetch(`${GRAPH_API}/${endpoint}`, { method: 'POST', body: form });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body; // { id: "<post_id>" } or { id, post_id } for photos
}

// Instagram requires an image (no text-only feed equivalent) and a two-step container ->
// publish flow. Uses the same Page access token — the linked IG Business account inherits
// the System User's permissions, no separate IG token needed.
async function postToInstagram(imageUrl, caption, pageToken) {
  if (!imageUrl) throw new Error('Instagram requires an image; no featuredImage on this product');
  const createForm = new URLSearchParams({ access_token: pageToken, image_url: imageUrl, caption });
  const createRes = await fetch(`${GRAPH_API}/${IG_USER_ID}/media`, { method: 'POST', body: createForm });
  const createBody = await createRes.json();
  if (createBody.error) throw new Error(`IG container: ${createBody.error.message}`);

  const publishForm = new URLSearchParams({ access_token: pageToken, creation_id: createBody.id });
  const publishRes = await fetch(`${GRAPH_API}/${IG_USER_ID}/media_publish`, { method: 'POST', body: publishForm });
  const publishBody = await publishRes.json();
  if (publishBody.error) throw new Error(`IG publish: ${publishBody.error.message}`);
  return publishBody; // { id: "<ig_media_id>" }
}

async function checkOnce() {
  const state = readState();
  const seen = new Set(state.seenProductIds || []);

  let products;
  try {
    products = await fetchRecentActiveProducts();
  } catch (err) {
    console.error('[fb-auto-post] failed to fetch products:', err.message);
    return;
  }

  // First run ever: seed with everything currently active so we only post products published
  // AFTER this feature went live, not the entire existing catalog in one burst.
  if (!state.initialized) {
    writeState({ seenProductIds: products.map((p) => numericId(p.id)), initialized: true });
    await postToChangelog(
      AREA,
      `🟢 fb-auto-post initialized — backfilled ${products.length} existing active product(s) as "already seen." ` +
        `Only products published from now on will be posted. Currently in **${DRY_RUN ? 'DRY RUN' : 'LIVE'}** mode ` +
        `(set FB_AUTO_POST_LIVE=true in .env to go live).`
    );
    return;
  }

  const newProducts = products.filter((p) => !seen.has(numericId(p.id))).slice(0, MAX_POSTS_PER_CHECK);
  if (!newProducts.length) return;

  for (const product of newProducts) {
    seen.add(numericId(product.id)); // mark seen before attempting, so a failure doesn't retry-storm forever
    writeState({ seenProductIds: [...seen], initialized: true });

    const previewText = buildPostText(product);
    if (DRY_RUN) {
      await postToChangelog(
        AREA,
        `🧪 **[DRY RUN]** Would post to Facebook:\n\n${previewText}\n\n` +
          `_Image: ${product.featuredImage?.url || '(none)'}_`
      );
      continue;
    }

    let pageToken;
    try {
      pageToken = await getPageAccessToken();
      const result = await postProductPhoto(product, pageToken);
      await postToChangelog(
        AREA,
        `✅ Posted **${product.title}** to Facebook (post id ${result.post_id || result.id}).`
      );
    } catch (err) {
      await postToChangelog(AREA, `❌ Failed to post **${product.title}** to Facebook: ${err.message}`);
      console.error('[fb-auto-post] post failed:', err.message);
    }

    // Instagram cross-post is best-effort and independent of the Facebook result above — a
    // failure here (e.g. product has no image) shouldn't be reported as a Facebook failure.
    try {
      if (!pageToken) pageToken = await getPageAccessToken();
      const igResult = await postToInstagram(product.featuredImage?.url, buildPostText(product), pageToken);
      await postToChangelog(AREA, `✅ Posted **${product.title}** to Instagram (media id ${igResult.id}).`);
    } catch (err) {
      await postToChangelog(AREA, `❌ Failed to post **${product.title}** to Instagram: ${err.message}`);
      console.error('[fb-auto-post] IG post failed:', err.message);
    }
  }
}

function start() {
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = {
  start,
  checkOnce,
  buildPostText,
  getPageAccessToken,
  postToInstagram,
  PAGE_ID,
  IG_USER_ID,
  GRAPH_API,
  DRY_RUN,
};
