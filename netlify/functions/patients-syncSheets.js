// POST /api/patients-syncSheets
// Rewrites patient sheet in sorted MR order.
const { getSheetsClient, PATIENT_SHEET_ID, getFirstSheetTitle, cors, ok, err } = require('./_sheets');

function mrSort(a, b) {
  const ax = String(a[0] || '');
  const bx = String(b[0] || '');
  const an = parseInt(ax.slice(2), 10);
  const bn = parseInt(bx.slice(2), 10);
  if (!isNaN(an) && !isNaN(bn)) return an - bn;
  return ax.localeCompare(bx, undefined, { numeric: true, sensitivity: 'base' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const sheets = getSheetsClient();
    const title = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: PATIENT_SHEET_ID,
      range: `${title}!A:F`
    });
    const all = res.data.values || [];
    const header = all[0] || ['Case No.', 'Patient Name', 'Phone', 'Address', 'Age', 'Gender'];
    const rows = all.slice(1)
      .filter(r => String(r[0] || '').trim() || String(r[1] || '').trim())
      .map(r => [r[0] || '', r[1] || '', r[2] || '', r[3] || '', r[4] || '', r[5] || ''])
      .sort(mrSort);

    await sheets.spreadsheets.values.update({
      spreadsheetId: PATIENT_SHEET_ID,
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [header, ...rows] }
    });
    return ok({ ok: true, count: rows.length });
  } catch (e) {
    return err(e.message);
  }
};
