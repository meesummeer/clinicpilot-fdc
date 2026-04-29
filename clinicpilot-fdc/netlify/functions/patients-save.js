// POST /api/patients-save  body: { patient }
const { getSheetsClient, PATIENT_SHEET_ID, getFirstSheetTitle, cors, ok, err } = require('./_sheets');

function getNextId(rows, prefix = '25') {
  const existing = rows
    .map(r => String(r[0] || ''))
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(2), 10))
    .filter(n => !isNaN(n));
  const max = existing.length ? Math.max(...existing) : 0;
  return prefix + String(max + 1).padStart(4, '0');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { patient: p } = JSON.parse(event.body || '{}');
    if (!p) return err('No patient provided', 400);

    const sheets = getSheetsClient();
    const title = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: PATIENT_SHEET_ID,
      range: `${title}!A:F`
    });
    const all = res.data.values || [];
    const header = all[0] || ['Case No.', 'Patient Name', 'Phone', 'Address', 'Age', 'Gender'];
    const rows = all.slice(1);

    // Assign ID if new
    if (!p.external_id) p.external_id = getNextId(rows);
    if (!p.id) p.id = p.external_id;

    const newRow = [
      String(p.external_id || '').trim(),
      String(p.name || '').trim(),
      String(p.phone || '').trim(),
      String(p.address || '').trim(),
      String(p.age || '').trim(),
      String(p.gender || '').trim()
    ];

    const existingIdx = rows.findIndex(r => String(r[0] || '').trim() === String(p.external_id).trim());

    if (existingIdx >= 0) {
      // Update existing row (row index in sheet = existingIdx + 2 because of 1-based + header)
      const sheetRow = existingIdx + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: PATIENT_SHEET_ID,
        range: `${title}!A${sheetRow}:F${sheetRow}`,
        valueInputOption: 'RAW',
        resource: { values: [newRow] }
      });
    } else {
      // Append new row (sorted insert: append then re-sort)
      rows.push(newRow);
      rows.sort((a, b) => {
        const na = parseInt(String(a[0] || '').slice(2), 10) || 0;
        const nb = parseInt(String(b[0] || '').slice(2), 10) || 0;
        return na - nb;
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: PATIENT_SHEET_ID,
        range: `${title}!A1`,
        valueInputOption: 'RAW',
        resource: { values: [header, ...rows] }
      });
    }

    return ok({ ok: true, patient: { ...p, id: p.external_id } });
  } catch (e) {
    return err(e.message);
  }
};
