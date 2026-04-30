// POST /api/payments-add  body: { invoice_id, patient_id, date, amount, payment_mode }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllPayments, writeAllPayments, calcStatus } = require('./_payments');
const { getAllInvoices, writeAllInvoices } = require('./_invoices');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { invoice_id, patient_id, date, amount, payment_mode } = JSON.parse(event.body || '{}');
    if (!invoice_id || !patient_id || !date || amount === undefined || amount === null) {
      return err('invoice_id, patient_id, date, amount required', 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return err('date must be YYYY-MM-DD', 400);

    const sheets = getSheetsClient();
    const [allPayments, allInvoices] = await Promise.all([
      getAllPayments(sheets),
      getAllInvoices(sheets)
    ]);
    const targetInvoiceId = Number(invoice_id);
    const inv = allInvoices.find(i => i.id === targetInvoiceId);
    if (!inv) return err('Parent invoice not found', 404);

    const nextId = allPayments.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
    const newPayment = {
      id: nextId,
      invoice_id: targetInvoiceId,
      patient_id: String(patient_id),
      date: String(date),         // YYYY-MM-DD
      amount: Number(amount),
      payment_mode: payment_mode || ''
    };

    allPayments.push(newPayment);
    await writeAllPayments(sheets, allPayments);

    // Recalculate invoice status
    const invPayments = allPayments.filter(p => p.invoice_id === targetInvoiceId);
    inv.status = calcStatus(inv.cost, invPayments);
    await writeAllInvoices(sheets, allInvoices);

    return ok({ ok: true, payment: newPayment });
  } catch (e) {
    return err(e.message);
  }
};
