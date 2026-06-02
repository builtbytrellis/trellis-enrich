const { verifySession } = require('./auth');
const fetch = require('node-fetch');

const REPO = 'builtbytrellis/trellis-enrich';
const BRANCH = 'main';

async function getFileSha(path, token) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
    { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
  );
  if (res.status === 404) return null;
  const data = await res.json();
  return data.sha || null;
}

async function pushFile(path, content, message, token) {
  const sha = await getFileSha(path, token);
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    }
  );
  return { status: res.status, ok: res.ok, path };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not set in Vercel env vars' });

  const { files } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'files array required' });

  const results = [];
  for (const { path, content, message } of files) {
    try {
      const r = await pushFile(path, content, message || `Update ${path}`, token);
      results.push({ path, ok: r.ok, status: r.status });
    } catch(e) {
      results.push({ path, ok: false, error: e.message });
    }
  }

  return res.status(200).json({
    success: results.every(r => r.ok),
    pushed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results
  });
};
