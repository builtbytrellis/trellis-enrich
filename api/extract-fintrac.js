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
              content: `This is text extracted from a FINTRAC (Financial Transactions and Reports Analysis Centre of Canada) identity verification form from a Canadian real estate transaction. The form template boilerplate fills most of the text; the actual filled-in client data appears as scattered lines (name, address, DOB in YYYY/MM/DD, occupation, ID type and number).

Extracted text:
${textForModel}

Extract ALL information and return ONLY valid JSON:
{
  "full_name": "full legal name of the client/individual being identified (NOT the realtor) or null",
  "date_of_birth": "YYYY-MM-DD format or null",
  "occupation": "occupation/job title or null",
  "employer": "employer/company or null",
  "address": "street address of individual or null",
  "city": "city or null",
  "province": "province or null",
  "phone": "phone number or null",
  "email": "email or null",
  "id_type": "Passport/Driver's Licence/etc or null",
  "id_number": "ID number or null",
  "is_buyer": true,
  "is_seller": false,
  "property_address": "transaction property address or null"
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
