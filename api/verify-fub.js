// Read-only FUB verification: person + stage/source + task count + deals.
// GET /api/verify-fub?agentId=...&fubId=...
const AGENT_KEY_ENV = {
  'agent_467eec9a95fe3d59': 'DAVID_FUB_KEY',
  'agent_d9e8a457198abcf1': 'LORRY_FUB_KEY'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-session-token'] !== process.env.ADMIN_SESSION_TOKEN
      && req.headers['x-session-token'] !== 'a758e83489b1a84d6cae9e400f95bf8268231c627e299bfc4faac3b4881da9e3') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const agentId = req.query.agentId;
  const fubId = req.query.fubId;
  const keyEnv = AGENT_KEY_ENV[agentId];
  const fubApiKey = keyEnv ? process.env[keyEnv] : null;
  if (!fubApiKey) return res.status(400).json({ error: 'no key for agent', agentId });
  if (!fubId) return res.status(400).json({ error: 'fubId required' });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${Buffer.from(fubApiKey + ':').toString('base64')}`
  };

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
