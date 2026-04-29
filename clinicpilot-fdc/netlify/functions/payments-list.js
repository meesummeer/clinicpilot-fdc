// GET /api/payments-list?invoice_id=5  OR  ?patient_id=25001
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllPayments } = require('./_payments');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { invoice_id, patient_id } = event.queryStringParameters || {};
    const sheets = getSheetsClient();
    const all = await getAllPayments(sheets);
    let result = all;
    if (invoice_id) result = result.filter(p => p.invoice_id === Number(invoice_id));
    if (patient_id) result = result.filter(p => String(p.patient_id) === String(patient_id));
    return ok(result);
  } catch (e) {
    return err(e.message);
  }
};
