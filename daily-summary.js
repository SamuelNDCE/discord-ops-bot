const fs = require('node:fs');
const path = require('node:path');
const { readBoard, OPEN_BOARD_SECTIONS, shopifyQuery, netlifyApi, fetchBusinessNews, formatNewsItem, sendChunks, BUSINESS_NAME, SECOND_BUSINESS_NAME, SECOND_BUSINESS_DOMAIN } = require('./lib');

const TARGET_HOUR_UK = 10;
const TARGET_MINUTE_UK = 0;
const CHANNEL_NAME = 'general';
// Comma-separated Discord user IDs to @mention in the daily summary post.
const MENTION_IDS = (process.env.DAILY_SUMMARY_MENTION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const STATE_PATH = path.join(__dirname, 'daily-summary-state.json');
const SUPERVISOR_STATE_PATH = path.join(__dirname, 'supervisor-state.json');
const LAUNCH_STATUS_QUERY = path.join(__dirname, 'queries', 'launch-status.graphql');
const ISSUE_WINDOW_MS = 24 * 3_600_000;
const NEWS_STORY_COUNT = 5;

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

function recentCrashes() {
  try {
    const state = JSON.parse(fs.readFileSync(SUPERVISOR_STATE_PATH, 'utf8'));
    const cutoff = Date.now() - ISSUE_WINDOW_MS;
    return (state.history || []).filter((h) => h.at >= cutoff);
  } catch {
    return [];
  }
}

async function fetchTechNews() {
  try {
    const idsRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = (await idsRes.json()).slice(0, NEWS_STORY_COUNT);
    const items = await Promise.all(
      ids.map((id) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json()))
    );
    return items.map((it) => `- [${it.title}](<${it.url || `https://news.ycombinator.com/item?id=${it.id}`}>) (${it.score} pts)`);
  } catch (err) {
    return [`- couldn't fetch tech news (${err.message})`];
  }
}

async function buildSummary() {
  const lines = [];
  const issues = [];

  const sections = readBoard();
  const counts = OPEN_BOARD_SECTIONS.map((name) => [name, (sections[name] || []).length]).filter(([, n]) => n > 0);
  const totalOpen = counts.reduce((sum, [, n]) => sum + n, 0);
  lines.push(`**Tasks:** ${totalOpen} open (${counts.map(([n, c]) => `${n}: ${c}`).join(', ') || 'none'})`);
  const topTodo = (sections['To Do'] || []).slice(0, 6);
  if (topTodo.length) {
    lines.push('_To Do:_');
    lines.push(...topTodo.map((t) => `- ${t}`));
    const remaining = (sections['To Do'] || []).length - topTodo.length;
    if (remaining > 0) lines.push(`  …and ${remaining} more`);
  }
  const inProgress = [...(sections['Doing'] || []), ...(sections['AI Doing'] || [])].slice(0, 3);
  if (inProgress.length) {
    lines.push('_In progress:_');
    lines.push(...inProgress.map((t) => `- ${t}`));
  }

  try {
    const data = await shopifyQuery(LAUNCH_STATUS_QUERY);
    const passwordWalled = data.onlineStore.passwordProtection.enabled;
    const active = data.activeProductsCount.count;
    const total = data.productsCount.count;
    lines.push(
      `\n**${BUSINESS_NAME}:** ${passwordWalled ? '🔒 password-walled' : '✅ public'} · ${active}/${total} products active · ${data.shop.primaryDomain.host}`
    );
  } catch (err) {
    lines.push(`\n**${BUSINESS_NAME}:** status check failed (${err.message})`);
    issues.push(`❌ ${BUSINESS_NAME} status check failed: ${err.message}`);
  }

  try {
    const [latest] = await netlifyApi('listSiteDeploys', { per_page: 1 });
    const icon = latest.state === 'ready' ? '✅' : latest.state === 'error' ? '❌' : '⏳';
    const hoursAgo = Math.round((Date.now() - new Date(latest.created_at)) / 3_600_000);
    lines.push(`**${SECOND_BUSINESS_DOMAIN}:** ${icon} last deploy ${latest.state} (${hoursAgo}h ago)`);
    if (latest.state === 'error') {
      issues.push(`❌ ${SECOND_BUSINESS_NAME} deploy failed${latest.error_message ? `: ${latest.error_message}` : ''}`);
    }
  } catch (err) {
    lines.push(`**${SECOND_BUSINESS_DOMAIN}:** status check failed (${err.message})`);
    issues.push(`❌ Netlify status check failed: ${err.message}`);
  }

  const crashes = recentCrashes();
  if (crashes.length) {
    const last = crashes[crashes.length - 1];
    issues.push(`🔁 Bot restarted ${crashes.length}× in the last 24h (most recent: exit code ${last.code})`);
  }

  lines.push(issues.length ? '\n**⚠️ Issues (last 24h):**' : '\n**⚠️ Issues (last 24h):** none ✅');
  if (issues.length) lines.push(...issues.map((i) => `- ${i}`));

  lines.push('\n**🌐 Tech news:**');
  lines.push(...(await fetchTechNews()));

  const businessNews = await fetchBusinessNews(2);
  if (businessNews.length) {
    lines.push('\n**📰 Business-relevant news:**');
    const byTopic = {};
    for (const item of businessNews) (byTopic[item.topic] ||= []).push(item);
    for (const [topic, items] of Object.entries(byTopic)) {
      lines.push(`_${topic}:_`);
      for (const item of items) lines.push(await formatNewsItem(item));
    }
  }

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
      const summary = await buildSummary();
      const header = `${MENTION_IDS.map((id) => `<@${id}>`).join(' ')} **Daily summary — ${date}**\n\n`;
      await sendChunks(channel, `${header}${summary}`);
    } catch (err) {
      console.error('[daily-summary] failed:', err.message);
    }
  }, 60_000);
}

module.exports = { start, buildSummary };
