// POST /api/auth-login  body: { password }
// Returns a simple HMAC token stored in localStorage by the frontend.
// APP_PASSWORD and APP_SECRET must be set as Netlify env vars.
const crypto = require('crypto');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };

  try {
    const { password } = JSON.parse(event.body || '{}');
    const APP_PASSWORD = process.env.APP_PASSWORD || '';
    const APP_SECRET = process.env.APP_SECRET || 'clinicpilot-secret-change-me';

    if (!APP_PASSWORD) {
      return { statusCode: 500, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'APP_PASSWORD not configured' }) };
    }

    if (password !== APP_PASSWORD) {
      return { statusCode: 401, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Incorrect password' }) };
    }

    // Generate a signed token: base64(timestamp) + "." + HMAC signature
    const payload = Buffer.from(String(Date.now())).toString('base64');
    const sig = crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    const token = `${payload}.${sig}`;

    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, token })
    };
  } catch (e) {
    return { statusCode: 500, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
