import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=process.cwd();
const child=spawn('npm',['run','dev'],{stdio:'inherit',env:{...process.env,
 CONTEXTLENS_DB_PATH:resolve(root,'agent/data/demo.sqlite3'),
 CONTEXTLENS_SEED_PATH:resolve(root,'shared/demo-seeds.json'),
 CONTEXTLENS_MOCK:process.argv.includes('--live')?'0':'1',
 LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'}});
child.on('exit',code=>process.exit(code??1));
