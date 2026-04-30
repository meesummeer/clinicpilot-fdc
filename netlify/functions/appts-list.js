// POST /api/appts-list  body: { ym } e.g. "2025-06"
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllAppts } = require('./_appts');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { ym } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllAppts(sheets);
    return ok(ym ? all.filter(a => (a.date || '').startsWith(ym)) : all);
  } catch (e) {
    return err(e.message);
  }
};
