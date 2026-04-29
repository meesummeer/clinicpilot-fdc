// GET /api/appts-nextFor?patient_id=25001
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllAppts } = require('./_appts');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const pid = event.queryStringParameters?.patient_id || '';
    const sheets = getSheetsClient();
    const all = await getAllAppts(sheets);
    const today = new Date(); today.setHours(0,0,0,0);
    const future = all
      .filter(a => String(a.patient_id) === String(pid) && new Date(a.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return ok(future[0] || null);
  } catch (e) {
    return err(e.message);
  }
};
