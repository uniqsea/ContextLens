// Run the app on the bundled demo memories instead of the personal store.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const root = process.cwd();
const child = spawn('npm', ['run', 'dev'], {stdio: 'inherit', env: {
  ...process.env,
  CONTEXTLENS_DB_PATH: resolve(root, 'agent/data/lens-demo-memories.sqlite3'),
  CONTEXTLENS_SEED_PATH: resolve(root, 'shared/lens-demo-seeds.json'),
}});
child.on('exit', code => process.exit(code ?? 1));
