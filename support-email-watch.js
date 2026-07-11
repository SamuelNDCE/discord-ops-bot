const fs = require('node:fs');
const path = require('node:path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { saveThread } = require('./support-thread-store');
const { classifyEmail, summarizeEmail, iconFor } = require('./email-classifier');

const CHECK_INTERVAL_MS = 3 * 60_000;
const STATE_PATH = path.join(__dirname, 'support-email-watch-state.json');
const SEARCH_WINDOW_DAYS = 7; // plenty of margin at a few-minutes polling cadence
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; // role ID for your support team
const WEBHOOK_PATH = path.join(__dirname, 'webhooks', 'contact.json');
const MAX_SUBJECT_LEN = 500; // bound untrusted external subject lines well under Discord's 2000-char limit
const MAX_BODY_PREVIEW_LEN = 800; // leaves headroom under Discord's 2000-char message limit alongside the rest

// GMAIL_USER can be a personal/shared inbox with your support alias added as an alias
// (mail for both lands in the same mailbox) — only react to messages actually addressed to the
// business alias, not the account's regular mail.
const CONTACT_ADDRESS = process.env.CONTACT_ADDRESS || 'contact@business1.example.com';

function isAddressedToContact(envelope) {
  const recipients = [...(envelope.to || []), ...(envelope.cc || [])];
  return recipients.some((r) => r.address?.toLowerCase() === CONTACT_ADDRESS);
}

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

function safeSubject(envelope) {
  const subject = envelope.subject || '(no subject)';
  return subject.length > MAX_SUBJECT_LEN ? `${subject.slice(0, MAX_SUBJECT_LEN)}…` : subject;
}

// Only new messages get their body downloaded (not the whole 7-day scan window) — this runs
// per-message against a still-open mailbox lock right after the cheap envelope scan finds them.
async function fetchBodyText(imap, uid) {
  try {
    const { content } = await imap.download(uid, undefined, { uid: true });
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    const parsed = await simpleParser(Buffer.concat(chunks));
    if (parsed.text) return parsed.text;
    if (parsed.html) return parsed.html.replace(/<[^>]+>/g, ' ');
    return '';
  } catch (err) {
    console.error('[support-email-watch] body fetch failed:', err.message);
    return '';
  }
}

function truncateBody(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '_(no message body)_';
  if (trimmed.length <= MAX_BODY_PREVIEW_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_BODY_PREVIEW_LEN).replace(/\s+\S*$/, '')}…`;
}

function formatEmail(envelope, category, bodyText, summary) {
  const from = envelope.from?.[0]?.address || 'unknown sender';
  const fromName = envelope.from?.[0]?.name;
  const to = (envelope.to || []).map((r) => r.address).filter(Boolean).join(', ') || CONTACT_ADDRESS;
  const when = envelope.date ? new Date(envelope.date).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '';
  const ping = category === 'Support' ? `<@&${SUPPORT_ROLE_ID}> ` : '';
  const lines = [
    `${ping}${iconFor(category)} **New ${category.toLowerCase()} email**`,
    `**To:** ${to}`,
    `**From:** ${fromName ? `${fromName} <${from}>` : from}${when ? ` · ${when}` : ''}`,
    `**Subject:** ${safeSubject(envelope)}`,
    '',
    '**Message:**',
    truncateBody(bodyText),
    '',
    ...(summary ? [`**Summary:** ${summary}`, ''] : []),
    '_Reply to this message in Discord to send an email reply back to the customer._',
  ];
  return lines.join('\n');
}

// Posts via the raw webhook (not lib.js's postToChangelog) because we need Discord's returned
// message id back to record the reply mapping — postToChangelog is fire-and-forget by design.
async function postAndTrack(envelope, category, bodyText, summary) {
  const { url } = JSON.parse(fs.readFileSync(WEBHOOK_PATH, 'utf8'));
  const res = await fetch(`${url}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: formatEmail(envelope, category, bodyText, summary) }),
  });
  if (!res.ok) {
    console.error('[support-email-watch] webhook post failed:', res.status);
    return;
  }
  const posted = await res.json();
  const from = envelope.from?.[0]?.address;
  if (from) {
    saveThread(posted.id, {
      to: from,
      subject: safeSubject(envelope),
      originalMessageId: envelope.messageId || null,
      category,
    });
  }
}

async function checkOnce() {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return;

  const state = loadState();
  const isFirstRun = state.lastUid === undefined;
  let maxUidSeen = state.lastUid || 0;
  const newMessages = [];

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
        if (!isAddressedToContact(msg.envelope)) continue;
        newMessages.push({ uid: msg.uid, envelope: msg.envelope });
      }

      saveState({ lastUid: maxUidSeen });
      if (isFirstRun || !newMessages.length) return; // first run establishes a baseline, doesn't replay old mail

      for (const { uid, envelope } of newMessages) {
        const bodyText = await fetchBodyText(imap, uid);
        const category = await classifyEmail(safeSubject(envelope), bodyText);
        const summary = await summarizeEmail(safeSubject(envelope), bodyText);
        await postAndTrack(envelope, category, bodyText, summary);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[support-email-watch] check failed:', err.message);
  } finally {
    await imap.logout().catch(() => {});
  }
}

function start() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('[support-email-watch] GMAIL_USER/GMAIL_APP_PASSWORD not set in .env — skipping until configured');
    return;
  }
  checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, checkOnce, formatEmail };
