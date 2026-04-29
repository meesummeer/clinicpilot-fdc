// GET /api/notes-list?patient_id=25001
const { getSheetsClient, BILLING_SHEET_ID, cors, ok, err } = require('./_sheets');

const NOTES_TAB = 'Notes';

async function ensureNotesTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BILLING_SHEET_ID });
  const exists = (meta.data.sheets || []).find(s => s.properties?.title === NOTES_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BILLING_SHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: NOTES_TAB } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${NOTES_TAB}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [['id','patient_id','text','at']] }
    });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const pid = event.queryStringParameters?.patient_id || '';
    const sheets = getSheetsClient();
    await ensureNotesTab(sheets);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: BILLING_SHEET_ID, range: `${NOTES_TAB}!A:D` });
    const notes = (res.data.values || []).slice(1)
      .filter(r => r[0] && String(r[1]) === String(pid))
      .map(r => ({ id: r[0], patient_id: r[1], text: r[2], at: Number(r[3]) }));
    return ok(notes);
  } catch (e) {
    return err(e.message);
  }
};
