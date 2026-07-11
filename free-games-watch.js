const fs = require('node:fs');
const path = require('node:path');
const { sendChunks } = require('./lib');

const TARGET_HOUR_UK = 9;
const TARGET_MINUTE_UK = 0;
const CHANNEL_NAME = 'bot-testing';
const STATE_PATH = path.join(__dirname, 'free-games-watch-state.json');

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

function lastPostedDate() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).lastPosted;
  } catch {
    return null;
  }
}

function markPosted(date) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ lastPosted: date }));
}

async function fetchEpicFreeGames() {
  try {
    const res = await fetch(
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-GB&country=GB&allowCountries=GB'
    );
    const data = await res.json();
    const elements = data?.data?.Catalog?.searchStore?.elements || [];
    return elements
      .filter((el) => el.promotions?.promotionalOffers?.[0]?.promotionalOffers?.length > 0)
      .map((el) => {
        const slug = el.productSlug || el.catalogNs?.mappings?.[0]?.pageSlug || el.urlSlug;
        const endDate = el.promotions.promotionalOffers[0].promotionalOffers[0].endDate;
        const until = endDate ? new Date(endDate).toLocaleDateString('en-GB') : 'unknown';
        return `- **${el.title}** — free until ${until} (<https://store.epicgames.com/en-US/p/${slug}>)`;
      });
  } catch (err) {
    return [`- couldn't fetch Epic Games list (${err.message})`];
  }
}

async function fetchSteamFreeGames() {
  try {
    const res = await fetch('https://store.steampowered.com/api/featuredcategories?cc=GB&l=en');
    const data = await res.json();
    const specials = data?.specials?.items || [];
    return specials
      .filter((it) => it.discount_percent === 100)
      .map((it) => `- **${it.name}** — 100% off (<https://store.steampowered.com/app/${it.id}>)`);
  } catch (err) {
    return [`- couldn't fetch Steam specials (${err.message})`];
  }
}

async function buildDigest(date) {
  const [epic, steam] = await Promise.all([fetchEpicFreeGames(), fetchSteamFreeGames()]);
  const lines = [`**Free games — ${date}**\n`];

  lines.push('**Epic Games Store:**');
  lines.push(...(epic.length ? epic : ['- nothing free right now']));

  lines.push('\n**Steam:**');
  lines.push(...(steam.length ? steam : ['- nothing at 100% off right now']));

  return lines.join('\n');
}

function start(client) {
  setInterval(async () => {
    const { date, hour, minute } = ukNow();
    const pastTarget = hour > TARGET_HOUR_UK || (hour === TARGET_HOUR_UK && minute >= TARGET_MINUTE_UK);
    if (!pastTarget) return;
    if (lastPostedDate() === date) return;
    markPosted(date); // mark before building, so a slow build can't cause a double-post

    try {
      const channel = client.channels.cache.find((c) => c.name === CHANNEL_NAME);
      if (!channel) throw new Error(`#${CHANNEL_NAME} not found`);
      await sendChunks(channel, await buildDigest(date));
    } catch (err) {
      console.error('[free-games-watch] failed:', err.message);
    }
  }, 60_000);
}

module.exports = { start, buildDigest };
