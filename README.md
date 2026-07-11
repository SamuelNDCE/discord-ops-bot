# sam-discord-ops-bot

A Discord "ops hub" bot for a small e-commerce/dev business: Shopify order/launch/stats watchers, Meta (Facebook/Instagram) ads monitoring and auto-posting, Netlify deploy tracking, a shared reaction-based team todo list, email support-thread bridging, reminders, and a local-LLM (Ollama) `/ask` command.

Everything business-specific (store name, domain, Facebook Page/Instagram IDs, Discord channel/role IDs, contact email) is read from environment variables — see `.env.example`. Nothing in this repo is wired to a real account; fill in your own.

## Features

- **Shopify:** `/stats`, `/activity`, `/launch-status`, order-watch, launch-watch, store-audit-watch (daily quality audit), auto-drafted "what's new" blog posts.
- **Meta ads:** `/adsnow`, `/adsweek`, `/adstats`, `/adsnowadvanced`, `/adactivate`, auto-pause on bad-performance thresholds, auto-post new products to Facebook/Instagram with a watermark.
- **Netlify:** `/deploys`, deploy-change notifications.
- **Team todo list:** reaction-based (🙋 start / ✅ done / ❌ remove), per-user progress channels.
- **Support:** IMAP-based support-email watcher, Discord-to-email reply bridge, `/email` to send from the support inbox.
- **Misc:** `/remind`, `/ping`, `/health`, `/ask` and `/search` (Ollama-backed), daily summary post, self-restart supervisor.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in at least `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.
3. `node deploy-commands.js` to register slash commands.
4. `node index.js` (or `start-supervised.bat` / `node run.js` for the auto-restart supervisor).

Most features degrade gracefully if their env vars are unset (e.g. no `FB_ACCESS_TOKEN` just means the Meta-ads features stay idle).

## Part of a larger collection

This repo is one piece of a set of tools published together — see [sam-toolkit](https://github.com/SamuelNDCE/sam-toolkit) for the full index.

## License

MIT — see [LICENSE](LICENSE).
