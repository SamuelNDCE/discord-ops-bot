const fs = require('node:fs');
const path = require('node:path');
const { netlifyApi, postToChangelog, SECOND_BUSINESS_NAME } = require('./lib');

const CHECK_INTERVAL_MS = 5 * 60_000;
const STATE_PATH = path.join(__dirname, 'netlify-watch-state.json');
const AREA = 'netlify';

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

function formatDeployLine(d) {
  const icon = d.state === 'ready' ? '✅' : d.state === 'error' ? '❌' : '⏳';
  const seconds = d.deploy_time ? `${d.deploy_time}s` : '?';
  const errorSuffix = d.error_message ? ` — ${d.error_message}` : '';
  return `${icon} Deploy \`${d.id.slice(0, 8)}\` (${d.context || 'unknown'}, ${seconds})${errorSuffix}`;
}

async function checkOnce() {
  let deploys;
  try {
    deploys = await netlifyApi('listSiteDeploys', { per_page: 10 });
  } catch (err) {
    console.error('[netlify-watch] check failed:', err.message);
    return;
  }
  if (!deploys.length) return;

  const sorted = [...deploys].reverse(); // oldest-first
  const state = loadState();
  const lastSeenId = state.lastDeployId;
  saveState({ lastDeployId: sorted[sorted.length - 1].id });
  if (!lastSeenId) return; // first run ever — establish baseline only

  const idx = sorted.findIndex((d) => d.id === lastSeenId);
  const missedSome = idx === -1; // more deploys happened than the page size retained
  const newDeploys = missedSome ? sorted : sorted.slice(idx + 1);
  if (!newDeploys.length) return;

  const lines = newDeploys.map(formatDeployLine);
  if (missedSome) lines.unshift('_(more deploys happened than could be retained — showing the most recent)_');

  await postToChangelog(AREA, `**${SECOND_BUSINESS_NAME} site — new deploy(s):**\n${lines.join('\n')}`);
}

function start() {
  checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, formatDeployLine };
