const { SlashCommandBuilder } = require('discord.js');
const { askOllama, replyChunks } = require('../lib');

const strip = (s) => s.replace(/<[^>]+>/g, '').trim();
const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const realUrl = (href) => {
  const match = href.match(/[?&]uddg=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : href;
};

async function webSearch(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  // DuckDuckGo returns 202 (not a real results page) when it's rate-limiting/challenging this IP.
  // Only 200 is an actual results page — treat anything else as "search unavailable", not "no results".
  if (res.status !== 200) throw new Error(`Web search is being rate-limited right now (status ${res.status}) — try again in a minute.`);
  const html = await res.text();

  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const results = [];
  let match;
  while ((match = re.exec(html)) && results.length < 5) {
    results.push({
      url: realUrl(match[1]),
      title: decodeEntities(strip(match[2])),
      snippet: decodeEntities(strip(match[3])),
    });
  }
  return results;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Ask the AI something that needs a live web lookup')
    .addStringOption((option) =>
      option.setName('prompt').setDescription('What do you want to know?').setRequired(true)
    ),
  async execute(interaction) {
    await interaction.deferReply();
    const prompt = interaction.options.getString('prompt', true);

    try {
      const results = await webSearch(prompt);
      const context = results.length
        ? results.map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet} (${r.url})`).join('\n')
        : 'No results found.';

      const text = await askOllama(
        `Web search results for "${prompt}":\n${context}\n\nUsing those results, answer: ${prompt}\nCite sources like [1], [2]. If the results don't answer it, say so.`
      );
      await replyChunks(interaction, text);
    } catch (err) {
      await interaction.editReply(err.message);
    }
  },
};
