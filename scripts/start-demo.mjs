// Run the app on a separate demo store, with optional local demo memories.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const root = process.cwd();
const child = spawn('npm', ['run', 'dev'], {stdio: 'inherit', env: {
  ...process.env,
  CONTEXTLENS_DB_PATH: resolve(root, 'agent/data/lens-demo-memories.sqlite3'),
  CONTEXTLENS_SEED_PATH: resolve(root, 'shared/lens-demo-seeds.json'),
}});
child.on('exit', code => process.exit(code ?? 1));
