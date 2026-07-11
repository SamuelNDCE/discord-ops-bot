const { execSync } = require('node:child_process');
const path = require('node:path');
const { postToChangelog, askOllama } = require('./lib');

// Install this as the post-commit hook in any repo you work in — see setup-repo-hook.js.
// Give a repo fine-grained subfolder categories (for a monorepo of several tools) or a single
// whole-repo label (for everything else) by adding an entry below, keyed by its absolute path.
// Unknown repos (hook installed somewhere new later) fall back to their folder name, so nothing
// breaks — the table below is entirely optional, just nicer labels for the repos you list.
const REPOS = {
  // Example monorepo with per-subfolder categories:
  // 'C:/path/to/my-monorepo': {
  //   categories: { 'discord-bot': '🤖 Discord bot', social: '📱 Social publishing' },
  // },
  // Example single-repo label:
  // 'C:/path/to/my-other-project': { label: '🌐 My other project' },
};

const MAX_DIFF_CHARS = 6000; // keep the summarizer prompt small so the 3b model stays fast

async function summarizeDiff(diffText) {
  if (!diffText) return null;
  const truncated = diffText.length > MAX_DIFF_CHARS ? `${diffText.slice(0, MAX_DIFF_CHARS)}\n…(truncated)` : diffText;
  try {
    const reply = await askOllama(
      `Summarize what this code change actually does, in one short plain sentence (max ~25 words). ` +
        `Describe the functionality/behavior that changed, not the file names. Diff:\n\n${truncated}`
    );
    return reply.replace(/\n+/g, ' ').trim();
  } catch {
    return null; // Ollama down/unreachable — the file list below still tells the story
  }
}

async function main() {
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const repoConfig = REPOS[repoRoot] || { label: `📁 ${path.basename(repoRoot)}` };

  const hash = execSync('git rev-parse --short HEAD').toString().trim();
  const subject = execSync('git log -1 --pretty=%s').toString().trim();
  const author = execSync('git log -1 --pretty=%an').toString().trim();
  const isCheckpoint = subject.startsWith('claude: auto-checkpoint');

  let diffOutput = '';
  try {
    diffOutput = execSync('git diff --name-status HEAD~1 HEAD').toString().trim();
  } catch {
    // first commit in the repo — nothing to diff against, nothing to report
  }
  if (!diffOutput) return;

  const STATUS_ICON = { A: '➕', M: '✏️', D: '🗑️', R: '🔀' };
  const MAX_FILES = 15;

  function categorize(filePath) {
    for (const [prefix, label] of Object.entries(repoConfig.categories)) {
      if (filePath === prefix || filePath.startsWith(`${prefix}/`)) return label;
    }
    return null;
  }

  const rows = diffOutput.split('\n').map((line) => {
    const [status, ...rest] = line.split('\t');
    const filePath = rest.join(' → ');
    return { icon: STATUS_ICON[status[0]] || '📝', filePath };
  });

  let tag;
  if (repoConfig.categories) {
    const categoriesTouched = [...new Set(rows.map((r) => categorize(r.filePath)).filter(Boolean))];
    tag = categoriesTouched.length ? ` — ${categoriesTouched.join(', ')}` : '';
  } else {
    tag = ` — ${repoConfig.label}`;
  }

  const fileLines = rows.map((r) => `${r.icon} ${r.filePath}`);
  const shown = fileLines.slice(0, MAX_FILES);
  if (fileLines.length > MAX_FILES) shown.push(`…and ${fileLines.length - MAX_FILES} more`);

  const header = isCheckpoint
    ? `**[code]** ${author} made changes${tag} (\`${hash}\`)`
    : `**[code]** ${author}: ${subject}${tag} (\`${hash}\`)`;

  let fullDiff = '';
  try {
    fullDiff = execSync('git diff HEAD~1 HEAD -- . ":(exclude)*.lock" ":(exclude)package-lock.json"', {
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
  } catch {
    // diff too large or unavailable — summary will just be skipped
  }
  const summary = await summarizeDiff(fullDiff);
  const summaryLine = summary ? `> ${summary}\n` : '';

  await postToChangelog('general', `${header}\n${summaryLine}${shown.join('\n')}`);
}

main();
