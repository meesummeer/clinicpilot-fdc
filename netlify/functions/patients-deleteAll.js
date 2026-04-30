// POST /api/patients-deleteAll
const { getSheetsClient, PATIENT_SHEET_ID, getFirstSheetTitle, cors, ok, err } = require('./_sheets');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const sheets = getSheetsClient();
    const title = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);
    await sheets.spreadsheets.values.clear({ spreadsheetId: PATIENT_SHEET_ID, range: `${title}!A2:F9999` });
    return ok({ ok: true });
  } catch (e) {
    return err(e.message);
  }
};
