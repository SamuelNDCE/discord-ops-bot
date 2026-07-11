const { SlashCommandBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { OLLAMA_HOST } = require('../lib');
const store = require('../reminders-store');

const STATE_PATH = path.join(__dirname, '..', 'supervisor-state.json');

module.exports = {
  data: new SlashCommandBuilder().setName('health').setDescription('Bot health check (uptime, Ollama, restarts)'),
  async execute(interaction) {
    await interaction.deferReply();

    const uptimeMin = Math.floor(process.uptime() / 60);

    let ollamaOk = false;
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
      ollamaOk = res.ok;
    } catch {
      ollamaOk = false;
    }

    let supervisorState = {};
    try {
      supervisorState = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
      // no supervisor state yet
    }

    const lines = [
      '**Bot health**',
      `Uptime (this process): ${uptimeMin}m`,
      `Ollama: ${ollamaOk ? '✅ reachable' : '❌ unreachable'}`,
      `Pending reminders: ${store.list().length}`,
      `Restarts this session: ${supervisorState.restartCount ?? 0}`,
      supervisorState.lastExitAt
        ? `Last restart: ${Math.round((Date.now() - supervisorState.lastExitAt) / 60_000)}m ago (exit code ${supervisorState.lastExitCode})`
        : 'No restarts yet this session.',
    ];

    await interaction.editReply(lines.join('\n'));
  },
};
