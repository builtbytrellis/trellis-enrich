const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const fetch = require('node-fetch');

function calcAgeTag(birthday) {
  try {
    const bDate = new Date(birthday);
    if (isNaN(bDate)) return null;
    const now = new Date();
    const age = now.getFullYear() - bDate.getFullYear() -
      (now < new Date(now.getFullYear(), bDate.getMonth(), bDate.getDate()) ? 1 : 0);
    if (age < 20) return null;
    if (age < 30) return 'Age: 20s';
    if (age < 40) return 'Age: 30s';
    if (age < 50) return 'Age: 40s';
    if (age < 60) return 'Age: 50s';
    return 'Age: 60+';
  } catch(e) { return null; }
}

async function updateFubTags(fubId, correctAgeTag, headers) {
  try {
    const res = await fetch(`https://api.followupboss.com/v1/people/${fubId}`, { method: 'GET', headers });
    if (!res.ok) return 'fub_fetch_failed';
    const person = await res.json();
    const existingTags = (person.tags || []).map(t => typeof t === 'string' ? t : (t.name || ''));
    const withoutAge = existingTags.filter(t => !t.startsWith('Age:'));
    const newTags = [...withoutAge, correctAgeTag];
    const updateRes = await fetch(`https://api.followupboss.com/v1/people/${fubId}`, {
      method: 'PUT', headers, body: JSON.stringify({ tags: newTags })
    });
    return updateRes.ok ? 'updated' : 'fub_update_failed';
  } catch(e) { return 'error'; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { fubApiKey, agentId: targetAgentId, dryRun } = req.body;
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  if (!fubApiKey) return res.status(400).json({ error: 'FUB API key required' });

  const encoded = Buffer.from(fubApiKey + ':').toString('base64');
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${encoded}` };

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    if (!ids?.length) return res.status(200).json({ fixed: 0, total: 0 });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const fixed = [];

    for (let i = 0; i < ids.length; i++) {
      const raw = raws[i]; if (!raw) continue;
      let c;
      try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { continue; }
      if (!c || !c.birthday) continue;

      const correctTag = calcAgeTag(c.birthday);
      if (!correctTag) continue;

      const currentAgeTags = (c.suggested_tags || []).filter(t => t.tag.startsWith('Age:')).map(t => t.tag);
      const currentApprovedAge = (c.approved_tags || []).filter(t => t.startsWith('Age:'));
      const alreadyCorrect = currentAgeTags.includes(correctTag) && currentApprovedAge.includes(correctTag);
      if (alreadyCorrect) continue;

      const wrongTags = currentAgeTags.filter(t => t !== correctTag);
      fixed.push({
        name: c.full_name || c.name,
        birthday: c.birthday,
        wrong: wrongTags.join(', ') || 'none',
        correct: correctTag,
        fubId: c.fub_data?.fub_id
      });

      if (!dryRun) {
        // Fix in Redis
        const updatedSuggested = (c.suggested_tags || []).filter(t => !t.tag.startsWith('Age:'));
        updatedSuggested.push({ tag: correctTag, confidence: 'high', reason: `Calculated from birthday ${c.birthday}` });
        const updatedApproved = (c.approved_tags || []).filter(t => !t.startsWith('Age:'));
        updatedApproved.push(correctTag);
        await redis.set(ids[i], JSON.stringify({ ...c, suggested_tags: updatedSuggested, approved_tags: updatedApproved }));

        // Fix in FUB
        if (c.fub_data?.fub_id) {
          await updateFubTags(c.fub_data.fub_id, correctTag, headers);
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    return res.status(200).json({ success: true, dryRun: dryRun || false, fixed: fixed.length, details: fixed });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
