// GET /api/patients-get?id=25001
const { getSheetsClient, PATIENT_SHEET_ID, getFirstSheetTitle, cors, ok, err } = require('./_sheets');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const id = event.queryStringParameters?.id || '';
    const sheets = getSheetsClient();
    const title = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: PATIENT_SHEET_ID, range: `${title}!A:F` });
    const rows = (res.data.values || []).slice(1);
    const r = rows.find(r => String(r[0] || '').trim() === id.trim());
    if (!r) return ok(null);
    return ok({ external_id: r[0], id: r[0], name: r[1], phone: r[2], address: r[3], age: r[4], gender: r[5] });
  } catch (e) {
    return err(e.message);
  }
};
