// Maps a Discord user id -> their progress changelog area (e.g. "alice-progress"). Self-service
// (each person registers their own via /todo myprogress) rather than guessed from username or
// pulled from the guild member list — the bulk member-list endpoint needs a privileged intent
// this bot doesn't have enabled, and username-guessing would be fragile (Discord usernames don't
// necessarily match whatever naming you pick for the channels).
const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, 'progress-map.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function setArea(userId, area) {
  const map = load();
  map[userId] = area;
  fs.writeFileSync(STORE_PATH, JSON.stringify(map, null, 2));
}

function getArea(userId) {
  return load()[userId] || null;
}

module.exports = { setArea, getArea };
