const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { action, targetAgentId, items, itemId, note, status } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const KEY = `agent:${agentId}:review_queue`;

  try {
    if (action === 'add') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const seen = new Set(queue.map(q => (q.name||'').toLowerCase() + '|' + (q.reason||'')));
      let added = 0;
      for (const it of (items || [])) {
        const k = (it.name||'').toLowerCase() + '|' + (it.reason||'');
        if (seen.has(k)) continue;
        queue.push({
          id: 'rv' + Date.now() + Math.random().toString(36).slice(2),
          name: it.name,
          reason: it.reason || '',
          detail: it.detail || '',
          birthday: it.birthday || '',
          occupation: it.occupation || '',
          address: it.address || '',
          year: it.year || '',
          status: 'pending',
          note: '',
          addedAt: new Date().toISOString()
        });
        seen.add(k);
        added++;
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, added, total: queue.length });
    }

    if (action === 'list') {
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];

      // Auto-detect: if a pending FINTRAC item's matching contact already has the birthday,
      // mark it auto-resolved so the queue self-cleans. Requires a FUB key.
      const { fubApiKey } = req.body;
      if (fubApiKey) {
        function normDob(d) {
          if (!d) return '';
          const us = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
          return String(d).slice(0,10);
        }
        const encoded = Buffer.from(fubApiKey + ':').toString('base64');
        const NICK = {kathleen:['kat','kathy','katie'],jacquelyn:['jac','jackie','jacqui'],robert:['rob','bob','bobby'],william:['will','bill','billy'],richard:['rich','rick','dick'],michael:['mike','mick'],christopher:['chris'],matthew:['matt'],joseph:['joe','joey'],james:['jim','jimmy'],daniel:['dan','danny'],thomas:['tom','tommy'],anthony:['tony'],nicholas:['nick'],alexander:['alex','xander'],alexandros:['alex'],benjamin:['ben'],samuel:['sam'],andrew:['andy','drew'],edward:['ed','eddie','ted'],charles:['charlie','chuck'],patricia:['pat','patty','tricia'],jennifer:['jen','jenny'],elizabeth:['liz','beth','lizzie','eliza'],margaret:['maggie','meg','peggy'],katherine:['kate','katie','kathy','kat'],stephanie:['steph'],cynthia:['cindy'],deborah:['deb','debbie'],rebecca:['becca','becky'],victoria:['vicky','tori'],nicole:['nikki'],vincent:['vince'],theodore:['ted','teddy'],gregory:['greg'],jonathan:['jon','jonny'],timothy:['tim'],ronald:['ron','ronnie'],kenneth:['ken','kenny'],joshua:['josh'],nathaniel:['nate','nat'],frederick:['fred','freddie']};
        function fnMatch(a,b){a=(a||'').toLowerCase().trim();b=(b||'').toLowerCase().trim();if(!a||!b)return false;if(a===b)return true;if(a[0]===b[0]&&(a.length<=2||b.length<=2))return true;if(a.startsWith(b)||b.startsWith(a))return true;for(const[full,nicks]of Object.entries(NICK)){const set=[full,...nicks];if(set.includes(a)&&set.includes(b))return true;}return false;}
        function lnMatch(a,b){a=(a||'').toLowerCase().trim();b=(b||'').toLowerCase().trim();return a&&b&&(a===b||a.includes(b)||b.includes(a));}
        let changed = false;
        for (const item of queue) {
          if (item.status !== 'pending') continue;
          const parts = (item.name||'').trim().split(/\s+/);
          const itemFirst = parts[0]||''; const lastName = parts.slice(-1)[0]||'';
          if (!lastName) continue;
          try {
            const r = await fetch(`https://api.followupboss.com/v1/people?q=${encodeURIComponent(lastName)}&limit=15&fields=id,firstName,lastName,name,customBirthday`, {
              headers: { 'Authorization': `Basic ${encoded}` }
            });
            if (!r.ok) continue;
            const data = await r.json();
            const wantDob = item.birthday ? normDob(item.birthday) : null;
            // Tier 1: exact birthday already present
            let match = wantDob ? (data.people||[]).find(p => p.customBirthday && normDob(p.customBirthday)===wantDob) : null;
            let how = match ? 'already has this birthday' : null;
            // Tier 2: nickname/initial-safe name match (last name + first-name variant)
            if (!match) {
              match = (data.people||[]).find(p => lnMatch(p.lastName, lastName) && fnMatch(p.firstName, itemFirst));
              if (match) how = `matched contact ${match.firstName} ${match.lastName}`;
            }
            if (match) {
              item.status = 'done'; item.appliedTo = match.id; item.has_deal = true;
              item.note = (item.note ? item.note + ' | ' : '') + `Auto-resolved: ${how}`;
              changed = true;
            }
          } catch(e) { /* skip on error */ }
        }
        if (changed) await redis.set(KEY, JSON.stringify(queue));
      }

      return res.status(200).json({ success: true, items: queue });
    }

    if (action === 'update') {
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const item = queue.find(q => q.id === itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      if (note !== undefined) item.note = note;
      if (status !== undefined) item.status = status;
      item.updatedAt = new Date().toISOString();
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true });
    }

    if (action === 'apply') {
      // Apply this review item's FINTRAC data to a specified existing FUB contact
      const { fubApiKey, fubContactId, itemId: applyId } = req.body;
      if (!fubApiKey || !fubContactId) return res.status(400).json({ error: 'fubApiKey and fubContactId required' });

      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const item = queue.find(q => q.id === applyId);
      if (!item) return res.status(404).json({ error: 'Review item not found' });

      // Normalize birthday to YYYY-MM-DD
      let dob = item.birthday || '';
      const us = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (us) dob = `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;

      const encoded = Buffer.from(fubApiKey + ':').toString('base64');
      const payload = {};
      if (dob) payload.customBirthday = dob;
      const r = await fetch(`https://api.followupboss.com/v1/people/${fubContactId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const errBody = await r.text();
        return res.status(500).json({ error: 'FUB update failed: ' + errBody.slice(0,150) });
      }
      item.status = 'done';
      item.appliedTo = fubContactId;
      item.note = (item.note ? item.note + ' | ' : '') + `Applied FINTRAC (DOB ${dob}) to contact ${fubContactId}`;
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, applied: { contactId: fubContactId, birthday: dob } });
    }

    if (action === 'clear') {
      await redis.del(KEY);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
