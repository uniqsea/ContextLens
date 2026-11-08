// Run each development session in its own process group so stopping it also
// reaches workers whose immediate parent has already exited.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const demo = process.argv.includes('--demo');
const child = spawn(process.execPath, [
  resolve('node_modules/concurrently/dist/bin/concurrently.js'),
  '--kill-others', '--names', 'agent,frontend', '--prefix-colors', 'cyan,magenta',
  'npm run dev:agent', 'npm run dev:frontend',
], {
  stdio: 'inherit',
  detached: true,
  env: demo ? {
    ...process.env,
    CONTEXTLENS_DB_PATH: resolve('agent/data/lens-demo-memories.sqlite3'),
  } : process.env,
});

function signalGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => signalGroup(signal));
}
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  signalGroup('SIGTERM');
  process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
});
