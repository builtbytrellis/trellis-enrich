const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// Class code → agent side + transaction type
const CLASS_MAP = {
  'A': { side: 'both',     type: 'sale',   label: 'Office Double-Ended' },
  'B': { side: 'buyer',    type: 'sale',   label: 'Buyer Side' },
  'C': { side: 'seller',   type: 'sale',   label: 'Seller Side' },
  'D': { side: 'both',     type: 'sale',   label: 'Agent Double-Ended' },
  'H': { side: 'referral', type: 'referral', label: 'Referral' },
  'R': { side: 'buyer',    type: 'lease',  label: 'Rental' },
};

function parseDate(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  function parseLine(line) {
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; }
      else if (line[i] === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += line[i]; }
    }
    cols.push(cur.trim());
    return cols;
  }

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.replace(/"/g, '').trim().toLowerCase());

  // Auto-detect column indices
  function findCol(...patterns) {
    for (const p of patterns) {
      const idx = headers.findIndex(h => h.includes(p));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  const cols = {
    address:      findCol('address', 'property', 'trade addr'),
    offer_date:   findCol('offer date', 'offer'),
    close_date:   findCol('close date', 'closing', 'close'),
    class:        findCol('class', 'classification', 'type'),
    buyer_addr:   findCol('buyer address', 'buyer addr', 'buyer'),
    seller_addr:  findCol('seller address', 'seller addr', 'seller'),
    sides:        findCol('sides'),
    type:         findCol('type'),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const c = parseLine(line);
    const get = (idx) => idx >= 0 ? (c[idx] || '').replace(/"/g, '').trim() : '';

    const classCode = get(cols.class).toUpperCase();
    const classInfo = CLASS_MAP[classCode] || { side: 'buyer', type: 'sale', label: classCode };

    rows.push({
      property_address: get(cols.address),
      offer_date:       parseDate(get(cols.offer_date)),
      close_date:       parseDate(get(cols.close_date)),
      agent_side:       classInfo.side,
      transaction_type: classInfo.type,
      class_code:       classCode,
      class_label:      classInfo.label,
      buyer_address:    get(cols.buyer_addr),
      seller_address:   get(cols.seller_addr),
      sides:            get(cols.sides),
      source:           'csv_import',
    });
  }

  return rows.filter(r => r.property_address);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { csvText, targetAgentId } = req.body;
  if (!csvText) return res.status(400).json({ error: 'csvText required' });

  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const trades = parseCSV(csvText);
    if (!trades.length) return res.status(400).json({ error: 'No valid rows found in CSV' });

    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const saved = [];

    for (const trade of trades) {
      const tradeId = `trade:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const tradeData = { ...trade, savedAt: new Date().toISOString(), agentId };
      await redis.set(tradeId, JSON.stringify(tradeData));
      await redis.lpush(`agent:${agentId}:trades`, tradeId);
      saved.push({ tradeId, address: trade.property_address, side: trade.agent_side, close_date: trade.close_date });
    }

    await redis.ltrim(`agent:${agentId}:trades`, 0, 999);

    return res.status(200).json({
      success: true,
      imported: saved.length,
      skipped: 0,
      trades: saved
    });

  } catch (e) {
    console.error('import-trades-csv error:', e);
    return res.status(500).json({ error: e.message });
  }
};
