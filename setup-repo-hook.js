// One-time setup: wires a repo into the AI-summarized commit changelog.
// Usage: node setup-repo-hook.js <path-to-repo-root>
// After running, add the repo root to REPOS in notify-commit.js with a label
// (or subfolder categories) — otherwise it'll fall back to a generic folder-name tag.
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.argv[2];
if (!repoRoot) {
  console.error('Usage: node setup-repo-hook.js <path-to-repo-root>');
  process.exit(1);
}
if (!fs.existsSync(path.join(repoRoot, '.git'))) {
  console.error(`${repoRoot} is not a git repo (no .git folder found)`);
  process.exit(1);
}

const scriptPath = path.join(__dirname, 'notify-commit.js').replace(/\\/g, '/');
const hookPath = path.join(repoRoot, '.git', 'hooks', 'post-commit');
fs.writeFileSync(hookPath, `#!/bin/sh\nnode "${scriptPath}" >/dev/null 2>&1 &\n`);
fs.chmodSync(hookPath, 0o755);

console.log(`Installed post-commit hook in ${repoRoot}`);
console.log(`Now add '${repoRoot.replace(/\\/g, '/')}' to REPOS in notify-commit.js.`);
