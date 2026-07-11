# Setup for a second team member's Claude sessions

If more than one person's Claude Code sessions should post to their own activity channel (e.g.
`#bob-claude-progress`), each additional person adds this to their own `~/.claude/CLAUDE.md` (this
can't be done from the bot owner's machine — it has to live in each person's own global instructions):

```markdown
## AI activity log (Discord)
Whenever I finish a meaningful piece of work (a feature shipped, a bug fixed, a real chunk of a
task done — not every single turn), post a one-line summary to my AI activity channel:
​```bash
node "<path-to-this-repo>\discord-bot\post-progress.js" "what I did" --owner bob
​```
```

Requirements:
- A local clone of this `discord-bot/` folder (or network access to the bot owner's copy) plus
  its `.env` (`DISCORD_TOKEN`, `GUILD_ID`) — ask the bot owner for these, they're not committed to git.
- Swap `<path-to-this-repo>` for wherever that folder actually lives on your machine.
- `--owner bob` must match one of the entries in `OWNERS` in `post-progress.js` — add your own name there.

Same shared todo list applies: `add-todo.js` / `edit-todo.js` in the same folder, see the main
`CLAUDE.md`'s "Shared team todo list" section (or ask the bot owner for the relevant excerpt).
