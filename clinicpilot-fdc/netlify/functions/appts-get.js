// GET /api/appts-get?id=5
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllAppts } = require('./_appts');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const id = Number(event.queryStringParameters?.id);
    const sheets = getSheetsClient();
    const all = await getAllAppts(sheets);
    return ok(all.find(a => a.id === id) || null);
  } catch (e) {
    return err(e.message);
  }
};
