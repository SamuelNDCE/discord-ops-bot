const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Changelog areas are just files in webhooks/<area>.json — no hardcoded list. Adding a new area
// (e.g. "meta-ads") is a pure data operation: create the file (see commands/setup-changelog.js),
// no code change needed here.
const WEBHOOKS_DIR = path.join(__dirname, 'webhooks');

function changelogAreaExists(area) {
  return fs.existsSync(path.join(WEBHOOKS_DIR, `${area}.json`));
}

function listChangelogAreas() {
  try {
    return fs
      .readdirSync(WEBHOOKS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function loadWebhookUrl(area) {
  try {
    return JSON.parse(fs.readFileSync(path.join(WEBHOOKS_DIR, `${area}.json`), 'utf8')).url;
  } catch {
    return null;
  }
}

// Posts a message to exactly one changelog channel (each event belongs in one place, not duplicated
// across channels). Returns {area, ok} — callers that care about delivery (e.g. /log) can report
// honestly instead of assuming success. Splits into multiple webhook posts if the message exceeds
// Discord's 2000-char limit — a bare long post is silently rejected by Discord otherwise.
async function postToChangelog(area, message) {
  const url = loadWebhookUrl(area);
  if (!url) return { area, ok: false };
  const chunks = chunkText(message);
  try {
    for (const chunk of chunks) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: chunk }),
      });
      if (!res.ok) return { area, ok: false };
    }
    return { area, ok: true };
  } catch {
    return { area, ok: false };
  }
}

// Shopify's own app name is verbose ("Shopify CLI Connector App") — shorten it for readability.
const ACTOR_ALIASES = { 'Shopify CLI Connector App': 'Shopify connector' };

function shopifyEventActor(e) {
  const rawWho = e.attributeToUser ? e.author : e.appTitle || e.author;
  return ACTOR_ALIASES[rawWho] || rawWho;
}

function formatShopifyEventLine(e) {
  const icon = e.attributeToUser ? '👤' : '🤖';
  const clean = e.message.replace(/<[^>]+>/g, '');
  return `${icon} **${shopifyEventActor(e)}**: ${clean}`;
}

// "Big ticket" = the two literal go-live-to-customers signals. Deliberately narrow — the raw
// Events feed also includes per-variant tweaks and internal status flips that would read as
// noisy/awkward if turned into customer-facing blog drafts.
const BIG_TICKET_PATTERNS = [
  { type: 'collection', re: /published a collection on Online Store/i },
  { type: 'product', re: /included a product on Online Store/i },
];

function matchBigTicketEvent(message) {
  const clean = message.replace(/<[^>]+>/g, '');
  const pattern = BIG_TICKET_PATTERNS.find((p) => p.re.test(clean));
  if (!pattern) return null;
  const nameMatch = clean.match(/:\s*(.+?)\.?\s*$/);
  if (!nameMatch) return null;
  return { type: pattern.type, name: nameMatch[1] };
}

const ARTICLE_MUTATION = `
mutation CreateDraftArticle($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article { id title }
    userErrors { field message }
  }
}`;

// Always drafts (isPublished: false) — a human reviews/edits/publishes from Shopify Admin.
async function draftChangelogArticle({ blogId, type, name }) {
  const title = type === 'collection' ? `New collection: ${name}` : `New in: ${name}`;
  const body =
    type === 'collection'
      ? `We've added a new collection: ${name}.`
      : `${name} is now live on the store.`;

  const file = path.join(__dirname, `_tmp-draft-article-${Date.now()}.graphql`);
  fs.writeFileSync(file, ARTICLE_MUTATION);
  try {
    const result = await shopifyMutate(file, {
      article: { blogId, title, body, isPublished: false, author: { name: BUSINESS_NAME } },
    });
    if (result.articleCreate.userErrors.length) {
      throw new Error(JSON.stringify(result.articleCreate.userErrors));
    }
    return result.articleCreate.article;
  } finally {
    fs.unlinkSync(file);
  }
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'your-store.myshopify.com';
const BOARD_PATH = process.env.NV_BOARD_PATH || path.join(__dirname, 'board.md');

// Display name for the store/business this bot reports on — set BUSINESS_NAME in .env.
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Business 1';
// A second business this bot also tracks (e.g. deploys/news) — optional, set SECOND_BUSINESS_NAME.
const SECOND_BUSINESS_NAME = process.env.SECOND_BUSINESS_NAME || 'Business 2';
const SECOND_BUSINESS_DOMAIN = process.env.SECOND_BUSINESS_DOMAIN || 'business2.example.com';
const OPEN_BOARD_SECTIONS = ['To Do', 'AI To Do', 'Doing', 'AI Doing', 'Awaiting Review'];

async function shopifyQuery(queryFile) {
  const { stdout } = await execFileAsync('cmd.exe', [
    '/c', 'shopify.cmd', 'store', 'execute',
    '--store', SHOPIFY_STORE,
    '--json',
    '--query-file', queryFile,
  ]);
  return JSON.parse(stdout);
}

// Variables go through a file, not a raw --variables argument — a JSON string containing an
// apostrophe (e.g. a product named "Men's grooming kit") corrupts cmd.exe's argument parsing on
// Windows and the CLI reports "Unterminated string in JSON", even though the JSON itself is valid.
async function shopifyMutate(queryFile, variables) {
  const variableFile = path.join(__dirname, `_tmp-variables-${Date.now()}.json`);
  fs.writeFileSync(variableFile, JSON.stringify(variables));
  try {
    const { stdout } = await execFileAsync('cmd.exe', [
      '/c', 'shopify.cmd', 'store', 'execute',
      '--store', SHOPIFY_STORE,
      '--json',
      '--allow-mutations',
      '--query-file', queryFile,
      '--variable-file', variableFile,
    ]);
    return JSON.parse(stdout);
  } finally {
    fs.unlinkSync(variableFile);
  }
}

const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID || 'c55f003a-0aaa-4fe0-a6b0-aaa0080d3e93';

async function netlifyApi(method, data) {
  const { stdout } = await execFileAsync('cmd.exe', [
    '/c', 'netlify.cmd', 'api', method,
    '--data', JSON.stringify({ site_id: NETLIFY_SITE_ID, ...data }),
  ]);
  return JSON.parse(stdout);
}

const cleanMojibake = (s) => s.replace(/â€”/g, '—').replace(/â€™/g, '’').replace(/â€œ|â€/g, '"');

function parseBoard(md) {
  const sections = {};
  let current = null;
  for (const line of md.split('\n')) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
      continue;
    }
    const item = line.match(/^-\s+(.+)/);
    if (item && current) sections[current].push(cleanMojibake(item[1].split('::')[0].trim()));
  }
  return sections;
}

function readBoard() {
  return parseBoard(fs.readFileSync(BOARD_PATH, 'utf8'));
}

async function askOllama(messages) {
  const chatMessages = typeof messages === 'string' ? [{ role: 'user', content: messages }] : messages;
  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: chatMessages,
        think: false,
        stream: false,
      }),
    });
  } catch (err) {
    throw new Error(`Can't reach Ollama at ${OLLAMA_HOST} — is it running?`);
  }

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.message?.content?.trim() || '(empty response)';
}

// Splits on newline boundaries so a long markdown link ([text](<url>)) is never cut in half —
// a raw character-count slice can land mid-URL, which breaks the markdown in BOTH resulting
// chunks (Discord shows the dangling `(<...` and `...>)` halves as plain, unlinked text).
// Only hard-splits a single line if that one line alone exceeds maxLen (very unlikely in
// practice — a single markdown link line is a few hundred chars at most).
function chunkText(text, maxLen = 1900) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (line.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += maxLen) chunks.push(line.slice(i, i + maxLen));
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

async function replyChunks(interaction, text) {
  const chunks = chunkText(text);
  await interaction.editReply(chunks[0]);
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp(chunk);
  }
}

async function sendChunks(channel, text) {
  for (const chunk of chunkText(text)) {
    await channel.send(chunk);
  }
}

// One query per business this bot tracks — add/adjust here, no code changes needed elsewhere.
const BUSINESS_NEWS_TOPICS = [
  { label: BUSINESS_NAME, query: process.env.BUSINESS_NEWS_QUERY || 'your industry keywords here' },
  { label: SECOND_BUSINESS_NAME, query: process.env.SECOND_BUSINESS_NEWS_QUERY || 'your second industry keywords here' },
];

const decodeXmlEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Google News RSS — free, no key, no new dependency (fetch + regex; the feed's structure is
// stable and simple enough that a full XML parser would be overkill). Sorts by actual publish
// time (Google's own result order is relevance-based, not chronological) and drops anything
// older than maxAgeHours, so "latest news" always means genuinely recent, not just within the
// day-granularity `when:` window Google's query syntax supports.
async function fetchBusinessNews(itemsPerTopic = 2, windowDays = 1, maxAgeHours = windowDays * 24) {
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  const results = [];
  const claimedTitles = new Set(); // the same real story can match more than one topic query — show it once
  for (const topic of BUSINESS_NEWS_TOPICS) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${topic.query} when:${windowDays}d`)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url);
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      const parsed = [];
      for (const [, itemXml] of items) {
        let title = decodeXmlEntities(itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
        const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
        const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
        const source = decodeXmlEntities(itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
        if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)); // Google repeats it in the title
        const publishedAt = Date.parse(pubDate);
        const dedupeKey = title.trim().toLowerCase();
        if (title && link && !Number.isNaN(publishedAt) && publishedAt >= cutoff && !claimedTitles.has(dedupeKey)) {
          parsed.push({ topic: topic.label, title, link, pubDate, source, publishedAt, dedupeKey });
        }
      }
      parsed.sort((a, b) => b.publishedAt - a.publishedAt);
      const picked = parsed.slice(0, itemsPerTopic);
      for (const item of picked) claimedTitles.add(item.dedupeKey);
      results.push(...picked.map(({ dedupeKey, ...item }) => item));
    } catch (err) {
      console.error(`[fetchBusinessNews] "${topic.label}" failed:`, err.message);
    }
  }
  return results;
}

// One-sentence, headline-based description — not a real article summary (we never fetch the
// article body), so facts are limited to what the headline states. Written as a direct, confident
// statement (no "likely"/"probably"/"appears to") since a hedge on every line reads as unsure of
// something we're actually just restating plainly.
async function describeNewsItem(title) {
  try {
    const reply = await askOllama(
      `Rewrite this news headline as one short, direct, confident sentence in plain language, stating what the news is — ` +
        `not what it "might" or "likely" be about. Do not use hedge words like "likely," "probably," "may," "seems," or "appears." ` +
        `Do not add specific facts, numbers, or details beyond what the headline itself states. Headline: "${title}"`
    );
    return reply.replace(/\n+/g, ' ').trim();
  } catch {
    return null;
  }
}

const MAX_TASK_CHARS = 3000; // keep the explainer prompt small so the 3b model stays fast

// Expands a todo item into a plain-language "what this actually involves, what it's ultimately
// for, and how it could be approached" write-up when someone accepts it (or an accepted task's
// text changes) — the raw task text alone (sometimes a one-liner, sometimes several paragraphs
// already) isn't enough context to just start working, and the progress channel is where the
// bigger picture (end goal, relation to other in-flight work) actually belongs, not the terse
// todo-list line itself. otherTasks (other open task headers) is optional context so the model
// can call out a real connection — it's told to skip that part rather than invent one.
// Same fail-soft shape as describeNewsItem/summarizeDiff: if Ollama's down, the accept flow
// still works, it just skips this extra paragraph.
async function explainTask(taskText, otherTasks = []) {
  const truncated = taskText.length > MAX_TASK_CHARS ? `${taskText.slice(0, MAX_TASK_CHARS)}\n…(truncated)` : taskText;
  const otherTasksBlock = otherTasks.length
    ? `\n\nOther tasks currently open on the same team board (for spotting real connections only):\n${otherTasks.map((t) => `- ${t}`).join('\n')}`
    : '';
  try {
    const reply = await askOllama(
      `Write a short, practical paragraph (4-6 sentences) about this task for a progress-log channel, covering: ` +
        `what it actually involves, what the end goal / why it matters is, and roughly how it could be approached. ` +
        `Be concrete — reference specifics already in the task description rather than restating it generically. ` +
        `If the task already lists steps, summarize the overall approach and what the tricky/important part is, ` +
        `don't just repeat the steps verbatim. If (and only if) it plausibly relates to one of the other open tasks ` +
        `listed below, add one sentence naming which one and how — otherwise don't mention connections at all, don't ` +
        `force one. Task:\n\n${truncated}${otherTasksBlock}`
    );
    return reply.trim();
  } catch {
    return null;
  }
}

function formatPubDate(pubDate) {
  if (!pubDate) return null;
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Shared by news-watch.js and daily-summary.js so both render news identically.
async function formatNewsItem(item) {
  const lines = [`- [${item.title}](<${item.link}>)`];
  const description = await describeNewsItem(item.title);
  if (description) lines.push(`  ${description}`);
  const when = formatPubDate(item.pubDate);
  const meta = [when, item.source].filter(Boolean).join(' · ');
  if (meta) lines.push(`  _${meta}_`);
  return lines.join('\n');
}

module.exports = {
  OLLAMA_HOST,
  OLLAMA_MODEL,
  OPEN_BOARD_SECTIONS,
  BUSINESS_NAME,
  SECOND_BUSINESS_NAME,
  SECOND_BUSINESS_DOMAIN,
  askOllama,
  chunkText,
  replyChunks,
  sendChunks,
  shopifyQuery,
  shopifyMutate,
  netlifyApi,
  readBoard,
  postToChangelog,
  changelogAreaExists,
  listChangelogAreas,
  formatShopifyEventLine,
  shopifyEventActor,
  matchBigTicketEvent,
  draftChangelogArticle,
  fetchBusinessNews,
  formatNewsItem,
  explainTask,
};
