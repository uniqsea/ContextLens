import os
os.environ["LANGCHAIN_TRACING_V2"] = "false"
os.environ["LANGSMITH_TRACING"] = "false"
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from src.memory import repository as repo
from src.context_control import prepare_snapshot, memory_stamp
from src.agent import workflow

class ControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dbpatch = patch.object(repo, 'DB_PATH', Path(self.tmp.name) / 'test.sqlite3')
        self.dbpatch.start()
        repo.ensure_memory_store()
        with repo._connect() as conn:
            conn.execute('DELETE FROM memory_context_rules')
            conn.execute('DELETE FROM memories')
            for id, scope, content in [('work', 'work', 'WORK_SECRET'), ('personal','personal','PERSONAL_SECRET'), ('general','general','GENERAL_FACT')]:
                conn.execute("INSERT INTO memories(id,title,content,memory_type,confidence,context_scope,created_at,updated_at,source_kind) VALUES(?,?,?,'semantic','high',?,'now','now','test')",(id,id,content,scope))
        self.state = dict(messages=[HumanMessage(content='Help me')], session_context_mode='work')

    def tearDown(self):
        self.dbpatch.stop(); self.tmp.cleanup()

    def prepared(self,state=None):
        state = dict(state or self.state)
        items,snap=prepare_snapshot(state)
        return {**state,'context_items':items,'context_snapshot':snap}

    def test_scope_and_stable_preview(self):
        s=self.prepared(); _,snap=prepare_snapshot(s)
        self.assertEqual(snap['fingerprint'],s['context_snapshot']['fingerprint'])
        self.assertIn('work',snap['selected_ids']);self.assertNotIn('personal',snap['selected_ids'])
        self.assertNotIn('PERSONAL_SECRET',str(snap['messages']))

    def test_general_does_not_select_everything(self):
        _, snap=prepare_snapshot({**self.state,'session_context_mode':'general'})
        self.assertNotIn('work',snap['selected_ids'])

    def test_manual_add_and_block_enforcement(self):
        s={**self.state,'manual_memory_ids':['personal']}
        self.assertIn('personal',prepare_snapshot(s)[1]['selected_ids'])
        with repo._connect() as c:c.execute("INSERT INTO memory_context_rules(memory_id,context_mode,rule_type) VALUES('personal','work','block')")
        self.assertNotIn('personal',prepare_snapshot(s)[1]['selected_ids'])

    def test_request_ignore(self):
        s={**self.state,'context_policies':[{'item_id':'work','status':'temporarily_ignored'}]}
        self.assertNotIn('WORK_SECRET',str(prepare_snapshot(s)[1]['messages']))

    def test_trash_cannot_be_overridden(self):
        s=self.prepared()
        with repo._connect() as c:c.execute("UPDATE memories SET lifecycle_state='trashed' WHERE id='work'")
        self.assertNotIn('WORK_SECRET',str(prepare_snapshot(s)[1]['messages']))

    def history(self,n=1):
        work=next(r for r in repo.list_memories() if r['id']=='work')
        messages=[];lineage={}
        for i in range(n):
            messages += [HumanMessage(content=f'old question {i}'),AIMessage(content=f'WORK_SECRET answer {i}')]
            lineage[str(i)]={'mode':'work','memories':{'work':memory_stamp(work)},'history':list(range(i))}
        messages.append(HumanMessage(content='NEW_QUESTION'))
        return {**self.state,'messages':messages,'history_lineage':lineage}

    def test_legacy_history_is_not_blindly_forwarded(self):
        s=self.history();s['history_lineage']={}
        self.assertNotIn('old question',str(prepare_snapshot(s)[1]['messages']))

    def test_revision_invalidates_echo_and_history(self):
        s=self.history()
        with repo._connect() as c:c.execute("UPDATE memories SET content='NEW_FACT',revision=revision+1 WHERE id='work'")
        text=str(prepare_snapshot(s)[1]['messages'])
        self.assertNotIn('WORK_SECRET',text);self.assertIn('NEW_FACT',text)

    def test_mode_switch_invalidates_history(self):
        s={**self.history(),'session_context_mode':'personal'}
        self.assertNotIn('WORK_SECRET',str(prepare_snapshot(s)[1]['messages']))

    def test_ignored_history_invalidates_descendants(self):
        s={**self.history(3),'context_policies':[{'item_id':'st-0000','status':'temporarily_ignored'}]}
        text=str(prepare_snapshot(s)[1]['messages'])
        self.assertNotIn('old question',text)

    def test_summary_rebuilt_from_permitted_sources(self):
        s=self.history(22); _,snap=prepare_snapshot(s)
        self.assertEqual(len(snap['summary_dependencies']),16)
        s['context_policies']=[{'item_id':'work','status':'temporarily_ignored'}]
        _,new=prepare_snapshot(s)
        self.assertEqual(new['summary_dependencies'],[])
        self.assertNotIn('WORK_SECRET',str(new['messages']))

    def test_graph_reapproval_and_exact_capture(self):
        g=workflow.compile(checkpointer=InMemorySaver()); cfg={'configurable':{'thread_id':'test'}}
        with patch('src.agent.invoke_model',return_value=AIMessage(content='answer')) as model:
            g.invoke(self.state,cfg);self.assertEqual(model.call_count,0)
            # A persistent edit while paused forces another interrupt, with no call.
            with repo._connect() as c:c.execute("UPDATE memories SET content='UPDATED',revision=revision+1 WHERE id='work'")
            g.invoke(Command(resume='approved'),cfg);self.assertEqual(model.call_count,0)
            out=g.invoke(Command(resume='approved'),cfg);self.assertEqual(model.call_count,1)
            self.assertEqual([m.content for m in model.call_args.args[0]], [m['content'] for m in out['last_request']['messages']])
            self.assertEqual(out['context_policies'],[])
            self.assertEqual(out['manual_memory_ids'],[])

    def test_request_ignore_resets_on_next_turn(self):
        g=workflow.compile(checkpointer=InMemorySaver());cfg={'configurable':{'thread_id':'reset'}}
        with patch('src.agent.invoke_model',return_value=AIMessage(content='ok')):
            g.invoke(self.state,cfg)
            g.update_state(cfg,{'context_policies':[{'item_id':'work','status':'temporarily_ignored'}]})
            g.invoke(Command(resume='approved'),cfg)
            out=g.invoke(Command(resume='approved'),cfg)
            self.assertNotIn('work',out['last_request']['selected_ids'])
            out=g.invoke({'messages':[HumanMessage(content='next question')]},cfg)
            self.assertIn('work',out['context_snapshot']['selected_ids'])

if __name__=='__main__': unittest.main()
