// Lets Claude add a task to the shared Discord #todo-list from ANY project's session, without
// going through the live bot's slash-command interaction handler — same "standalone script"
// shape as notify-commit.js. Must be runnable via an absolute path from a different repo's cwd
// (that's the whole point — other Claude instances working elsewhere use this too), so .env is
// loaded relative to this file, not the caller's cwd (dotenv's default is process.cwd(), which
// would silently fail to find DISCORD_TOKEN when invoked from outside discord-bot/).
//
// Usage: node add-todo.js "task text" [--by "Claude (my-project)"]
// --by is an explicit flag rather than a second positional arg, since a plain unquoted
// multi-word task ("node add-todo.js fix the bug") would otherwise ambiguously eat its last
// word as the "addedBy" label.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const store = require('./todo-store');

const args = process.argv.slice(2);
const byIndex = args.indexOf('--by');
const addedBy = byIndex !== -1 ? args[byIndex + 1] || 'Claude' : 'Claude';
const text = (byIndex !== -1 ? [...args.slice(0, byIndex), ...args.slice(byIndex + 2)] : args).join(' ').trim();
if (!text) {
  console.error('Usage: node add-todo.js "task text" [--by "addedBy label"]');
  process.exit(1);
}

store.addTodo({ text, addedBy }).then((result) => {
  if (!result.ok) {
    console.error('Failed:', result.error);
    process.exit(1);
  }
  console.log(`Added to #todo-list: ${text}`);
});
