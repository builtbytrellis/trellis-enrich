const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');

module.exports = async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.redirect(`/?docusign_error=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    return res.redirect('/?docusign_error=missing_code');
  }

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
      body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('https://trellis-enrich-el6t.vercel.app/api/docusign-callback')}`
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
    }

    // Get user info to find account details
    const userRes = await fetch('https://account-d.docusign.com/oauth/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userInfo = await userRes.json();
    const account = userInfo.accounts?.[0];
    const accountId = account?.account_id;
    const baseUri = account?.base_uri;

    // Store token in Redis with a temporary key (60 min TTL)
    const redis = new Redis({ 
      url: process.env.KV_REST_API_URL, 
      token: process.env.KV_REST_API_TOKEN 
    });
    
    const tempKey = 'ds_pending_' + Date.now();
    await redis.set(tempKey, JSON.stringify({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      accountId,
      baseUri,
      expiresIn: tokenData.expires_in
    }), { ex: 3600 });

    // Redirect back to app with the temp key
    res.redirect(`/?ds_key=${tempKey}`);
  } catch (e) {
    console.error('DocuSign callback error:', e);
    res.redirect(`/?docusign_error=${encodeURIComponent(e.message)}`);
  }
};
