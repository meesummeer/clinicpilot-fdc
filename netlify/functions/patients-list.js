// GET /api/patients-list?q=searchterm
const { getSheetsClient, PATIENT_SHEET_ID, getFirstSheetTitle, cors, ok, err } = require('./_sheets');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const q = (event.queryStringParameters?.q || '').toLowerCase().trim();
    const sheets = getSheetsClient();
    const title = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: PATIENT_SHEET_ID,
      range: `${title}!A:F`
    });
    const rows = (res.data.values || []).slice(1); // skip header
    let patients = rows
      .filter(r => r[0] || r[1])
      .map(r => ({
        external_id: r[0] || '',
        name: r[1] || '',
        phone: r[2] || '',
        address: r[3] || '',
        age: r[4] || '',
        gender: r[5] || '',
        id: r[0] || '' // use case no as id in web version
      }));

    if (q) {
      patients = patients.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.external_id.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q)
      );
    }

    return ok(patients);
  } catch (e) {
    return err(e.message);
  }
};
