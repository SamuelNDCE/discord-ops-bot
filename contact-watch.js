const fs = require('node:fs');
const path = require('node:path');
const { netlifyApi } = require('./lib');

const CHECK_INTERVAL_MS = 3 * 60_000;
const STATE_PATH = path.join(__dirname, 'contact-watch-state.json');
const OWNER_USER_ID = process.env.OWNER_DISCORD_USER_ID; // the Discord user to DM notifications to

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

function formatSubmission(s) {
  const f = s.data || {};
  const lines = [`📨 **New contact form submission** (${s.form_name})`, `**${f.name || '(no name)'}** — ${f.email || '(no email)'}`];
  if (f.company) lines.push(`Company: ${f.company}`);
  if (f.service) lines.push(`Service: ${f.service}`);
  if (f.message) lines.push(`"${f.message}"`);
  return lines.join('\n');
}

async function checkOnce(client) {
  let forms;
  try {
    forms = await netlifyApi('listSiteForms', {});
  } catch (err) {
    console.error('[contact-watch] check failed:', err.message);
    return;
  }
  if (!forms.length) return;

  const state = loadState();
  const lastSeen = state.lastSeenByForm || {};
  const nextLastSeen = { ...lastSeen };
  const newSubmissions = [];

  for (const form of forms) {
    let subs;
    try {
      subs = await netlifyApi('listFormSubmissions', { form_id: form.id });
    } catch (err) {
      console.error(`[contact-watch] form ${form.name} check failed:`, err.message);
      continue;
    }
    if (!subs.length) continue;

    const sorted = [...subs].sort((a, b) => a.number - b.number);
    nextLastSeen[form.id] = sorted[sorted.length - 1].number;
    const prevSeen = lastSeen[form.id];
    if (prevSeen === undefined) continue; // first run for this form — baseline only, don't replay old submissions
    newSubmissions.push(...sorted.filter((s) => s.number > prevSeen));
  }

  saveState({ lastSeenByForm: nextLastSeen });
  if (!newSubmissions.length) return;

  const owner = await client.users.fetch(OWNER_USER_ID);
  for (const s of newSubmissions) {
    await owner.send(formatSubmission(s));
  }
}

function start(client) {
  checkOnce(client);
  setInterval(() => checkOnce(client), CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, formatSubmission };
