const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { postToChangelog } = require('./lib');

const MAX_RESTART_DELAY_MS = 30_000;
const HEALTHY_RUN_MS = 60_000;
const STATE_PATH = path.join(__dirname, 'supervisor-state.json');

let restartDelay = 1000;
let restartCount = 0;

function writeState(fields) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    // no prior state file yet
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...state, ...fields }, null, 2));
}

function start() {
  const startedAt = Date.now();
  writeState({ currentStartedAt: startedAt, restartCount });
  const child = spawn(process.execPath, ['index.js'], { stdio: 'inherit', cwd: __dirname });

  child.on('exit', (code) => {
    restartCount += 1;
    const ranMs = Date.now() - startedAt;
    console.log(`[supervisor] bot exited with code ${code} after ${Math.round(ranMs / 1000)}s`);
    let priorState = {};
    try {
      priorState = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
      // no prior state file yet
    }
    const history = Array.isArray(priorState.history) ? priorState.history : [];
    history.push({ at: Date.now(), code, ranMs });
    if (history.length > 50) history.shift(); // daily-summary only needs the last 24h of these
    writeState({ lastExitAt: Date.now(), lastExitCode: code, restartCount, history });
    postToChangelog('general', `⚠️ **[bot]** Restarted (exit code ${code}, was up ${Math.round(ranMs / 1000)}s, restart #${restartCount} this session)`);
    restartDelay = ranMs > HEALTHY_RUN_MS ? 1000 : Math.min(restartDelay * 2, MAX_RESTART_DELAY_MS);
    console.log(`[supervisor] restarting in ${restartDelay}ms`);
    setTimeout(start, restartDelay);
  });
}

start();
