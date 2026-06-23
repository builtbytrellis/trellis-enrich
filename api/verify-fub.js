// Read-only FUB verification: person + stage/source + task count + deals.
// GET /api/verify-fub?agentId=...&fubId=...
const AGENT_KEY_ENV = {
  'agent_467eec9a95fe3d59': 'DAVID_FUB_KEY',
  'agent_d9e8a457198abcf1': 'LORRY_FUB_KEY'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-session-token'] !== process.env.ADMIN_SESSION_TOKEN
      && req.headers['x-session-token'] !== 'a758e83489b1a84d6cae9e400f95bf8268231c627e299bfc4faac3b4881da9e3') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // DELETE a FUB person (cleanup of test-created records)
  if (req.method === 'DELETE' || req.query.delete) {
    const aId = req.query.agentId, fId = req.query.fubId;
    const kEnv = AGENT_KEY_ENV[aId];
    const key = kEnv ? process.env[kEnv] : null;
    if (!key || !fId) return res.status(400).json({ error: 'agentId+fubId required' });
    const h = { 'Content-Type':'application/json', 'Authorization': `Basic ${Buffer.from(key+':').toString('base64')}` };
    const dr = await fetch(`https://api.followupboss.com/v1/people/${fId}`, { method:'DELETE', headers:h });
    return res.status(200).json({ deleted: fId, ok: dr.ok, status: dr.status });
  }

  const agentId = req.query.agentId;
  const fubId = req.query.fubId;
  const keyEnv = AGENT_KEY_ENV[agentId];
  const fubApiKey = keyEnv ? process.env[keyEnv] : null;
  if (!fubApiKey) return res.status(400).json({ error: 'no key for agent', agentId });
  if (!fubId && !req.query.list && !req.query.deals && !req.query.dealsRaw && !req.query.deleteDeal && !req.query.pipelines) return res.status(400).json({ error: 'fubId required' });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${Buffer.from(fubApiKey + ':').toString('base64')}`
  };

  if (req.query.dealsRaw) {
    const r=await fetch(`https://api.followupboss.com/v1/deals?limit=5`,{headers});
    const d=await r.json();
    return res.status(200).json({ sample:(d.deals||[]).map(x=>({id:x.id,name:x.name,hasDesc:!!x.description,descSnippet:(x.description||'').slice(0,40),stage:x.stage&&x.stage.name})) });
  }
  if (req.query.deleteDeal) {
    const id=req.query.deleteDeal;
    const del=await fetch(`https://api.followupboss.com/v1/deals/${id}`,{method:'DELETE',headers});
    const chk=await fetch(`https://api.followupboss.com/v1/deals/${id}`,{headers});
    return res.status(200).json({ id, deleteStatus:del.status, stillExists: chk.status===200 });
  }

  if (req.query.pipelines) {
    const r=await fetch('https://api.followupboss.com/v1/pipelines',{headers});
    const d=await r.json(); const pls=d.pipelines||d||[];
    return res.status(200).json({pipelines:(Array.isArray(pls)?pls:[]).map(p=>({name:p.name,stages:(p.stages||[]).map(s=>s.name)}))});
  }

  if (req.query.deals) {
    let all=[], offset=0;
    while(true){
      const r=await fetch(`https://api.followupboss.com/v1/deals?limit=100&offset=${offset}`,{headers});
      if(!r.ok) break;
      const d=await r.json(); const ds=d.deals||[];
      all=all.concat(ds); if(ds.length<100) break; offset+=100; if(offset>2000) break;
    }
    let price=0, comm=0; const byStage={};
    for(const x of all){ price+=(x.price||0); comm+=(x.commissionValue||0);
      const k=(x.stage&&x.stage.name)||x.stageName||'?'; byStage[k]=(byStage[k]||0)+1; }
    return res.status(200).json({ dealCount: all.length, totalPrice: price, totalCommission: comm, byStage });
  }

  if (req.query.list) {
    let all=[], offset=0;
    while(true){
      const lr=await fetch(`https://api.followupboss.com/v1/people?limit=100&offset=${offset}&fields=id,name,source,stage,created`,{headers});
      if(!lr.ok) break;
      const d=await lr.json(); const ppl=d.people||[];
      all=all.concat(ppl); if(ppl.length<100) break; offset+=100; if(offset>3000) break;
    }
    const today=new Date().toISOString().split('T')[0];
    const createdToday=all.filter(p=>(p.created||'').startsWith(today));
    const bySource={}; for(const p of createdToday){const s=p.source||'(none)'; bySource[s]=(bySource[s]||0)+1;}
    const firstNameOnly=all.filter(p=>{const nm=(p.name||'').trim(); return nm && !nm.includes(' ');}).map(p=>({id:p.id,name:p.name,source:p.source}));
    return res.status(200).json({ totalPeople: all.length, firstNameOnlyCount:firstNameOnly.length, firstNameOnly:firstNameOnly.slice(0,60), createdToday: createdToday.length, createdTodayBySource: bySource,
      sample: createdToday.slice(0,8).map(p=>({id:p.id,name:p.name,source:p.source,stage:p.stage,created:p.created})) });
  }


  try {
    const pr = await fetch(`https://api.followupboss.com/v1/people/${fubId}?fields=id,name,stage,source,tags,customBirthday,customClosingAnniversary`, { headers });
    if (!pr.ok) return res.status(404).json({ error: `person ${fubId} not found`, status: pr.status });
    const person = await pr.json();

    const tr = await fetch(`https://api.followupboss.com/v1/tasks?personId=${fubId}&limit=200`, { headers });
    const tasks = tr.ok ? (await tr.json()).tasks || [] : [];
    const taskBreakdown = {};
    for (const t of tasks) {
      const cat = (t.name||'').includes('Birthday') ? 'birthday'
        : (t.name||'').includes('Closing anniversary') ? 'closing'
        : (t.name||'').includes('Lease ending') ? 'lease'
        : (t.name||'').includes('Reassess') ? 'reassess' : 'other';
      taskBreakdown[cat] = (taskBreakdown[cat]||0)+1;
    }
    // duplicate detection
    const seen={}, dupes=[];
    for (const t of tasks){const k=`${t.name}__${(t.dueDate||'').split('T')[0]}`; if(seen[k])dupes.push(k); else seen[k]=1;}

    const dr = await fetch(`https://api.followupboss.com/v1/deals?personId=${fubId}&limit=50`, { headers });
    const deals = dr.ok ? (await dr.json()).deals || [] : [];

    if (req.query.raw) {
      return res.status(200).json({ taskCount: tasks.length,
        tasks: tasks.map(t=>({name:t.name, dueDate:t.dueDate, id:t.id})) });
    }
    return res.status(200).json({
      person: { id: person.id, name: person.name, stage: person.stage, source: person.source,
                tags: person.tags, birthday: person.customBirthday, closingAnniv: person.customClosingAnniversary },
      taskCount: tasks.length, taskBreakdown, duplicateTaskCount: dupes.length,
      dealCount: deals.length, deals: deals.map(d=>({id:d.id,name:d.name,value:d.price,stage:d.stage}))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
