// Lets Claude edit an existing #todo-list task's text from ANY project's session, without going
// through the live bot's slash-command interaction handler — same "standalone script" shape as
// add-todo.js. Must be runnable via an absolute path from a different repo's cwd, so .env is
// loaded relative to this file, not the caller's cwd.
//
// Usage: node edit-todo.js "task query" "new task text"
// Finds the task the same way /todo accept/remove do (exact id, or a case-insensitive substring
// of its current text) and rewrites it. If the task has already been accepted, this also pushes a
// fresh update to the accepter's progress channel (handled inside todo-store.editTodo) — same
// behavior as running /todo edit in Discord.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const store = require('./todo-store');

const [query, ...rest] = process.argv.slice(2);
const newText = rest.join(' ').trim();
if (!query || !newText) {
  console.error('Usage: node edit-todo.js "task query" "new task text"');
  process.exit(1);
}

store.editTodo({ query, newText }).then((result) => {
  if (!result.ok) {
    console.error('Failed:', result.error);
    process.exit(1);
  }
  console.log(`Edited: "${result.todo.text}"`);
});
