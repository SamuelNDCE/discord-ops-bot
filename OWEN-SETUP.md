# Setup for Owen's Claude sessions

There's now a `#owens-claude-progress` channel in the Discord server — an activity log of what
your Claude Code sessions actually did, separate from your personal `#owens-progress` (which
tracks todo-list tasks you've claimed as a human).

To make your own Claude sessions post there, add this to your own `~/.claude/CLAUDE.md` (this
can't be done from Samuel's machine — it has to live in your own global instructions):

```markdown
## AI activity log (Discord)
Whenever I finish a meaningful piece of work (a feature shipped, a bug fixed, a real chunk of a
task done — not every single turn), post a one-line summary to my AI activity channel:
​```bash
node "<path-to-this-repo>\discord-bot\post-progress.js" "what I did" --owner owens
​```
```

Requirements:
- You need a local clone of this `discord-bot/` folder (or network access to Samuel's copy) plus
  its `.env` (`DISCORD_TOKEN`, `GUILD_ID`) — ask Samuel for these, they're not committed to git.
- Swap `<path-to-this-repo>` for wherever that folder actually lives on your machine.
- `--owner owens` is required — the script won't post anywhere without a valid `--owner`.

Same shared todo list applies to you too: `add-todo.js` / `edit-todo.js` in the same folder, see
the main `CLAUDE.md`'s "Shared team todo list" section (or ask Samuel for the relevant excerpt).
