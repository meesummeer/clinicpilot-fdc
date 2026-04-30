// GET /api/payments-all
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllPayments } = require('./_payments');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const sheets = getSheetsClient();
    const all = await getAllPayments(sheets);
    return ok(all);
  } catch (e) {
    return err(e.message);
  }
};
