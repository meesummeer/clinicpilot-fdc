// POST /api/invoices-update  body: { invoice }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllInvoices, writeAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { invoice: inv } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllInvoices(sheets);
    const idx = all.findIndex(i => i.id === Number(inv.id));
    if (idx < 0) return err('Invoice not found', 404);
    // Only allow updating procedure, cost, lab_cost, created_at — not status (auto-calculated)
    all[idx] = {
      ...all[idx],
      procedure: inv.procedure ?? all[idx].procedure,
      cost: inv.cost !== undefined ? Number(inv.cost) : all[idx].cost,
      lab_cost: inv.lab_cost !== undefined ? Number(inv.lab_cost) : all[idx].lab_cost,
      created_at: inv.created_at ?? all[idx].created_at
    };
    await writeAllInvoices(sheets, all);
    return ok({ ok: true, invoice: all[idx] });
  } catch (e) {
    return err(e.message);
  }
};
