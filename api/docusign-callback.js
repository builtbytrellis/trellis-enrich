const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
    const secretKey = process.env.DOCUSIGN_SECRET_KEY;
    const credentials = Buffer.from(`${integrationKey}:${secretKey}`).toString('base64');

    // Exchange code for access token
    const tokenRes = await fetch('https://account-d.docusign.com/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=authorization_code&code=${code}`
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Failed to get access token');

    // Get user info
    const userRes = await fetch('https://account-d.docusign.com/oauth/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userInfo = await userRes.json();
    const accountId = userInfo.accounts?.[0]?.account_id;
    const baseUri = userInfo.accounts?.[0]?.base_uri;

    // Redirect back to app with tokens in hash (never in query string)
    const params = new URLSearchParams({
      ds_access_token: tokenData.access_token,
      ds_refresh_token: tokenData.refresh_token || '',
      ds_account_id: accountId,
      ds_base_uri: baseUri,
      ds_expires_in: tokenData.expires_in
    });

    res.redirect(`/?docusign_auth=1#${params.toString()}`);
  } catch (e) {
    console.error('DocuSign callback error:', e);
    res.redirect(`/?docusign_error=${encodeURIComponent(e.message)}`);
  }
};
