const { verifySession } = require('./auth');
const fetch = require('node-fetch');

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

// OREA APS (Form 100/101) PDFs have the form template throughout the text
// and the filled-in values clumped together right before the page-2 header.
// The anchor "INITIALS OF SELLER(S):" reliably precedes the values block on
// page 1 of merged APS PDFs.
function focusOnTradeValues(text) {
  const anchor = text.match(/INITIALS\s*OF\s*SELLER\(?S\)?/i);
  if (anchor) {
    return text.slice(anchor.index, anchor.index + 4000);
  }
  // Some APS PDFs may not have that exact phrase; try the page-1 footer anchor
  const footer = text.match(/Form\s*1[01]\d?\s+Revised[^\n]+Page\s*1\s*of/i);
  if (footer) {
    return text.slice(footer.index, footer.index + 4000);
  }
  // Last resort: chars 4000-10000 (values typically live in this range)
  return text.slice(4000, 10000);
}

// Form 320 (Confirmation of Co-operation and Representation) has commission
// split info. When the merged PDF contains it, grab a window around it.
function focusOnCommissionSection(text) {
  const m = text.match(/Confirmation\s*of\s*Co-?operation/i);
  if (!m) return null;
  return text.slice(m.index, m.index + 4000);
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
        const text = pdfData.text || '';

        if (!text.trim()) {
          results.push({ filename: pdf.filename, error: 'PDF has no extractable text (likely scanned image — OCR not yet supported)' });
          continue;
        }

        const apsValues = focusOnTradeValues(text);
        const commissionSection = focusOnCommissionSection(text);
        const compact = commissionSection
          ? `${apsValues}\n\n=== Form 320 commission section ===\n${commissionSection}`
          : apsValues;

        const callOpenAI = () => fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 800,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: `This is text extracted from an Ontario real estate Agreement of Purchase and Sale (OREA Form 100/101, sometimes merged with Form 320 Confirmation of Co-operation). The form template fills most of the text; the FILLED-IN values appear together in a block.

The values block on a typical merged APS looks like a series of short lines, roughly in this order (some optional):
  - City of <city>
  - Condominium plan number (e.g. YRSC1112) — only on condo APS
  - Parking/Locker designations — only on condo APS
  - Sale price as digits (e.g. "485,000.00")
  - Sale price as words (e.g. "Four Hundred Eighty-Five Thousand")
  - Deposit terms ("upon acceptance" or similar)
  - Deposit amount as digits (e.g. "24,250.00")
  - Deposit as words
  - Name of the BUYER'S brokerage (e.g. "HOMELIFE FRONTIER REALTY INC., BROKERAGE")
  - Buyer side indicator (often just "B" or "Buyer")
  - Times and dates
  - Buyer name(s) — e.g. "Joel Hirsch&Sonya Hirsch"
  - Seller name(s) — usually ALL CAPS — e.g. "MAJID KHADEM SAMENI"
  - Property street address (e.g. "7North Park Road")
  - Unit number
  - City, Province, Postal (e.g. "VaughanONL4J 0C9")
  - Offer/agreement date

If a Form 320 commission section is present, it contains commission split info — typically the listing brokerage agrees to pay a percentage (e.g. 2.5%) of the sale price to the co-operating (buyer's) brokerage.

Extracted text:
${compact}

Return ONLY valid JSON:
{
  "property_address": "street address with unit if any (e.g. '7 North Park Road, Unit 1007') or null",
  "property_city": "city or null",
  "property_province": "province (e.g. 'ON') or null",
  "property_postal": "postal code (e.g. 'L4J 0C9') or null",
  "buyer_names": ["array of buyer full names, split on '&' or 'and'"],
  "seller_names": ["array of seller full names"],
  "sale_price": numeric_value_or_null,
  "deposit": numeric_value_or_null,
  "agreement_date": "YYYY-MM-DD or null",
  "closing_date": "YYYY-MM-DD or null",
  "lorrys_brokerage": "the brokerage name visible in the values block (this is the BUYER'S brokerage on a buy-side deal) or null",
  "lorrys_side": "'buyer' if the brokerage appears in the buyer-side portion of values, 'seller' if seller-side, or null",
  "commission_pct": numeric_value_if_form_320_shows_a_percent_or_null,
  "commission_amount": numeric_value_if_explicitly_shown_or_null,
  "docusign_envelope_id": "DocuSign envelope ID if present or null",
  "form_type": "'APS Condo' or 'APS Residential' or 'APS Other' or null"
}
If this is not an Ontario APS form return: {"not_aps": true}`
            }]
          })
        }).then(async r => {
          const j = await r.json();
          if (j.error) { const e = new Error(j.error.message); e.status = r.status; throw e; }
          return j;
        });

        const data = await withRetry(callOpenAI, `trade:${pdf.filename}`);
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');

        if (extracted.not_aps) {
          results.push({ filename: pdf.filename, error: 'PDF did not look like an OREA Agreement of Purchase and Sale' });
        } else if (!extracted.property_address && !extracted.sale_price) {
          results.push({ filename: pdf.filename, error: 'No property address or sale price extracted — form may be blank or unreadable', ...extracted });
        } else {
          results.push({ filename: pdf.filename, ...extracted });
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
