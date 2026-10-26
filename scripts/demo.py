"""Reset only the dedicated synthetic demo database; never the personal store."""
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'agent/data/demo.sqlite3'
if len(sys.argv)>1 and sys.argv[1]!='reset':raise SystemExit('Usage: python scripts/demo.py [reset]')
os.environ['CONTEXTLENS_DB_PATH']=str(DB)
os.environ['CONTEXTLENS_SEED_PATH']=str(ROOT/'shared/demo-seeds.json')
sys.path.insert(0,str(ROOT/'agent'))
records=json.loads((ROOT/'shared/demo-memories.json').read_text())
seeds=[{**r,'memory_type':'semantic','confidence':'high','source_kind':'Synthetic demo / '+r['id'],'created_at':'2026-10-07T00:00:00Z'} for r in records]
(ROOT/'shared/demo-seeds.json').write_text(json.dumps(seeds,ensure_ascii=False,indent=2)+'\n')
if DB.exists():DB.unlink()
from src.memory.repository import ensure_memory_store
ensure_memory_store()
print('Synthetic demo reset:',DB)
print('Run npm run dev:demo (mock provider) or npm run dev:demo:live (configured provider).')
