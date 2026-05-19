const { verifySession } = require('./auth');
const fetch = require('node-fetch');

// Narrow the giant 4-page FINTRAC form down to just the section with the
// fields we care about (Full legal name / Address / DOB / Occupation / ID).
// Two layouts seen in the wild:
//   (a) inline — labels + filled values on the same lines (e.g. DocuSign-flattened)
//   (b) separate — template labels appear once, filled values clump together
//       elsewhere in the text stream (older CREA fillable PDFs)
// We capture both windows when present.
function focusOnValuesSection(text) {
  const labelMatch = text.match(/1\.\s*Full\s*legal\s*name\s*of\s*individual/i);
  const footerMatch = text.match(/\n\s*1\s*\n\s*of\s*\d+\s*\n/);

  const labelWindow = labelMatch ? text.slice(labelMatch.index, labelMatch.index + 4000) : '';
  const valuesWindow = footerMatch
    ? text.slice(footerMatch.index + footerMatch[0].length, footerMatch.index + footerMatch[0].length + 2000)
    : '';

  // Both windows present and clearly distinct (separate-block layout): send both.
  if (labelWindow && valuesWindow && Math.abs(labelMatch.index - footerMatch.index) > 1500) {
    return `${labelWindow}\n\n=== filled values block ===\n${valuesWindow}`;
  }
  // Inline layout or only one anchor found: send the label window.
  if (labelWindow) return labelWindow;
  // No anchors at all (atypical PDF): fall back to a generous slice.
  return text.slice(0, 11000);
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
        const text = pdfData.text || '';

        if (!text.trim()) {
          results.push({ filename: pdf.filename, error: 'PDF has no extractable text (likely scanned image — OCR not yet supported)' });
          continue;
        }

        // Scope to just the section containing Name/Address/DOB/Occupation/ID
        // so the model isn't wading through 3 pages of legal boilerplate.
        const textForModel = focusOnValuesSection(text);

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
              content: `This is text extracted from a FINTRAC (Canadian real estate anti-money-laundering) identity verification form. The form is filled out by a REALTOR about a CLIENT (the individual being identified — usually a buyer or seller).

When the extracted text contains a clumped block of values (delimited below by "=== filled values block ==="), the values appear in THIS FIXED ORDER:
  1. Transaction property address (the property being bought/sold — NOT the client's home)
  2. Transaction city/province/postal
  3. Name of the realtor/broker/salesperson (the AGENT — NOT the client)
  4. Date the form was completed (NOT the client's date of birth)
  5. CLIENT's full legal name  ← this is what goes in "full_name"
  6. CLIENT's home address     ← this is what goes in "address"
  7. CLIENT's date of birth (YYYY/MM/DD)  ← this is what goes in "date_of_birth"
  8. CLIENT's occupation, often combined with employer (e.g. "Director IT - CIBC")
  9. ID document type (Driver's Licence / Passport / etc.)
  10. ID document number
  11. ID issuing jurisdiction (province + country, e.g. "ONCAN" = Ontario, Canada)
  12. ID document expiry date

If instead the values are inline with labels (e.g. "1. Full legal name of individual:    Stephen Alexander Boeckh"), extract them directly from those lines.

Extracted text:
${textForModel}

Return ONLY valid JSON about the CLIENT (never about the realtor):
{
  "full_name": "client's full legal name (item 5 in the values block, NOT item 3 which is the realtor) or null",
  "date_of_birth": "client's DOB in YYYY-MM-DD format (item 7, NOT item 4 which is the form date) or null",
  "occupation": "client's job title (parsed from item 8) or null",
  "employer": "client's employer/company (parsed from item 8 — e.g. 'CIBC' from 'Director IT - CIBC') or null",
  "address": "client's home address (item 6, NOT item 1 which is the transaction property) or null",
  "city": "client's home city or null",
  "province": "client's home province or null",
  "phone": "phone number or null",
  "email": "email or null",
  "id_type": "ID document type (item 9) or null",
  "id_number": "ID document number (item 10) or null",
  "is_buyer": true,
  "is_seller": false,
  "property_address": "transaction property address (item 1 in the values block) or null"
}
If this is not a FINTRAC form return: {"not_fintrac": true}`
            }]
          })
        }).then(async r => {
          const j = await r.json();
          if (j.error) { const e = new Error(j.error.message); e.status = r.status; throw e; }
          return j;
        });

        const data = await withRetry(callOpenAI, `fintrac:${pdf.filename}`);
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');

        if (extracted.not_fintrac) {
          results.push({ filename: pdf.filename, error: 'PDF did not look like a FINTRAC form to the model' });
        } else if (!extracted.full_name) {
          results.push({ filename: pdf.filename, error: 'No full_name extracted — form may be blank or unreadable', ...extracted });
        } else {
          results.push({ filename: pdf.filename, ...extracted });
        }

      } catch(fileErr) {
        console.error('Error on', pdf.filename, fileErr.message);
        results.push({ filename: pdf.filename, error: fileErr.message });
      }
    }

    return res.status(200).json({ success: true, count: results.length, results });
  } catch(e) {
    console.error('Extract FINTRAC error:', e);
    return res.status(500).json({ error: e.message });
  }
};
