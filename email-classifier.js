const { askOllama } = require('./lib');

const CATEGORIES = ['Support', 'Partnership', 'Other'];
const MAX_SNIPPET_LEN = 800; // keep the classification prompt small and fast

const ICONS = { Support: '🎧', Partnership: '🤝', Other: '📨' };

// Ambiguous or unclassifiable defaults to Support, not Other — a missed real support request is
// worse than an occasional over-ping for a partnership pitch.
const DEFAULT_CATEGORY = 'Support';

async function classifyEmail(subject, bodyText) {
  const snippet = (bodyText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_LEN);
  try {
    const reply = await askOllama(
      `Classify this email into exactly one category:\n` +
        `- Support: a customer needs help with an order, product, refund, shipping, or account issue.\n` +
        `- Partnership: a business collaboration, affiliate, wholesale, influencer, or sponsorship pitch.\n` +
        `- Other: anything else, including spam, press, or unclear intent.\n\n` +
        `Reply with ONLY the single category word (Support, Partnership, or Other), nothing else.\n\n` +
        `Subject: ${subject}\n\nBody: ${snippet}`
    );
    const match = CATEGORIES.find((c) => reply.toLowerCase().includes(c.toLowerCase()));
    return match || DEFAULT_CATEGORY;
  } catch {
    return DEFAULT_CATEGORY; // Ollama unreachable — fail toward the safer default, not silence
  }
}

function iconFor(category) {
  return ICONS[category] || ICONS[DEFAULT_CATEGORY];
}

// Returns null on failure rather than throwing — a missing summary should never block the
// email itself from posting, the full body is already shown regardless.
async function summarizeEmail(subject, bodyText) {
  const snippet = (bodyText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_LEN);
  if (!snippet) return null;
  try {
    const reply = await askOllama(
      `Summarise this email in one short sentence (under 25 words) for someone triaging support ` +
        `inbox at a glance. State what the sender actually wants/needs, not generic filler like ` +
        `"this email is about...". Reply with ONLY the summary sentence, nothing else.\n\n` +
        `Subject: ${subject}\n\nBody: ${snippet}`
    );
    const summary = reply.replace(/\s+/g, ' ').trim();
    return summary || null;
  } catch {
    return null; // Ollama unreachable — skip the summary, not the whole email post
  }
}

module.exports = { classifyEmail, summarizeEmail, iconFor, CATEGORIES, DEFAULT_CATEGORY };
