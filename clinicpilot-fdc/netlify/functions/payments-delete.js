// POST /api/payments-delete  body: { id, invoice_id }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllPayments, writeAllPayments, calcStatus } = require('./_payments');
const { getAllInvoices, writeAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { id, invoice_id } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const [allPayments, allInvoices] = await Promise.all([
      getAllPayments(sheets),
      getAllInvoices(sheets)
    ]);

    const filtered = allPayments.filter(p => p.id !== Number(id));
    await writeAllPayments(sheets, filtered);

    // Recalculate invoice status
    if (invoice_id) {
      const inv = allInvoices.find(i => i.id === Number(invoice_id));
      if (inv) {
        const invPayments = filtered.filter(p => p.invoice_id === Number(invoice_id));
        inv.status = calcStatus(inv.cost, invPayments);
        await writeAllInvoices(sheets, allInvoices);
      }
    }

    return ok({ ok: true });
  } catch (e) {
    return err(e.message);
  }
};
