// POST /api/invoices-delete  body: { id }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllInvoices, writeAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { id } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllInvoices(sheets);
    const filtered = all.filter(i => i.id !== Number(id));
    await writeAllInvoices(sheets, filtered);
    return ok({ ok: true });
  } catch (e) {
    return err(e.message);
  }
};
