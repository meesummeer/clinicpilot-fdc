// GET /api/invoices-all
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const sheets = getSheetsClient();
    const all = await getAllInvoices(sheets);
    return ok(all);
  } catch (e) {
    return err(e.message);
  }
};
