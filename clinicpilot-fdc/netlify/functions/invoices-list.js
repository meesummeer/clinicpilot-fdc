// POST /api/invoices-list  body: { patient_id }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { patient_id } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllInvoices(sheets);
    return ok(all.filter(i => String(i.patient_id) === String(patient_id)));
  } catch (e) {
    return err(e.message);
  }
};
