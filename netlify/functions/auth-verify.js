// POST /api/auth-verify  body: { token }
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
    const { token } = JSON.parse(event.body || '{}');
    const APP_SECRET = process.env.APP_SECRET || 'clinicpilot-secret-change-me';

    if (!token) return { statusCode: 401, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) };

    const [payload, sig] = token.split('.');
    if (!payload || !sig) return { statusCode: 401, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) };

    const expected = crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    if (sig !== expected) return { statusCode: 401, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) };

    // Token valid for 30 days
    const ts = Number(Buffer.from(payload, 'base64').toString());
    const age = Date.now() - ts;
    if (age > 30 * 24 * 60 * 60 * 1000) return { statusCode: 401, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Session expired' }) };

    return { statusCode: 200, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) };
  }
};
