const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

function normName(n) { return (n||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function nameMatch(a, b) {
  const ta = normName(a).split(' ').filter(t=>t.length>=2);
  const tb = normName(b).split(' ').filter(t=>t.length>=2);
  return ta.length && tb.length && ta[0]===tb[0] && ta[ta.length-1]===tb[tb.length-1];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { targetAgentId } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Load all contacts
    const contactIds = await redis.lrange(`agent:${agentId}:contacts`, 0, -1);
    const contactRaws = contactIds.length ? await Promise.all(contactIds.map(id => redis.get(id))) : [];
    const contacts = contactRaws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Load all trades
    const tradeIds = await redis.lrange(`agent:${agentId}:trades`, 0, -1);
    const tradeRaws = tradeIds.length ? await Promise.all(tradeIds.map(id => redis.get(id))) : [];
    const trades = tradeRaws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // FINTRAC stats
    const fintracVerified = contacts.filter(c => c.fintrac_verified);
    const withBirthday = contacts.filter(c => c.birthday);
    const withJob = contacts.filter(c => c.job_title);

    // Trades without a matching contact
    const tradesNoContact = [];
    for (const t of trades) {
      const names = [t.buyer_or_tenant_name, t.seller_or_landlord_name, t.client_name].filter(Boolean);
      const matched = contacts.some(c => names.some(n => nameMatch(n, c.full_name || c.name)));
      if (!matched) tradesNoContact.push({ address: t.property_address, client: t.client_name || t.buyer_or_tenant_name || t.seller_or_landlord_name, close_date: t.close_date });
    }

    // Contacts with trade history attached vs not
    const contactsWithTrades = contacts.filter(c => (c.trade_history || []).length > 0);

    // Past Client tagged contacts with no trade record (likely missing APS/trade upload)
    const pastClientsNoTrade = contacts.filter(c => {
      const tags = (c.suggested_tags || []).map(t => typeof t === 'string' ? t : t.tag);
      const isPast = tags.includes('Past Client');
      return isPast && !(c.trade_history || []).length;
    }).map(c => c.full_name || c.name);

    // Contacts with trades but no FINTRAC (missing FINTRAC upload)
    const tradesNoFintrac = contactsWithTrades
      .filter(c => !c.fintrac_verified)
      .map(c => c.full_name || c.name);

    // Duplicate trade detection (same address + same close date)
    const seen = new Map();
    const dupes = [];
    for (const t of trades) {
      const key = `${normName(t.property_address)}|${t.close_date}|${t.agent_side||''}`;
      if (seen.has(key)) dupes.push(t.property_address);
      else seen.set(key, true);
    }

    return res.status(200).json({
      agentId,
      summary: {
        contacts: contacts.length,
        trades: trades.length,
        duplicate_trades: dupes.length,
        fintrac_verified_contacts: fintracVerified.length,
        contacts_with_birthday: withBirthday.length,
        contacts_with_job_title: withJob.length,
        contacts_with_trade_history: contactsWithTrades.length,
      },
      gaps: {
        trades_without_contact_match: tradesNoContact.length,
        trades_without_contact_list: tradesNoContact.slice(0, 50),
        past_clients_missing_trade_record: pastClientsNoTrade.length,
        past_clients_missing_trade_list: pastClientsNoTrade.slice(0, 50),
        trade_clients_missing_fintrac: tradesNoFintrac.length,
        trade_clients_missing_fintrac_list: tradesNoFintrac.slice(0, 50),
      }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
