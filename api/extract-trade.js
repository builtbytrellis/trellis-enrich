const { verifySession } = require('./auth');
const fetch = require('node-fetch');

const TRADE_EXTRACTION_PROMPT = `You are extracting deal data from a real estate brokerage Trade Package / Commission Statement. Layouts differ by brokerage; do not assume any specific labels.

STEP 1 — IDENTIFY DEAL TYPE
Apply these rules IN ORDER (first one that matches wins):
  1. If the document is short (<1500 chars) AND has no Buyer/Seller/Tenant/Landlord section AND only shows commission/fees → deal_type = "lease_renewal". Renewal slips often just list "Commission, $X" then deductions then "Balance Due on Closing" with no party info.
  2. If the main monetary amount is BETWEEN $500 AND $20,000 → deal_type = "lease" (this is monthly rent; sale prices in Toronto/GTA are always ≥ $100K). Half-month or partial commission amounts (e.g. $1,337.50) appearing as the price also indicate lease (likely renewal — re-check rule 1).
  3. If "LEASE", "RENTAL", "LEASING", "Monthly Rent", "Tenant", "Landlord", "Lessee", "Lessor" appears anywhere → deal_type = "lease"
  4. If main monetary amount ≥ $100,000 → deal_type = "sale"
  5. Class / Type / Category labels — "RENTAL OR LEASING FEE" = lease, "RESIDENTIAL SALE" / "COMPETITOR'S LISTING" / "OUR LISTING" = sale
  6. Else: deal_type = "unknown"

STEP 2 — IDENTIFY AGENT SIDE (CRITICAL — easy to get wrong)

⚠️ Real-estate jargon trap: "Selling" does NOT mean "represents the seller". It means "brought the buyer" (i.e., the side that sold the property TO their buyer client). Apply these rules to the AGENT'S OWN TP — the agent earned whichever commission their TP shows as non-zero:

  CASE A — "Listing Comm. Rate" > 0% AND "Selling Comm. Rate" = 0%:
    The agent was the LISTING agent. They represented the SELLER (or LANDLORD on a lease).
    → agent_side = "seller" (sale) or "landlord" (lease)

  CASE B — "Selling Comm. Rate" > 0% AND "Listing Comm. Rate" = 0%:
    The agent was the SELLING/CO-OPERATING agent. They brought the BUYER (or TENANT on a lease).
    → agent_side = "buyer" (sale) or "tenant" (lease)
    Common misread: do NOT label this "seller" just because the column is called "Selling". The agent brought the BUYER.

  CASE C — Both > 0%:
    Double-ended. Agent represented both sides.
    → agent_side = "both"

If commission percentages are not visible, fall back to other signals:
  - "Listing Brokerage: [agent's brokerage]" with no "Co-op Brokerage" of the agent → agent_side = seller/landlord
  - "Co-operating Brokerage: [agent's brokerage]" or "Outside Brokerage: [other brokerage]" + agent's brokerage in the selling/buying position → agent_side = buyer/tenant
  - "Buyer Agent: [agent name]" / "Selling Agent: [agent name]" → agent_side = buyer/tenant (agent brought the buyer)
  - "Listing Agent: [agent name]" → agent_side = seller/landlord

Sanity check before finalizing: if the OUTSIDE BROKERAGE is on the LISTING side, then the agent must be on the BUYER side (CASE B). If the outside brokerage is on the SELLING/CO-OP side, the agent is on the LISTING side (CASE A).

STEP 3 — EXTRACT NAMES (critical rules)

CRITICAL: The agent_name is whoever earned the commission (Agents/Agent: section, often with a code like "(A) 2666 - GREENSPAN, LORRY"). This person is NEVER the buyer, seller, tenant, or landlord. Never put the agent's name in any party field. If the only candidate name is the agent, return null for that party.

Names sometimes have a single-letter side-marker prefix to STRIP:
  - "BuyerSMARCO PICCOLO" — S is selling-end marker; name is MARCO PICCOLO
  - "SellerLDIANA BATALEVICH" — L is listing-end marker; name is DIANA BATALEVICH
  - "SellerL576922 ONTARIO LTD" — L is the side marker; actual name is 576922 ONTARIO LTD

Rule: when a Buyer/Seller/Tenant/Landlord label is immediately followed by a SINGLE letter (S, L, or B) before the actual name, that letter is the side-marker — drop it.

STEP 4 — PRICES
  - Sale → "sale_price" field; "monthly_rent" stays null
  - Lease → "monthly_rent" field; "sale_price" stays null

Return ONLY valid JSON. Numbers as numbers (no dollar signs/commas). Dates as YYYY-MM-DD.

{
  "deal_type": "'sale' | 'lease' | 'lease_renewal' | 'unknown'",
  "mls_number": "string or null",
  "property_address": "street + unit (e.g. '35 Bastion Street, Unit 1920') or null",
  "property_city": "string or null",
  "property_province": "two-letter province or null",
  "property_postal": "postal code or null",
  "property_type": "'Residential' / 'Commercial' / null",
  "agent_name": "the agent who earned the commission",
  "agent_code": "string or null",
  "agent_side": "'buyer' | 'seller' | 'tenant' | 'landlord' | 'both' | null",
  "buyer_or_tenant_name": "full name (strip side-marker prefix) or null",
  "buyer_or_tenant_current_address": "their address as shown (BEFORE the move) or null",
  "seller_or_landlord_name": "full name (strip side-marker prefix) or null",
  "seller_or_landlord_current_address": "address as shown or null",
  "sale_price": "numeric or null",
  "monthly_rent": "numeric or null",
  "lease_term_months": "numeric or null",
  "deposit": "numeric or null",
  "deposit_held_by": "string or null",
  "offer_date": "YYYY-MM-DD or null",
  "firm_date": "YYYY-MM-DD or null",
  "close_date": "YYYY-MM-DD or null",
  "status": "string or null",
  "listing_commission_pct": "numeric or null",
  "selling_commission_pct": "numeric or null",
  "gross_commission": "numeric or null",
  "agent_share_pretax": "numeric or null",
  "agent_share_after_hst": "numeric or null",
  "outside_brokerage": "string or null",
  "outside_brokerage_agent": "string or null"
}
If this is not a brokerage trade package or commission statement return: {"not_trade_package": true}`;

async function extractWithAnthropic(pdfBuffer) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Add it to Vercel env vars to enable OCR of scanned PDFs.');
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const base64 = pdfBuffer.toString('base64');
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: TRADE_EXTRACTION_PROMPT }
      ]
    }]
  });

  const text = response.content?.find(b => b.type === 'text')?.text || '';
  // Claude sometimes wraps JSON in code fences — strip them.
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const json = m ? m[1] : text;
  return JSON.parse(json);
}

async function withRetry(fn, label, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      const is429 = e?.status === 429 || /429|rate limit/i.test(msg);
      if (!is429 || attempt === maxAttempts) break;
      const waitMs = 1500 * attempt;
      console.warn(`${label} 429 attempt ${attempt}, waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  try {
    const { pdfs } = req.body;
    if (!pdfs || !pdfs.length) return res.status(400).json({ error: 'No PDFs provided' });

    const results = [];

    for (const pdf of pdfs) {
      try {
        const pdfBuffer = Buffer.from(pdf.base64, 'base64');
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(pdfBuffer);
        const text = (pdfData.text || '').trim();

        // SCANNED-PDF PATH: pdf-parse couldn't extract real text. Use Claude
        // Haiku with native PDF input (handles Authentisign-wrapped scans, etc).
        if (text.length < 200) {
          try {
            const extracted = await extractWithAnthropic(pdfBuffer);
            if (extracted.not_trade_package) {
              results.push({ filename: pdf.filename, error: 'PDF did not look like a brokerage trade package / commission statement' });
            } else if (!extracted.property_address && !extracted.sale_price && !extracted.monthly_rent) {
              results.push({ filename: pdf.filename, error: 'OCR ran but no property/price extracted — form may be unreadable', ...extracted, _via: 'anthropic' });
            } else {
              results.push({ filename: pdf.filename, ...extracted, _via: 'anthropic' });
            }
          } catch (ocrErr) {
            results.push({ filename: pdf.filename, error: `OCR failed: ${ocrErr.message}` });
          }
          continue;
        }

        const textForModel = text.length > 10000 ? text.slice(0, 10000) : text;

        const callOpenAI = () => fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1000,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: `${TRADE_EXTRACTION_PROMPT}\n\nExtracted text:\n${textForModel}`
            }]
          })
        }).then(async r => {
          const j = await r.json();
          if (j.error) { const e = new Error(j.error.message); e.status = r.status; throw e; }
          return j;
        });

        const data = await withRetry(callOpenAI, `trade:${pdf.filename}`);
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');

        if (extracted.not_trade_package) {
          results.push({ filename: pdf.filename, error: 'PDF did not look like a brokerage trade package / commission statement' });
        } else if (!extracted.property_address && !extracted.sale_price && !extracted.monthly_rent) {
          results.push({ filename: pdf.filename, error: 'No property address or price extracted — form may be unreadable', ...extracted });
        } else {
          results.push({ filename: pdf.filename, ...extracted, _via: 'openai' });
        }
      } catch (fileErr) {
        console.error('Error on', pdf.filename, fileErr.message);
        results.push({ filename: pdf.filename, error: fileErr.message });
      }
    }

    return res.status(200).json({ success: true, count: results.length, results });
  } catch (e) {
    console.error('extract-trade error:', e);
    return res.status(500).json({ error: e.message });
  }
};
