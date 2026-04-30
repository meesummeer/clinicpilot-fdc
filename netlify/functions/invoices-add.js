// POST /api/invoices-add  body: { invoice }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllInvoices, writeAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { invoice: inv } = JSON.parse(event.body || '{}');
    if (!inv) return err('No invoice provided', 400);
    const sheets = getSheetsClient();
    const all = await getAllInvoices(sheets);
    const nextId = all.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    const newInv = {
      id: nextId,
      patient_id: inv.patient_id || '',
      created_at: inv.created_at || Date.now(),
      procedure: inv.procedure || '',
      lab_cost: Number(inv.lab_cost || 0),
      cost: Number(inv.cost || 0),
      status: 'unpaid'
    };
    all.push(newInv);
    await writeAllInvoices(sheets, all);
    return ok({ ok: true, invoice: newInv });
  } catch (e) {
    return err(e.message);
  }
};
