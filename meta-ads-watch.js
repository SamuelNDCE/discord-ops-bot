const fs = require('node:fs');
const path = require('node:path');
const { postToChangelog, shopifyQuery } = require('./lib');

const STATE_PATH = path.join(__dirname, 'meta-ads-watch-state.json');
const AREA = 'meta-ads';
const GRAPH_API = 'https://graph.facebook.com/v21.0';

// Alerts fire once per calendar day per condition (tracked in state), not every hour.
const ALERT_RULES = {
  zeroSpendByHourUk: 14, // spend still £0 by this UK hour -> delivery is stuck
  minImpressionsForCtrAlert: 500, // don't judge CTR on a tiny sample
  lowCtrPercent: 0.5,
  clickNoConvertThreshold: 15, // this many clicks with 0 purchases -> checkout/funnel problem, not creative
};

// Auto-pause only fires once per ad (tracked in state) and only ever pauses — never deletes,
// never touches budget. Deliberately conservative thresholds so a noisy first few hours can't
// trigger it; ponytail: no auto-resume, re-activate manually in Ads Manager if this was wrong.
const PAUSE_RULES = {
  minSpendGbp: 15,
  minImpressions: 800,
  lowCtrPercent: 0.4,
};

// UK midnight isn't UTC midnight (BST = UTC+1 roughly Mar-Oct) — offset varies by date, so
// resolve it per-instant rather than assuming a fixed shift.
function ukOffsetMinutesAt(utcInstant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/London', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcInstant).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === '24' ? 0 : parts.hour, parts.minute, parts.second);
  return Math.round((asIfUtc - utcInstant.getTime()) / 60_000);
}

// Returns the UTC instants for the start/end of the given UK calendar date (YYYY-MM-DD),
// so a Shopify created_at filter lines up with the actual UK day, not a UTC-shifted one.
function ukDayBoundsUtc(dateStr) {
  const naiveStart = new Date(`${dateStr}T00:00:00Z`);
  const startUtc = new Date(naiveStart.getTime() - ukOffsetMinutesAt(naiveStart) * 60_000);
  const naiveEnd = new Date(`${dateStr}T23:59:59Z`);
  const endUtc = new Date(naiveEnd.getTime() - ukOffsetMinutesAt(naiveEnd) * 60_000);
  return { startUtc, endUtc };
}

function ukYesterday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).formatToParts(
    new Date(Date.now() - 24 * 3_600_000)
  );
  const get = (type) => parts.find((p) => p.type === type).value; // en-CA gives YYYY-MM-DD parts
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ukNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), ...patch }));
}

async function fetchAdsInsights(datePreset) {
  const { FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID } = process.env;
  if (!FB_ACCESS_TOKEN || !FB_AD_ACCOUNT_ID) {
    throw new Error('Set FB_ACCESS_TOKEN and FB_AD_ACCOUNT_ID in discord-bot/.env first');
  }
  const fields = 'spend,impressions,reach,clicks,ctr,cpc,actions';
  const url = `${GRAPH_API}/${FB_AD_ACCOUNT_ID}/insights?fields=${fields}&date_preset=${datePreset}&access_token=${FB_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.data[0] || null; // no data = no ad activity in the window, not an error
}

// Per-ad breakdown (level=ad) — needed so alerts/auto-pause act on the specific underperforming
// ad rather than the account aggregate, which stays correct once more than one ad exists.
async function fetchPerAdInsights(datePreset) {
  const { FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID } = process.env;
  const fields = 'ad_id,ad_name,spend,impressions,clicks,ctr,actions';
  const url = `${GRAPH_API}/${FB_AD_ACCOUNT_ID}/insights?fields=${fields}&level=ad&date_preset=${datePreset}&access_token=${FB_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.data || [];
}

// Breakdown fetch for the on-demand /adsnowadvanced command — separate calls (one per dimension)
// because Meta only returns a breakdown when `breakdowns` is set, and combining age/gender with
// device/platform in one call would cross-multiply rows (7 ages x 3 genders x 3 devices x 4
// platforms) into hundreds of near-empty rows instead of three short, readable tables.
async function fetchBreakdownInsights(datePreset, breakdowns) {
  const { FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID } = process.env;
  if (!FB_ACCESS_TOKEN || !FB_AD_ACCOUNT_ID) {
    throw new Error('Set FB_ACCESS_TOKEN and FB_AD_ACCOUNT_ID in discord-bot/.env first');
  }
  const fields = 'spend,impressions,clicks,ctr,cpc,cpm,actions';
  const url = `${GRAPH_API}/${FB_AD_ACCOUNT_ID}/insights?fields=${fields}&breakdowns=${breakdowns}&date_preset=${datePreset}&access_token=${FB_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.data || [];
}

// Discord hard-caps messages at 2000 chars. Tables are compact enough that this rarely bites,
// but a busy account with many active age/gender combinations could still overflow it — so trim
// the largest table (age/gender) row-by-row from the low-spend end rather than truncating raw text.
const DISCORD_MESSAGE_LIMIT = 2000;

const GENDER_SHORT = { female: 'F', male: 'M', unknown: 'U' };
const DEVICE_SHORT = { mobile_app: 'App', desktop: 'Desktop', mobile_web: 'MobWeb' };
const PUBLISHER_SHORT = { facebook: 'FB', instagram: 'IG', audience_network: 'AN', messenger: 'MSG' };
const shortLabel = (map, value) => map[value] || value || '?';

const TABLE_COLUMNS = [
  { key: 'label', header: 'Seg', width: 9, align: 'left' },
  { key: 'spend', header: 'Spend', width: 6, align: 'right' },
  { key: 'impr', header: 'Impr', width: 6, align: 'right' },
  { key: 'ctr', header: 'CTR%', width: 5, align: 'right' },
  { key: 'cpc', header: 'CPC', width: 5, align: 'right' },
  { key: 'cpm', header: 'CPM', width: 6, align: 'right' },
  { key: 'clk', header: 'Clk', width: 4, align: 'right' },
  { key: 'cnv', header: 'Cnv', width: 4, align: 'right' },
  { key: 'cr', header: 'CR%', width: 5, align: 'right' },
  { key: 'cpa', header: 'CPA', width: 6, align: 'right' },
];

const pad = (value, width, align) => (align === 'left' ? String(value).padEnd(width) : String(value).padStart(width));

function sortBySpendDesc(rows) {
  return [...rows].sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
}

function rowMetrics(row, labelFn) {
  const spend = Number(row.spend || 0);
  const clicks = Number(row.clicks || 0);
  const conversions = purchaseCount(row.actions);
  const cr = clicks > 0 && conversions !== null ? ((conversions / clicks) * 100).toFixed(1) : '-';
  const cpa = conversions ? (spend / conversions).toFixed(2) : '-';
  return {
    label: labelFn(row),
    spend: spend.toFixed(2),
    impr: Number(row.impressions || 0).toLocaleString(),
    ctr: Number(row.ctr || 0).toFixed(1),
    cpc: Number(row.cpc || 0).toFixed(2),
    cpm: Number(row.cpm || 0).toFixed(2),
    clk: clicks,
    cnv: conversions === null ? '-' : conversions,
    cr,
    cpa,
  };
}

// rows must already be sorted/trimmed by the caller — this only renders, so age/gender trimming
// (the one table that can grow large) stays in the caller where the overall length budget lives.
function formatBreakdownTable(title, rows, labelFn, omitted = 0) {
  if (!rows.length) return [`**${title}**`, '_no data_'];
  const lines = rows
    .map((row) => rowMetrics(row, labelFn))
    .map((r) => TABLE_COLUMNS.map((c) => pad(r[c.key], c.width, c.align)).join(' '));
  const headerRow = TABLE_COLUMNS.map((c) => pad(c.header, c.width, c.align)).join(' ');
  const footer = omitted > 0 ? [`_+${omitted} more low-spend row${omitted === 1 ? '' : 's'} omitted_`] : [];
  return [`**${title}**`, '```', headerRow, ...lines, '```', ...footer];
}

async function pauseAd(adId) {
  const { FB_ACCESS_TOKEN } = process.env;
  const res = await fetch(`${GRAPH_API}/${adId}?access_token=${FB_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'status=PAUSED',
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
}

// Meta reports conversions as a bag of {action_type, value} pairs. "omni_purchase" is Meta's own
// de-duped cross-device purchase count; fall back to summing anything purchase-like if it's absent
// rather than assuming zero (a missing field means "unknown", not "no conversions").
function purchaseCount(actions) {
  if (!actions) return null;
  const omni = actions.find((a) => a.action_type === 'omni_purchase');
  if (omni) return Number(omni.value);
  const purchaseLike = actions.filter((a) => a.action_type.includes('purchase'));
  if (!purchaseLike.length) return 0;
  return purchaseLike.reduce((sum, a) => sum + Number(a.value), 0);
}

// Meta's own rollup of likes/comments/shares/saves/photo-views on the ad's post — one number
// rather than summing the individual reaction action_types ourselves.
function postEngagementCount(actions) {
  if (!actions) return null;
  const engagement = actions.find((a) => a.action_type === 'post_engagement');
  return engagement ? Number(engagement.value) : 0;
}

async function fetchShopifyRevenueRange(startDateStr, endDateStr) {
  const { startUtc } = ukDayBoundsUtc(startDateStr);
  const { endUtc } = ukDayBoundsUtc(endDateStr);
  const query = `{
    orders(first: 250, query: "created_at:>='${startUtc.toISOString()}' AND created_at:<='${endUtc.toISOString()}' AND financial_status:paid") {
      edges { node { totalPriceSet { shopMoney { amount currencyCode } } } }
    }
  }`;
  const file = path.join(__dirname, `_tmp-ads-revenue-${Date.now()}.graphql`);
  fs.writeFileSync(file, query);
  try {
    const data = await shopifyQuery(file);
    const orders = data.orders.edges.map((e) => e.node);
    const revenue = orders.reduce((sum, o) => sum + Number(o.totalPriceSet.shopMoney.amount), 0);
    const currency = orders[0]?.totalPriceSet.shopMoney.currencyCode ?? 'GBP';
    return { revenue, currency, orderCount: orders.length };
  } finally {
    fs.unlinkSync(file);
  }
}

async function fetchShopifyRevenue(dateStr) {
  return fetchShopifyRevenueRange(dateStr, dateStr);
}

function formatSummary({ heading, insights, revenue, currency, orderCount, revenuePeriod = 'same day' }) {
  if (!insights) {
    return `**${heading}**\nNo ad activity recorded.`;
  }

  const spend = Number(insights.spend || 0);
  const conversions = purchaseCount(insights.actions);
  const postEngagement = postEngagementCount(insights.actions);
  const roas = spend > 0 ? (revenue / spend).toFixed(2) : 'n/a';
  const roi = spend > 0 ? (((revenue - spend) / spend) * 100).toFixed(1) : 'n/a';

  return [
    `**${heading}**`,
    `Spend: ${spend.toFixed(2)} ${currency}`,
    `Impressions: ${Number(insights.impressions || 0).toLocaleString()}`,
    `Reach: ${Number(insights.reach || 0).toLocaleString()}`,
    `Clicks: ${Number(insights.clicks || 0).toLocaleString()} (CTR ${Number(insights.ctr || 0).toFixed(2)}%, CPC ${Number(insights.cpc || 0).toFixed(2)} ${currency})`,
    `Post engagement: ${postEngagement === null ? 'not available' : postEngagement.toLocaleString()}`,
    `Conversions (Meta-attributed): ${conversions === null ? 'not available' : conversions}`,
    `Shopify revenue (${revenuePeriod}, ${orderCount} paid order${orderCount === 1 ? '' : 's'}): ${revenue.toFixed(2)} ${currency}`,
    `ROAS: ${roas}`,
    `ROI: ${roi === 'n/a' ? 'n/a' : `${roi}%`}`,
  ].join('\n');
}

// Full prior day, used by the on-demand /adstats command — stable, fully-settled numbers.
async function buildAdsSummary() {
  const dateStr = ukYesterday();
  const insights = await fetchAdsInsights('yesterday');
  const { revenue, currency, orderCount } = await fetchShopifyRevenue(dateStr);
  return formatSummary({ heading: `Meta Ads — ${dateStr}`, insights, revenue, currency, orderCount });
}

// Last 7 full days (matches Meta's own date_preset=last_7d: 7 complete days, not including
// today), used by the on-demand /adsweek command.
async function buildWeekSummary() {
  const endDateStr = ukYesterday();
  const start = new Date(`${endDateStr}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const startDateStr = start.toISOString().slice(0, 10);
  const insights = await fetchAdsInsights('last_7d');
  const { revenue, currency, orderCount } = await fetchShopifyRevenueRange(startDateStr, endDateStr);
  return formatSummary({
    heading: `Meta Ads — ${startDateStr} to ${endDateStr} (last 7 days)`,
    insights, revenue, currency, orderCount,
    revenuePeriod: 'same 7 days',
  });
}

// Cumulative today-so-far, used by the hourly watcher — numbers rise through the day, not final.
async function buildTodaySummary() {
  const { date, hour, minute } = ukNow();
  const insights = await fetchAdsInsights('today');
  const { revenue, currency, orderCount } = await fetchShopifyRevenue(date);
  const stamp = `${date} — as of ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UK, today so far`;
  return formatSummary({ heading: `Meta Ads — ${stamp}`, insights, revenue, currency, orderCount });
}

// Today-so-far broken down three ways, used by the on-demand /adsnowadvanced command: age/gender
// (audience), device (mobile app/desktop/mobile web), and publisher platform (FB/IG/AN/Messenger)
// — the three dimensions that most directly suggest a targeting or placement change.
async function buildTodayAdvancedSummary() {
  const { date, hour, minute } = ukNow();
  const [ageGenderRows, deviceRows, publisherRows] = await Promise.all([
    fetchBreakdownInsights('today', 'age,gender'),
    fetchBreakdownInsights('today', 'device_platform'),
    fetchBreakdownInsights('today', 'publisher_platform'),
  ]);
  const stamp = `${date} — as of ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UK, today so far`;
  const header = `**Meta Ads — ${stamp}**`;

  const ageGenderSorted = sortBySpendDesc(ageGenderRows);
  const deviceLabel = (r) => shortLabel(DEVICE_SHORT, r.device_platform);
  const publisherLabel = (r) => shortLabel(PUBLISHER_SHORT, r.publisher_platform);

  for (let keep = ageGenderSorted.length; keep >= 0; keep--) {
    const omitted = ageGenderSorted.length - keep;
    const sections = [
      formatBreakdownTable('By age/gender', ageGenderSorted.slice(0, keep), (r) => `${r.age} ${shortLabel(GENDER_SHORT, r.gender)}`, omitted),
      formatBreakdownTable('By device', sortBySpendDesc(deviceRows), deviceLabel),
      formatBreakdownTable('By platform', sortBySpendDesc(publisherRows), publisherLabel),
    ];
    const msg = [header, ...sections.map((s) => s.join('\n'))].join('\n\n');
    if (msg.length <= DISCORD_MESSAGE_LIMIT || keep === 0) return msg;
  }
}

// Account-wide checks (need only the aggregate) + per-ad checks (need the breakdown), evaluated
// together each hour since both read from the same per-ad fetch. Fires at most once/day per
// condition and once ever per ad for auto-pause (state-tracked) so a stuck condition doesn't spam.
async function checkAlertsAndAutoPause(dateStr, hourUk) {
  const state = readState();
  const alertsFiredToday = state.alertsFiredToday && state.alertsFiredDate === dateStr ? state.alertsFiredToday : {};
  const autoPausedAdIds = new Set(state.autoPausedAdIds || []);

  const rows = await fetchPerAdInsights('today');
  const totalSpend = rows.reduce((sum, r) => sum + Number(r.spend || 0), 0);

  const fire = async (key, message) => {
    if (alertsFiredToday[key]) return;
    alertsFiredToday[key] = true;
    await postToChangelog(AREA, `🚨 **Meta Ads alert** — ${message}`);
  };

  if (hourUk >= ALERT_RULES.zeroSpendByHourUk && totalSpend === 0) {
    await fire('zero-spend', `still £0 spend today as of ${hourUk}:00 UK — check delivery status in Ads Manager.`);
  }

  for (const row of rows) {
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const ctr = Number(row.ctr || 0);
    const conversions = purchaseCount(row.actions);
    const spend = Number(row.spend || 0);
    const label = `**${row.ad_name}**`;

    if (impressions >= ALERT_RULES.minImpressionsForCtrAlert && ctr < ALERT_RULES.lowCtrPercent) {
      await fire(`low-ctr-${row.ad_id}`, `${label} CTR is ${ctr.toFixed(2)}% over ${impressions.toLocaleString()} impressions (below ${ALERT_RULES.lowCtrPercent}% floor).`);
    }
    if (clicks >= ALERT_RULES.clickNoConvertThreshold && conversions === 0) {
      await fire(`no-convert-${row.ad_id}`, `${label} has ${clicks} clicks and 0 purchases — likely a checkout/funnel problem, not a creative problem.`);
    }

    const meetsPauseSample = spend >= PAUSE_RULES.minSpendGbp && impressions >= PAUSE_RULES.minImpressions;
    if (meetsPauseSample && ctr < PAUSE_RULES.lowCtrPercent && !autoPausedAdIds.has(row.ad_id)) {
      try {
        await pauseAd(row.ad_id);
        autoPausedAdIds.add(row.ad_id);
        await postToChangelog(
          AREA,
          `⏸️ **Auto-paused** ${label} — CTR ${ctr.toFixed(2)}% over ${impressions.toLocaleString()} impressions and £${spend.toFixed(2)} spend (below ${PAUSE_RULES.lowCtrPercent}% floor). This only pauses it — reactivate manually in Ads Manager if you disagree.`
        );
      } catch (err) {
        console.error('[meta-ads-watch] auto-pause failed:', err.message);
      }
    }
  }

  writeState({ alertsFiredToday, alertsFiredDate: dateStr, autoPausedAdIds: [...autoPausedAdIds] });
}

async function checkOnce() {
  const { date, hour } = ukNow();
  const hourKey = `${date}T${hour}`;
  if (readState().lastPostedHourKey === hourKey) return;
  writeState({ lastPostedHourKey: hourKey }); // mark before building, so a slow build can't cause a double-post

  try {
    const summary = await buildTodaySummary();
    await postToChangelog(AREA, summary);
    await checkAlertsAndAutoPause(date, hour);
  } catch (err) {
    console.error('[meta-ads-watch] failed:', err.message);
    // Don't burn the whole hour on one transient failure (auth outage, ETIMEDOUT) —
    // let the next 60s tick retry instead of leaving the channel stale until the next hour.
    writeState({ lastPostedHourKey: null });
  }
}

function start() {
  setInterval(checkOnce, 60_000);
}

module.exports = { start, buildAdsSummary, buildTodaySummary, buildWeekSummary, buildTodayAdvancedSummary, checkAlertsAndAutoPause };
