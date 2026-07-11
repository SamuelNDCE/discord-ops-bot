const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, 'support-email-threads.json');
const MAX_AGE_MS = 90 * 24 * 3_600_000; // stale threads aren't worth replying to; keeps the file bounded

function loadThreads() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Keyed by the Discord message id the customer's email was posted as, so a reply to that
// specific message can be matched back to who to email and what thread to reply into.
function saveThread(discordMessageId, entry) {
  const threads = loadThreads();
  threads[discordMessageId] = { ...entry, storedAt: Date.now() };
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, e] of Object.entries(threads)) {
    if (e.storedAt < cutoff) delete threads[id];
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(threads, null, 2));
}

function getThread(discordMessageId) {
  return loadThreads()[discordMessageId];
}

module.exports = { saveThread, getThread };
