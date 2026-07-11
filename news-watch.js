const fs = require('node:fs');
const path = require('node:path');
const { fetchBusinessNews, formatNewsItem, postToChangelog } = require('./lib');

const CHECK_INTERVAL_MS = 4 * 3_600_000;
const STATE_PATH = path.join(__dirname, 'news-watch-state.json');
const AREA = 'news';
const MAX_SEEN_LINKS = 200;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(patch) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...loadState(), ...patch }, null, 2));
}

const MAX_ARTICLE_AGE_HOURS = 16; // 4x the check interval — genuinely fresh, without going silent most cycles

async function checkOnce() {
  let items;
  try {
    items = await fetchBusinessNews(2, 1, MAX_ARTICLE_AGE_HOURS);
  } catch (err) {
    console.error('[news-watch] fetch failed:', err.message);
    return;
  }
  if (!items.length) return;

  const seen = new Set(loadState().seenLinks || []);
  const fresh = items.filter((i) => !seen.has(i.link));
  saveState({ seenLinks: [...new Set([...seen, ...items.map((i) => i.link)])].slice(-MAX_SEEN_LINKS) });
  if (!fresh.length) return; // nothing new since last check — stay quiet rather than repost old headlines

  const byTopic = {};
  for (const item of fresh) (byTopic[item.topic] ||= []).push(item);

  const lines = ['📰 **Latest business-relevant news:**'];
  for (const [topic, topicItems] of Object.entries(byTopic)) {
    lines.push(`\n_${topic}:_`);
    for (const item of topicItems) lines.push(await formatNewsItem(item));
  }

  await postToChangelog(AREA, lines.join('\n'));
}

function start() {
  checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce };
