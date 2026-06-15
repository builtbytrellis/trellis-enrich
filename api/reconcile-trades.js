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

    // Parse master CSV — supports the full 13-column format:
    // Year, Name, Address, Neighbourhood, Price, Closing Date, MLS #, Lorry Represented,
    // Deal Type, District, FSA, Notes, Source File
    // One row PER CLIENT. Multiple rows can share one deal (same MLS/address+date).
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    const header = parseLine(lines[0]).map(h => h.toLowerCase().trim());

    function colIdx(...names) {
      for (const n of names) {
        const i = header.findIndex(h => h.includes(n));
        if (i >= 0) return i;
      }
      return -1;
    }
    const idx = {
      year:    colIdx('year'),
      name:    colIdx('name'),
      address: colIdx('address'),
      hood:    colIdx('neighbourhood','neighborhood'),
      price:   colIdx('price'),
      close:   colIdx('closing','close date'),
      mls:     colIdx('mls'),
      rep:     colIdx('represent'),
      deal:    colIdx('deal type'),
      fsa:     colIdx('fsa'),
    };

    // Each row = one client tied to a deal
    const masterRows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = parseLine(lines[i]);
      const get = (j) => j >= 0 ? (c[j] || '').trim() : '';
      const name = get(idx.name);
      const address = get(idx.address);
      if (!name && !address) continue;

      const rep = get(idx.rep).toLowerCase();
      const dealType = get(idx.deal).toLowerCase();
      const isLease = dealType.includes('lease') || rep.includes('tenant') || rep.includes('landlord');

      let side = 'buyer';
      if (rep.includes('seller')) side = 'seller';
      else if (rep.includes('landlord')) side = 'landlord';
      else if (rep.includes('tenant')) side = 'tenant';
      else if (rep.includes('buyer')) side = 'buyer';

      masterRows.push({
        year: get(idx.year),
        client_name: name,
        property_address: address,
        neighbourhood: get(idx.hood),
        sale_price: get(idx.price),
        close_date: parseDate(get(idx.close)),
        mls: get(idx.mls),
        represented: rep,
        agent_side: side,
        deal_type: isLease ? 'lease' : 'purchase',
        fsa: get(idx.fsa),
        // Deal-level key: prefer MLS, fall back to address+date
        deal_key: (get(idx.mls) && get(idx.mls).toUpperCase() !== 'EXCLUSIVE')
          ? `mls:${get(idx.mls).toUpperCase()}`
          : `addr:${normAddr(address)}|${parseDate(get(idx.close))||''}`,
      });
    }

    // Group rows into unique DEALS (multiple clients per deal)
    const masterDeals = new Map();
    for (const r of masterRows) {
      if (!masterDeals.has(r.deal_key)) {
        masterDeals.set(r.deal_key, { ...r, clients: [r.client_name] });
      } else {
        masterDeals.get(r.deal_key).clients.push(r.client_name);
      }
    }

    // Load existing trades in Redis
    const tradeIds = await redis.lrange(`agent:${agentId}:trades`, 0, -1);
    const tradeRaws = tradeIds.length ? await Promise.all(tradeIds.map(id => redis.get(id))) : [];
    const existingTrades = tradeRaws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Load contacts
    const contactIds = await redis.lrange(`agent:${agentId}:contacts`, 0, -1);
    const contactRaws = contactIds.length ? await Promise.all(contactIds.map(id => redis.get(id))) : [];
    const contacts = contactRaws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Build existing-deal keys from Redis (MLS or address+date)
    const existingKeys = new Set();
    for (const t of existingTrades) {
      if (t.mls && String(t.mls).toUpperCase() !== 'EXCLUSIVE') existingKeys.add(`mls:${String(t.mls).toUpperCase()}`);
      existingKeys.add(`addr:${normAddr(t.property_address)}|${t.close_date||''}`);
    }

    // Which unique DEALS are missing from the system
    const missingDeals = [];
    const presentDeals = [];
    for (const [key, deal] of masterDeals) {
      const altKey = `addr:${normAddr(deal.property_address)}|${deal.close_date||''}`;
      if (existingKeys.has(key) || existingKeys.has(altKey)) presentDeals.push(deal);
      else missingDeals.push(deal);
    }

    // Which CLIENTS (rows) have no contact in the system (fuzzy match)
    const clientsWithNoContact = [];
    for (const r of masterRows) {
      const hasContact = contacts.some(c => nameMatchFuzzy(r.client_name, c.full_name||c.name));
      if (!hasContact) {
        clientsWithNoContact.push({ name: r.client_name, address: r.property_address, year: r.year });
      }
    }

    let imported = 0;
    if (autoFix && missingDeals.length) {
      // Import each CLIENT row belonging to a missing deal
      const missingKeys = new Set(missingDeals.map(d => d.deal_key));
      for (const r of masterRows) {
        if (!missingKeys.has(r.deal_key)) continue;
        const isBuyerSide = r.agent_side === 'buyer' || r.agent_side === 'tenant';
        const tid = `trade:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        await redis.set(tid, JSON.stringify({
          property_address: r.property_address,
          buyer_or_tenant_name: isBuyerSide ? r.client_name : '',
          seller_or_landlord_name: !isBuyerSide ? r.client_name : '',
          client_name: r.client_name,
          agent_side: r.agent_side,
          deal_type: r.deal_type,
          close_date: r.close_date,
          sale_price: r.sale_price,
          neighbourhood: r.neighbourhood,
          mls: r.mls,
          year: r.year || (r.close_date ? r.close_date.slice(0,4) : ''),
          fsa: r.fsa,
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
      master_client_rows: masterRows.length,
      master_unique_deals: masterDeals.size,
      deals_already_in_system: presentDeals.length,
      deals_missing: missingDeals.length,
      missing_list: missingDeals.slice(0, 100).map(d => ({
        address: d.property_address,
        clients: d.clients.join(' + '),
        close_date: d.close_date,
        price: d.sale_price,
        type: d.deal_type
      })),
      clients_with_no_contact: clientsWithNoContact.length,
      no_contact_list: clientsWithNoContact.slice(0, 100),
      imported: imported,
      autoFix: !!autoFix
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
