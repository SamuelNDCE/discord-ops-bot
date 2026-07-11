const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, 'reminders.json');
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_MS = 7 * UNIT_MS.d;

const timers = new Map(); // id -> Timeout handle (in-memory, lets /unremind actually cancel a scheduled fire)

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function save(reminders) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(reminders, null, 2));
}

function parseDuration(input) {
  const match = input.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function fire(client, reminder) {
  timers.delete(reminder.id);
  save(load().filter((r) => r.id !== reminder.id));
  client.channels
    .fetch(reminder.channelId)
    .then((channel) => channel.send(`<@${reminder.userId}> reminder: ${reminder.message}`))
    .catch((err) => console.error('[remind] failed to deliver:', err.message));
}

function schedule(client, reminder) {
  const delay = Math.max(0, reminder.fireAt - Date.now());
  timers.set(reminder.id, setTimeout(() => fire(client, reminder), delay));
}

function create(client, { userId, channelId, message, durationInput }) {
  const ms = parseDuration(durationInput);
  if (!ms || ms > MAX_MS) return null;
  const reminder = { id: shortId(), fireAt: Date.now() + ms, userId, channelId, message };
  save([...load(), reminder]);
  schedule(client, reminder);
  return reminder;
}

function list() {
  return load().sort((a, b) => a.fireAt - b.fireAt);
}

function cancel(id) {
  const reminders = load();
  if (!reminders.some((r) => r.id === id)) return false;
  const handle = timers.get(id);
  if (handle) clearTimeout(handle);
  timers.delete(id);
  save(reminders.filter((r) => r.id !== id));
  return true;
}

function scheduleAllPending(client) {
  for (const reminder of load()) schedule(client, reminder);
}

module.exports = { create, list, cancel, scheduleAllPending, parseDuration, MAX_MS };
