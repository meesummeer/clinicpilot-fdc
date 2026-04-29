// POST /api/appts-delete  body: { id }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllAppts, writeAllAppts } = require('./_appts');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { id } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllAppts(sheets);
    const filtered = all.filter(a => a.id !== Number(id));
    await writeAllAppts(sheets, filtered);
    return ok({ ok: true });
  } catch (e) {
    return err(e.message);
  }
};
