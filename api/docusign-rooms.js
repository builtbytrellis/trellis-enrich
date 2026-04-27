const fetch = require('node-fetch');
const { verifySession } = require('./auth');

async function getRooms(accessToken, accountId, baseUri) {
  const url = `${baseUri}/restapi/v2.1/accounts/${accountId}/rooms?count=50&startPosition=0`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Rooms API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function getRoomDocuments(accessToken, accountId, baseUri, roomId) {
  const url = `${baseUri}/restapi/v2.1/accounts/${accountId}/rooms/${roomId}/documents`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) return { documents: [] };
  return res.json();
}

async function downloadDocument(accessToken, accountId, baseUri, roomId, docId) {
  const url = `${baseUri}/restapi/v2.1/accounts/${accountId}/rooms/${roomId}/documents/${docId}/contents`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

async function extractFintracData(pdfBase64, contactName) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return null;

  try {
    const prompt = `This is a FINTRAC (Financial Transactions and Reports Analysis Centre of Canada) identity verification form from a real estate transaction${contactName ? ` for ${contactName}` : ''}.

Extract the following information and return ONLY valid JSON with no markdown:
{
  "full_name": "string or null",
  "date_of_birth": "YYYY-MM-DD format or null",
  "occupation": "string or null",
  "employer": "string or null",
  "address": "string or null",
  "city": "string or null",
  "id_type": "string (e.g. Passport, Driver License) or null",
  "id_number": "string or null",
  "id_expiry": "string or null",
  "phone": "string or null",
  "email": "string or null",
  "is_buyer": true,
  "is_seller": false
}

If this is not a FINTRAC form or contains no personal information, return {"not_fintrac": true}.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:application/pdf;base64,${pdfBase64}`,
                detail: 'high'
              }
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('OpenAI error:', data.error);
      return null;
    }
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('FINTRAC extraction error:', e);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { accessToken, accountId, baseUri, extractFintrac = false } = req.body;
  if (!accessToken || !accountId || !baseUri) {
    return res.status(400).json({ error: 'Missing DocuSign credentials' });
  }

  try {
    // Fetch all rooms
    const roomsData = await getRooms(accessToken, accountId, baseUri);
    const rooms = roomsData.rooms || [];

    const transactions = [];

    for (const room of rooms) {
      const transaction = {
        roomId: room.roomId,
        name: room.name,
        status: room.status,
        address: room.fieldData?.address || room.address || null,
        city: room.fieldData?.city || null,
        closingDate: room.fieldData?.closingDate || null,
        salePrice: room.fieldData?.purchasePrice || null,
        transactionType: room.transactionType || null,
        createdAt: room.createdDate,
        contacts: [],
        fintracData: []
      };

      // Get documents if FINTRAC extraction requested
      if (extractFintrac) {
        try {
          const docsData = await getRoomDocuments(accessToken, accountId, baseUri, room.roomId);
          const docs = docsData.documents || [];
          
          // Look for FINTRAC documents
          const fintracDocs = docs.filter(d => 
            d.name && (
              d.name.toLowerCase().includes('fintrac') ||
              d.name.toLowerCase().includes('identity') ||
              d.name.toLowerCase().includes('id verification') ||
              d.name.toLowerCase().includes('pii')
            )
          );

          for (const doc of fintracDocs.slice(0, 3)) { // Max 3 per room
            try {
              const pdfBase64 = await downloadDocument(accessToken, accountId, baseUri, room.roomId, doc.documentId);
              if (pdfBase64) {
                const extracted = await extractFintracData(pdfBase64, null);
                if (extracted && !extracted.not_fintrac) {
                  transaction.fintracData.push({ ...extracted, documentName: doc.name });
                }
              }
            } catch (docErr) {
              console.warn('Doc extraction failed:', docErr.message);
            }
          }
        } catch (roomErr) {
          console.warn('Room docs fetch failed:', roomErr.message);
        }
      }

      transactions.push(transaction);
    }

    return res.status(200).json({
      success: true,
      total: transactions.length,
      transactions
    });
  } catch (e) {
    console.error('DocuSign rooms error:', e);
    return res.status(500).json({ error: e.message });
  }
};
