const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// Map transaction_type values to agent side
function getSide(type) {
  const t = (type || '').toLowerCase().trim();
  if (t.includes('buy') || t.includes('tenant') || t === 'b') return 'buyer';
  if (t.includes('sell') || t.includes('list') || t.includes('landlord') || t === 'c') return 'seller';
  if (t.includes('rent') || t === 'r') return 'buyer'; // tenant side
  if (t.includes('referral') || t === 'h') return 'referral';
  if (t.includes('double') || t.includes('both') || t === 'a' || t === 'd') return 'both';
  return 'buyer'; // default
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function parseLine(line) {
  const cols = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += line[i]; }
  }
  cols.push(cur.trim());
  return cols.map(c => c.replace(/^"|"$/g, '').trim());
}

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const trades = [];

  for (let i = 1; i < lines.length; i++) {
    // Parse CSV line handling quoted fields
    const cols = [];
    let cur = '', inQ = false;
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '"') { inQ = !inQ; }
      else if (line[j] === ',' && !inQ) { cols.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
      else { cur += line[j]; }
    }
    cols.push(cur.trim().replace(/^"|"$/g, ''));

    // Positional mapping — exactly as described:
    // 0=address, 1=buyer_name, 2=seller_name, 3=closing_date, 4=sale_price, 5=transaction_type
    const address      = (cols[0] || '').trim();
    const buyer_name   = (cols[1] || '').trim();
    const seller_name  = (cols[2] || '').trim();
    const close_date   = parseDate((cols[3] || '').trim());
    const sale_price   = (cols[4] || '').trim();
    const type_raw     = (cols[5] || '').trim();
    const side         = getSide(type_raw);

    if (!address) continue;

    if (side === 'both') {
      // Double-ended: two records
      trades.push({ property_address: address, client_name: buyer_name, agent_side: 'buyer', transaction_type: type_raw, close_date, sale_price, buyer_name, seller_name, double_ended: true, source: 'csv_import' });
      trades.push({ property_address: address, client_name: seller_name, agent_side: 'seller', transaction_type: type_raw, close_date, sale_price, buyer_name, seller_name, double_ended: true, source: 'csv_import' });
    } else {
      const client_name = side === 'seller' ? seller_name : buyer_name;
      trades.push({ property_address: address, client_name, agent_side: side, transaction_type: type_raw, close_date, sale_price, buyer_name, seller_name, double_ended: false, source: 'csv_import' });
    }
  }

  return trades;
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
    // Debug mode
    if (req.body.debug) {
      const lines = csvText.trim().split('\n').filter(l => l.trim());
      const rawHeaders = lines[0];
      const firstRow = lines[1] || '';
      const trades_preview = parseCSV(csvText).slice(0, 3);
      return res.status(200).json({ debug: true, rawHeaders, firstRow, trades_preview });
    }

    const trades = parseCSV(csvText);
    if (!trades.length) return res.status(400).json({ error: 'No valid rows found in CSV' });

    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const saved = [];

    for (const trade of trades) {
      const tradeId = `trade:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const tradeData = { ...trade, savedAt: new Date().toISOString(), agentId };
      await redis.set(tradeId, JSON.stringify(tradeData));
      await redis.lpush(`agent:${agentId}:trades`, tradeId);
      saved.push({
        tradeId,
        address:     trade.property_address,
        client:      trade.client_name,
        side:        trade.agent_side,
        close_date:  trade.close_date,
        double_ended: trade.double_ended,
      });
    }

    await redis.ltrim(`agent:${agentId}:trades`, 0, 999);

    const doubleEnded = trades.filter(t => t.double_ended).length / 2;

    return res.status(200).json({
      success:      true,
      imported:     saved.length,
      double_ended: doubleEnded,
      message:      `${saved.length} trade records created (${doubleEnded} double-ended deals split into 2 each)`,
      trades:       saved
    });

  } catch (e) {
    console.error('import-trades-csv error:', e);
    return res.status(500).json({ error: e.message });
  }
};
