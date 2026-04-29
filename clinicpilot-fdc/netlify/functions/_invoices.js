// _invoices.js - Invoice = procedure record only. Payments are separate (_payments.js)
const { BILLING_SHEET_ID } = require('./_sheets');

const INVOICE_TAB = 'Invoices';
// id | patient_id | created_at | procedure | lab_cost | cost | status
const INVOICE_HEADER = ['id','patient_id','created_at','procedure','lab_cost','cost','status'];

async function ensureInvoiceTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BILLING_SHEET_ID });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === INVOICE_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BILLING_SHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: INVOICE_TAB } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${INVOICE_TAB}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [INVOICE_HEADER] }
    });
  }
}

async function getAllInvoices(sheets) {
  await ensureInvoiceTab(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BILLING_SHEET_ID, range: `${INVOICE_TAB}!A:G` });
  const rows = (res.data.values || []).slice(1);
  return rows.filter(r => r[0]).map(r => ({
    id: Number(r[0]),
    patient_id: r[1] || '',
    created_at: Number(r[2]) || 0,
    procedure: r[3] || '',
    lab_cost: Number(r[4] || 0),
    cost: Number(r[5] || 0),
    status: r[6] || 'unpaid'
  }));
}

async function writeAllInvoices(sheets, invoices) {
  await ensureInvoiceTab(sheets);
  const rows = invoices.map(i => [
    i.id, i.patient_id, i.created_at, i.procedure,
    i.lab_cost, i.cost, i.status || 'unpaid'
  ]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: BILLING_SHEET_ID, range: `${INVOICE_TAB}!A2:G9999` });
  if (rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${INVOICE_TAB}!A2`,
      valueInputOption: 'RAW',
      resource: { values: rows }
    });
  }
}

module.exports = { getAllInvoices, writeAllInvoices, INVOICE_TAB, INVOICE_HEADER };
