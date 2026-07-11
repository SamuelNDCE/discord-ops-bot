# discord-ops-bot

A Discord "ops hub" bot for a small e-commerce/dev business: Shopify order/launch/stats watchers, Meta (Facebook/Instagram) ads monitoring and auto-posting, Netlify deploy tracking, a shared reaction-based team todo list, email support-thread bridging, reminders, and a local-LLM (Ollama) `/ask` command.

Everything business-specific (store name, domain, Facebook Page/Instagram IDs, Discord channel/role IDs, contact email) is read from environment variables — see `.env.example`. Nothing in this repo is wired to a real account; fill in your own.

## Features

- **Shopify:** `/stats`, `/activity`, `/launch-status`, order-watch, launch-watch, store-audit-watch (daily quality audit: margin drift, catalog sync gaps, mismatched description/variant text), auto-drafted "what's new" blog posts.
- **Meta ads:** `/adsnow`, `/adsweek`, `/adstats`, `/adsnowadvanced` (breakdown by age/gender), `/adactivate`, auto-pause on bad-performance thresholds (configurable min spend/impressions/CTR), auto-post new products to Facebook/Instagram with a watermark.
- **Netlify:** `/deploys`, deploy-change notifications.
- **Team todo list:** reaction-based (🙋 start / ✅ done / ❌ remove), plus `/todo add|list|accept|remove|edit|myprogress`, per-user progress channels each person registers themselves.
- **Support:** IMAP-based support-email watcher (tags/summarizes incoming mail, posts to Discord), Discord-to-email reply bridge, `/email` to send from the support inbox, contact-form-submission watcher (Netlify Forms).
- **Misc:** `/remind` / `/unremind` / `/reminders` (survive restarts), `/ping`, `/health`, `/ask` and `/search` (Ollama-backed, remembers per-user/per-channel context), `/log` (post to any changelog channel), daily summary post (tasks, store status, deploy status, tech news, business news), self-restart supervisor with crash-history tracking.

## Project structure

```
index.js                 Bot entrypoint — wires up all slash commands + background watchers
commands/                 One file per slash command (discord.js SlashCommandBuilder)
lib.js                    Shared helpers: Shopify/Netlify API calls, Ollama, changelog posting, business news
mailer.js                 Nodemailer wrapper (Gmail SMTP)
*-watch.js                Background pollers (order-watch, launch-watch, meta-ads-watch, netlify-watch, ...)
todo-store.js             Reaction-based todo list state machine
queries/*.graphql         Shopify Admin API GraphQL queries
run.js                    Auto-restart supervisor (spawns index.js, tracks crash history)
```

## Setup

1. **Create a Discord bot:** [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot tab → copy the token (`DISCORD_TOKEN`) and the Application ID (`CLIENT_ID`). Invite it to your server with the `applications.commands` + `bot` scopes and at least Send Messages/Manage Webhooks/Manage Channels permissions.
2. **Get your server's Guild ID:** enable Developer Mode in Discord (User Settings → Advanced), right-click your server icon → Copy Server ID → `GUILD_ID`.
3. `npm install`
4. `cp .env.example .env` and fill in at least `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`. Everything else is optional — see the comments in `.env.example` for what each feature needs.
5. Run the one-time setup scripts you need: `node setup-channels.js` (creates a `#changes` channel), `node setup-webhook.js`, `node setup-area-channels.js` (Shopify/Etsy changelog categories — set `SHOPIFY_CATEGORY_ID`/`ETSY_CATEGORY_ID` first), `node create-whats-new-blog.js`.
6. `node deploy-commands.js` to register slash commands with Discord.
7. `node index.js` (or `start-supervised.bat` / `node run.js` for the auto-restart supervisor, which logs restarts and backs off exponentially on crash loops).

Most features degrade gracefully if their env vars are unset — e.g. no `FB_ACCESS_TOKEN` just means the Meta-ads features stay idle, no `GMAIL_USER`/`GMAIL_APP_PASSWORD` disables email sending. Discord channel/role/category IDs referenced in `.env.example` are obtained the same way as `GUILD_ID`: Developer Mode on, right-click → Copy ID.

**Multiple people using this bot?** See `SECOND-USER-SETUP.md` for wiring up per-person AI-activity channels and shared todo-list access.

## Part of a larger collection

This repo is one piece of a set of tools published together — see [toolkit](https://github.com/SamuelNDCE/toolkit) for the full index.

## License

MIT — see [LICENSE](LICENSE).
