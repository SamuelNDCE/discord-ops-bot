const fs = require('node:fs');
const path = require('node:path');
const { ImapFlow } = require('imapflow');

const CHECK_INTERVAL_MS = 3 * 60_000;
const STATE_PATH = path.join(__dirname, 'email-watch-state.json');
const OWNER_USER_ID = process.env.OWNER_DISCORD_USER_ID; // the Discord user to DM notifications to
const SEARCH_WINDOW_DAYS = 7; // plenty of margin at a few-minutes polling cadence

// Add more rules here as new business-relevant email patterns come up (e.g. cancellations).
// Matches both the original notification AND a forwarded copy (Gmail wraps forwarded subjects
// with "Fwd: " and swaps the From header to whoever set up the forward).
const RULES = [
  {
    label: 'Google Calendar booking',
    matches: (envelope) => /appointment booked:/i.test(envelope.subject || ''),
  },
];

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

function formatMatch(rule, envelope) {
  const from = envelope.from?.[0]?.address || 'unknown sender';
  const when = envelope.date ? new Date(envelope.date).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '';
  return `📧 **${rule.label}**\n${envelope.subject}\n_from ${from}${when ? `, ${when}` : ''}_`;
}

async function checkOnce(client) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return;

  const state = loadState();
  const isFirstRun = state.lastUid === undefined;
  let maxUidSeen = state.lastUid || 0;
  const matches = [];

  const imap = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  });

  try {
    await imap.connect();
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - SEARCH_WINDOW_DAYS * 24 * 3_600_000);
      for await (const msg of imap.fetch({ since }, { envelope: true, uid: true })) {
        maxUidSeen = Math.max(maxUidSeen, msg.uid);
        if (msg.uid <= (state.lastUid || 0)) continue;
        const rule = RULES.find((r) => r.matches(msg.envelope));
        if (rule) matches.push({ rule, envelope: msg.envelope });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[email-watch] check failed:', err.message);
    return;
  } finally {
    await imap.logout().catch(() => {});
  }

  saveState({ lastUid: maxUidSeen });
  if (isFirstRun || !matches.length) return; // first run establishes a baseline, doesn't replay old mail

  const owner = await client.users.fetch(OWNER_USER_ID);
  for (const { rule, envelope } of matches) {
    await owner.send(formatMatch(rule, envelope));
  }
}

function start(client) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('[email-watch] GMAIL_USER/GMAIL_APP_PASSWORD not set in .env — skipping until configured');
    return;
  }
  checkOnce(client);
  setInterval(() => checkOnce(client), CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, formatMatch };
