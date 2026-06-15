const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

function normName(n) { return (n||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function normAddr(a) {
  return (a||'').toLowerCase()
    .replace(/\b(unit|ste|suite|apt|#)\b/g,'')
    .replace(/[.,]/g,'')
    .replace(/\s+/g,' ').trim();
}

const NICKNAMES = {
  'dave':'david','david':'dave','matt':'matthew','matthew':'matt','matty':'matthew',
  'jackie':'jacqueline','jacqueline':'jackie','sammy':'samuel','sam':'samuel','samuel':'sam',
  'josh':'joshua','joshua':'josh','ally':'allison','allison':'ally','alli':'allison',
  'mike':'michael','michael':'mike','zach':'zachary','zachary':'zach','gabe':'gabriel',
  'gabriel':'gabe','steph':'stephanie','stephanie':'steph','mac':'mackenzie','mackenzie':'mac',
  'dan':'daniel','daniel':'dan','danny':'daniel','nick':'nicholas','nicholas':'nick'
};
function firstNamesMatch(a, b) {
  if (a === b) return true;
  if (NICKNAMES[a] === b || NICKNAMES[b] === a) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}
function nameMatchFuzzy(a, b) {
  const ta = normName(a).split(' ').filter(t=>t.length>=2);
  const tb = normName(b).split(' ').filter(t=>t.length>=2);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length-1] !== tb[tb.length-1]) return false;
  return firstNamesMatch(ta[0], tb[0]);
}

function parseLine(line) {
  const cols = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (line[i] === ',' && !inQ) { cols.push(cur.trim().replace(/^"|"$/g,'')); cur=''; }
    else cur += line[i];
  }
  cols.push(cur.trim().replace(/^"|"$/g,''));
  return cols;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { csvText, targetAgentId, autoFix } = req.body || {};
  if (!csvText) return res.status(400).json({ error: 'csvText required' });
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Parse the master CSV (address, buyer_name, seller_name, closing_date, sale_price, transaction_type)
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    const masterTrades = [];
    for (let i = 1; i < lines.length; i++) {
      const c = parseLine(lines[i]);
      const address = c[0] || '';
      if (!address) continue;
      masterTrades.push({
        property_address: address,
        buyer_name: c[1] || '',
        seller_name: c[2] || '',
        close_date: parseDate(c[3]),
        sale_price: c[4] || '',
        transaction_type: c[5] || '',
      });
    }

    // Load existing trades in Redis
    const tradeIds = await redis.lrange(`agent:${agentId}:trades`, 0, -1);
    const tradeRaws = tradeIds.length ? await Promise.all(tradeIds.map(id => redis.get(id))) : [];
    const existingTrades = tradeRaws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Load contacts
    const contactIds = await redis.lrange(`agent:${agentId}:contacts`, 0, -1);
    const contactRaws = contactIds.length ? await Promise.all(contactIds.map(id => redis.get(id))) : [];
    const contacts = contactRaws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Find which master trades are MISSING from Redis (by address + close date)
    const existingKeys = new Set(existingTrades.map(t => `${normAddr(t.property_address)}|${t.close_date||''}`));
    const missingTrades = [];
    const presentTrades = [];
    for (const mt of masterTrades) {
      const key = `${normAddr(mt.property_address)}|${mt.close_date||''}`;
      if (existingKeys.has(key)) presentTrades.push(mt);
      else missingTrades.push(mt);
    }

    // For each master trade, check if a CONTACT exists (fuzzy match on buyer or seller)
    const tradesWithNoContact = [];
    for (const mt of masterTrades) {
      const hasContact = contacts.some(c =>
        nameMatchFuzzy(mt.buyer_name, c.full_name||c.name) ||
        nameMatchFuzzy(mt.seller_name, c.full_name||c.name)
      );
      if (!hasContact) {
        tradesWithNoContact.push({
          address: mt.property_address,
          buyer: mt.buyer_name,
          seller: mt.seller_name,
          close_date: mt.close_date
        });
      }
    }

    let imported = 0;
    if (autoFix && missingTrades.length) {
      // Import the missing trades into Redis
      for (const mt of missingTrades) {
        const type = (mt.transaction_type||'').toLowerCase();
        let side = 'buyer';
        if (type.includes('sell')||type.includes('list')||type==='c') side='seller';
        else if (type.includes('landlord')) side='landlord';
        else if (type.includes('tenant')||type.includes('rent')||type==='r') side='tenant';
        const isLease = type.includes('lease')||type.includes('rent')||type==='r';
        const client = side==='seller'||side==='landlord' ? mt.seller_name : mt.buyer_name;

        const tid = `trade:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        await redis.set(tid, JSON.stringify({
          property_address: mt.property_address,
          buyer_or_tenant_name: mt.buyer_name,
          seller_or_landlord_name: mt.seller_name,
          client_name: client,
          agent_side: side,
          deal_type: isLease ? 'lease' : 'purchase',
          close_date: mt.close_date,
          sale_price: mt.sale_price,
          source: 'reconcile_import',
          agentId,
          savedAt: new Date().toISOString()
        }));
        await redis.lpush(`agent:${agentId}:trades`, tid);
        imported++;
      }
    }

    return res.status(200).json({
      success: true,
      master_csv_total: masterTrades.length,
      already_in_system: presentTrades.length,
      missing_from_system: missingTrades.length,
      missing_list: missingTrades.slice(0, 100).map(t => ({ address: t.property_address, buyer: t.buyer_name, seller: t.seller_name, close_date: t.close_date })),
      trades_with_no_contact: tradesWithNoContact.length,
      no_contact_list: tradesWithNoContact.slice(0, 100),
      imported: imported,
      autoFix: !!autoFix
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
