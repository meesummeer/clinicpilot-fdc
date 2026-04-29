// POST /api/patients-delete  body: { id }
const { getSheetsClient, PATIENT_SHEET_ID, getFirstSheetTitle, cors, ok, err } = require('./_sheets');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { id } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const title = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: PATIENT_SHEET_ID, range: `${title}!A:F` });
    const all = res.data.values || [];
    const header = all[0];
    const rows = all.slice(1).filter(r => String(r[0] || '').trim() !== String(id).trim());
    await sheets.spreadsheets.values.update({
      spreadsheetId: PATIENT_SHEET_ID,
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [header, ...rows] }
    });
    // Clear any leftover rows below
    const totalOldRows = all.length;
    const totalNewRows = rows.length + 1;
    if (totalOldRows > totalNewRows) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: PATIENT_SHEET_ID,
        range: `${title}!A${totalNewRows + 1}:F${totalOldRows}`
      });
    }
    return ok({ ok: true });
  } catch (e) {
    return err(e.message);
  }
};
