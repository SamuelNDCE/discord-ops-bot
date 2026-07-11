const fs = require('node:fs');
const path = require('node:path');
const { explainTask, postToChangelog } = require('./lib');
const progressMap = require('./progress-map');

const STORE_PATH = path.join(__dirname, 'todos.json');
const TODO_CHANNEL_ID = process.env.TODO_CHANNEL_ID; // channel ID for your #todo-list channel
const DONE_EMOJI = '✅';
const CLAIM_EMOJI = '🙋';
const REMOVE_EMOJI = '❌';
const REACTIONS = [CLAIM_EMOJI, DONE_EMOJI, REMOVE_EMOJI]; // pre-added in this order: start, finish, remove

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function save(todos) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(todos, null, 2));
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Adding 3 reactions to the same message back-to-back can hit Discord's per-message reaction
// rate limit — caught live during verification: a bare Promise.all-style loop silently dropped
// one of the three pre-added reactions with no error surfaced anywhere. Respects a real
// `retry-after` from a 429 instead of guessing a delay, one retry (a genuinely stuck rate limit
// beyond that is a Discord-side problem, not something worth looping on indefinitely here).
async function addReaction(messageId, emoji) {
  const { DISCORD_TOKEN } = process.env;
  const url = `https://discord.com/api/v10/channels/${TODO_CHANNEL_ID}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_TOKEN}` } });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep((body.retry_after || 1) * 1000 + 100);
    await fetch(url, { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_TOKEN}` } });
  }
}

// Each task is its own message so a per-item reaction can track it individually — the bot
// pre-adds all three action reactions itself so every action is just "react", not "find/type
// the right thing": 🙋 start, ✅ finish, ❌ remove.
async function addTodo({ text, addedBy }) {
  const { DISCORD_TOKEN } = process.env;
  const res = await fetch(`https://discord.com/api/v10/channels/${TODO_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ content: renderOpenText({ text, addedBy }) }),
  });
  if (!res.ok) return { ok: false, error: await res.text() };
  const message = await res.json();

  for (const emoji of REACTIONS) {
    await addReaction(message.id, emoji);
  }

  const todo = { id: shortId(), messageId: message.id, text, addedBy, done: false };
  save([...load(), todo]);
  return { ok: true, todo };
}

function renderOpenText({ text, addedBy }) {
  return `☐ ${text}\n_added by ${addedBy} — react ${CLAIM_EMOJI} to start, ${DONE_EMOJI} to finish, ${REMOVE_EMOJI} to remove_`;
}

// Returns null if the message isn't a tracked todo, or was already marked done (so a
// double-react — e.g. the bot's own initial reaction plus a later un-react/re-react — never
// re-fires the completion edit).
function markDone(messageId, doneBy) {
  const todos = load();
  const todo = todos.find((t) => t.messageId === messageId);
  if (!todo || todo.done) return null;
  todo.done = true;
  todo.doneBy = doneBy;
  todo.doneAt = Date.now();
  save(todos);
  return todo;
}

function _setAccepted(todo, acceptedBy, acceptedById) {
  const todos = load();
  const stored = todos.find((t) => t.messageId === todo.messageId);
  if (!stored || stored.done) return null;
  stored.acceptedBy = acceptedBy;
  stored.acceptedById = acceptedById;
  stored.acceptedAt = Date.now();
  save(todos);
  return stored;
}

// Matches by exact short id first, then falls back to a case-insensitive substring of the task
// text — lets "/todo accept"/"/todo remove" work with what someone actually remembers ("the
// login bug one") instead of requiring the opaque id. First match wins if more than one task
// matches; fine for a small team list, not worth a disambiguation UI unless it becomes a problem.
function _findOpenByQuery(query) {
  const q = query.trim().toLowerCase();
  return load().find((t) => !t.done && (t.id === q || t.text.toLowerCase().includes(q)));
}

function acceptTodo({ query, acceptedBy, acceptedById }) {
  const todo = _findOpenByQuery(query);
  if (!todo) return { ok: false, error: `No open task matching "${query}" found.` };
  return { ok: true, todo: _setAccepted(todo, acceptedBy, acceptedById) };
}

// Finds an open task by query and rewrites its text — same lookup rules as acceptTodo/removeByQuery.
// Re-renders the todo-list post so the list always matches the stored text, and if the task has
// already been accepted, pushes a FRESH message (not an edit of the old one) to the accepter's
// progress channel so their log reflects what the task actually says now, not what it said when
// they started. Callable from the /todo edit command and from edit-todo.js (Claude, any project).
async function editTodo({ query, newText }) {
  const todo = _findOpenByQuery(query);
  if (!todo) return { ok: false, error: `No open task matching "${query}" found.` };
  const todos = load();
  const stored = todos.find((t) => t.messageId === todo.messageId);
  stored.text = newText;
  save(todos);
  await renderMessage(stored);

  if (stored.acceptedById) {
    const area = progressMap.getArea(stored.acceptedById);
    if (area) await postToChangelog(area, await buildUpdatedMessage(stored));
  }
  return { ok: true, todo: stored };
}

// Command-driven equivalent of the ❌ reaction — same underlying removeTodo(), just found by
// text query instead of a message id.
function removeByQuery(query) {
  const todo = _findOpenByQuery(query);
  if (!todo) return { ok: false, error: `No open task matching "${query}" found.` };
  return { ok: true, todo: removeTodo(todo.messageId) };
}

// Same as acceptTodo but keyed by the exact message id — what the 🙋 reaction handler has,
// rather than a text query. Returns null (not an {ok,error} shape) since the reaction handler
// just silently no-ops on anything that isn't a live open task, same as markDone/removeTodo.
function claimByReaction(messageId, acceptedBy, acceptedById) {
  const todos = load();
  const todo = todos.find((t) => !t.done && t.messageId === messageId);
  if (!todo) return null;
  return _setAccepted(todo, acceptedBy, acceptedById);
}

// Fully deletes a task — both the store entry and the Discord message itself — not just a
// "removed" state, matching "remove" literally. Returns the removed todo (for logging/cleanup)
// or null if it wasn't a tracked, still-open task.
function removeTodo(messageId) {
  const todos = load();
  const todo = todos.find((t) => !t.done && t.messageId === messageId);
  if (!todo) return null;
  save(todos.filter((t) => t.messageId !== messageId));
  return todo;
}

// Re-renders the todo message for its current state (open / accepted / done) so the list itself
// always shows who's doing what at a glance, not just the person's own progress channel.
async function renderMessage(todo) {
  const { DISCORD_TOKEN } = process.env;
  const acceptedNote = todo.acceptedBy ? ` — accepted by ${todo.acceptedBy}` : '';
  const content = todo.done
    ? `~~${todo.text}~~\n_added by ${todo.addedBy}${acceptedNote} — ${DONE_EMOJI} done by ${todo.doneBy}_`
    : todo.acceptedBy
      ? `🔵 ${todo.text}\n_added by ${todo.addedBy}${acceptedNote} — react ${DONE_EMOJI} to finish, ${REMOVE_EMOJI} to remove_`
      : renderOpenText(todo);
  await fetch(`https://discord.com/api/v10/channels/${TODO_CHANNEL_ID}/messages/${todo.messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function deleteMessage(messageId) {
  const { DISCORD_TOKEN } = process.env;
  await fetch(`https://discord.com/api/v10/channels/${TODO_CHANNEL_ID}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
  });
}

// Other currently-open task headers, for explainTask's "does this connect to anything else"
// context — excludes the task itself and caps to a handful so the (small, local) model isn't
// fed the entire board.
function _otherOpenHeaders(excludeMessageId) {
  return listOpen()
    .filter((t) => t.messageId !== excludeMessageId)
    .slice(0, 10)
    .map((t) => t.text.split('\n')[0]);
}

// Shared by the /todo accept command and the 🙋 reaction handler so both post identical progress
// messages — a task's first line as the header (some tasks are one line, some are several
// paragraphs; only the header repeats in the progress channel) plus an AI-generated write-up of
// what it involves, its end goal, and how it connects to other open work. Fails soft: no
// write-up line if Ollama's down, same as every other Ollama-backed feature in this bot.
async function buildStartedMessage(todo) {
  const header = todo.text.split('\n')[0];
  const lines = [`🔵 **Started**: ${header}`];
  const explanation = await explainTask(todo.text, _otherOpenHeaders(todo.messageId));
  if (explanation) lines.push(`\n📝 ${explanation}`);
  return lines.join('\n');
}

// Posted to the progress channel when an already-accepted task's text changes (via /todo edit or
// edit-todo.js) — a fresh message rather than editing the "Started" post, so the channel keeps a
// visible trail of what changed and when, same reasoning as why /log posts new messages too.
async function buildUpdatedMessage(todo) {
  const header = todo.text.split('\n')[0];
  const lines = [`🔄 **Updated**: ${header}`];
  const explanation = await explainTask(todo.text, _otherOpenHeaders(todo.messageId));
  if (explanation) lines.push(`\n📝 ${explanation}`);
  return lines.join('\n');
}

function listOpen() {
  return load().filter((t) => !t.done);
}

module.exports = {
  addTodo,
  markDone,
  acceptTodo,
  claimByReaction,
  removeTodo,
  removeByQuery,
  editTodo,
  renderMessage,
  deleteMessage,
  buildStartedMessage,
  buildUpdatedMessage,
  listOpen,
  TODO_CHANNEL_ID,
  DONE_EMOJI,
  CLAIM_EMOJI,
  REMOVE_EMOJI,
};
