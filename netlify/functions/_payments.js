// _payments.js - individual payment records (each has its own date)
// Payments tab: id | invoice_id | patient_id | date (YYYY-MM-DD) | amount | payment_mode
const { BILLING_SHEET_ID } = require('./_sheets');

const PAYMENTS_TAB = 'Payments';
const PAYMENTS_HEADER = ['id','invoice_id','patient_id','date','amount','payment_mode'];

async function ensurePaymentsTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BILLING_SHEET_ID });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === PAYMENTS_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BILLING_SHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: PAYMENTS_TAB } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${PAYMENTS_TAB}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [PAYMENTS_HEADER] }
    });
  }
}

async function getAllPayments(sheets) {
  await ensurePaymentsTab(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BILLING_SHEET_ID, range: `${PAYMENTS_TAB}!A:F` });
  const rows = (res.data.values || []).slice(1);
  return rows.filter(r => r[0]).map(r => ({
    id: Number(r[0]),
    invoice_id: Number(r[1]),
    patient_id: r[2] || '',
    date: r[3] || '',       // YYYY-MM-DD
    amount: Number(r[4] || 0),
    payment_mode: r[5] || ''
  }));
}

async function writeAllPayments(sheets, payments) {
  await ensurePaymentsTab(sheets);
  await sheets.spreadsheets.values.clear({ spreadsheetId: BILLING_SHEET_ID, range: `${PAYMENTS_TAB}!A2:F9999` });
  if (payments.length) {
    const rows = payments.map(p => [p.id, p.invoice_id, p.patient_id, p.date, p.amount, p.payment_mode]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${PAYMENTS_TAB}!A2`,
      valueInputOption: 'RAW',
      resource: { values: rows }
    });
  }
}

// Recalculate and update invoice status based on payments
// Returns updated status string
function calcStatus(cost, paymentsForInvoice) {
  const totalPaid = paymentsForInvoice.reduce((s, p) => s + p.amount, 0);
  if (totalPaid <= 0) return 'unpaid';
  if (totalPaid >= cost) return 'paid';
  return 'partial';
}

module.exports = { getAllPayments, writeAllPayments, calcStatus, PAYMENTS_TAB };
