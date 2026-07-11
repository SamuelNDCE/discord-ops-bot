// Lets Claude post a progress update from any session — same "standalone script" shape as
// add-todo.js/notify-commit.js, reusing the existing generic postToChangelog. Each person has
// their own AI activity channel (#samuel-claude-progress, #owens-claude-progress) rather than
// one shared #claude-progress, so every call must say whose session it is via --owner.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const { postToChangelog } = require('./lib');

const OWNERS = ['samuel', 'owens'];

const args = process.argv.slice(2);
const ownerIndex = args.indexOf('--owner');
const owner = ownerIndex !== -1 ? args[ownerIndex + 1] : null;
const text = (ownerIndex !== -1 ? [...args.slice(0, ownerIndex), ...args.slice(ownerIndex + 2)] : args)
  .join(' ')
  .trim();

if (!text || !OWNERS.includes(owner)) {
  console.error(`Usage: node post-progress.js "what you did" --owner <${OWNERS.join('|')}>`);
  process.exit(1);
}

const area = `${owner}-claude-progress`;
postToChangelog(area, text).then(({ ok }) => {
  if (!ok) {
    console.error(`Failed to post to #${area}.`);
    process.exit(1);
  }
  console.log(`Posted to #${area}.`);
});
