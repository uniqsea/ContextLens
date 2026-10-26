"""Shared deterministic retrieval baseline; no embeddings or model judge."""
import re

def terms(text):
    words = set(re.findall(r'[a-z0-9]+', text.lower()))
    for run in re.findall(r'[\u4e00-\u9fff]+', text):
        words.update(run[i:i+2] for i in range(max(1, len(run)-1)))
    return words

def select_memories(records, query, mode, strategy='controlled', manual=(), ignored=(), limit=4, budget=4000):
    """Same ranker and character budget across strategies. Blocks always apply."""
    query_terms=terms(query)
    candidates=[]
    for r in records:
        if r['lifecycle_state']!='active' or mode in r['blocked_context_modes']:continue
        if strategy!='relevance' and r['context_scope'] not in (mode,'general'):
            if strategy!='controlled' or r['id'] not in manual:continue
        if strategy=='controlled' and r['id'] in ignored:continue
        score=len(query_terms & terms(r['title']+' '+r['content']))
        candidates.append((int(strategy=='controlled' and r['id'] in manual),score,r))
    candidates.sort(key=lambda x:(-x[0],-x[1],x[2]['id']))
    selected=[];used=0
    for _,_,r in candidates:
        size=len(r['title'])+len(r['content'])
        if len(selected)<limit and used+size<=budget:
            selected.append(r['id']);used+=size
    return selected
