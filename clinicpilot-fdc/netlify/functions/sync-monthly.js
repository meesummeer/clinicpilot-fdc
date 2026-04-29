// POST /api/sync-monthly  body: { ym: "2025-06" }
// Monthly report = all PAYMENTS made in that month (by payment date), joined to invoice for procedure/lab cost
const { getSheetsClient, PATIENT_SHEET_ID, BILLING_SHEET_ID, getFirstSheetTitle, getOrCreateSheetByTitle, cors, ok, err } = require('./_sheets');
const { getAllInvoices } = require('./_invoices');
const { getAllPayments } = require('./_payments');

async function clearBanding(sheets, spreadsheetId, sheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets || []).find(s => s.properties?.sheetId === sheetId);
  const bands = (sheet && sheet.bandedRanges) || [];
  if (!bands.length) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: bands.map(b => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } })) } });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { ym } = JSON.parse(event.body || '{}');
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return err('Invalid month format. Use YYYY-MM.', 400);

    const sheets = getSheetsClient();

    // Patient name map
    const patientTitle = await getFirstSheetTitle(sheets, PATIENT_SHEET_ID);
    const pRes = await sheets.spreadsheets.values.get({ spreadsheetId: PATIENT_SHEET_ID, range: `${patientTitle}!A:B` });
    const nameMap = new Map();
    (pRes.data.values || []).slice(1).forEach(r => { if (r[0] && r[1]) nameMap.set(String(r[0]).trim(), String(r[1]).trim()); });

    // Invoice map (id -> invoice)
    const allInvoices = await getAllInvoices(sheets);
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));

    // Payments in this month
    const allPayments = await getAllPayments(sheets);
    const monthPayments = allPayments.filter(p => (p.date || '').startsWith(ym));

    const header = [['Payment Date', 'Case No.', 'Patient Name', 'Procedure', 'Lab Cost', 'Invoice Total', 'Payment Amount', 'Mode of Payment']];
    const rows = [];

    monthPayments.forEach(p => {
      const inv = invoiceMap.get(p.invoice_id);
      if (!inv) return;
      const caseNo = String(inv.patient_id || '').trim();
      if (!caseNo) return;
      const name = nameMap.get(caseNo) || '';
      rows.push([
        p.date,
        caseNo,
        name,
        inv.procedure || '',
        Number(inv.lab_cost || 0),
        Number(inv.cost || 0),
        Number(p.amount || 0),
        p.payment_mode || ''
      ]);
    });

    rows.sort((a, b) => {
      if (a[0] !== b[0]) return String(a[0]).localeCompare(String(b[0]));
      return String(a[1]).localeCompare(String(b[1]));
    });

    const title = `Report_${ym}`;
    const sheetId = await getOrCreateSheetByTitle(sheets, BILLING_SHEET_ID, title);

    await sheets.spreadsheets.values.clear({ spreadsheetId: BILLING_SHEET_ID, range: `${title}!A:Z` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      resource: { values: header.concat(rows) }
    });

    await clearBanding(sheets, BILLING_SHEET_ID, sheetId);

    const jade = { red: 0.0, green: 0.59, blue: 0.53 };
    const headerCols = 8;

    const requests = [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headerCols },
          cell: { userEnteredFormat: { backgroundColor: jade, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }},
      ...[4,5,6].map(col => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
          fields: 'userEnteredFormat.numberFormat'
        }
      })),
      ...[[0,110],[1,110],[2,220],[3,200],[4,110],[5,130],[6,140],[7,160]].map(([col, px]) => ({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: px }, fields: 'pixelSize'
        }
      })),
      { addBanding: { bandedRange: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: headerCols },
          rowProperties: { headerColor: { red:1,green:1,blue:1 }, firstBandColor: { red:0.98,green:0.98,blue:0.98 }, secondBandColor: { red:1,green:1,blue:1 } }
      }}},
      { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: headerCols } } } }
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId: BILLING_SHEET_ID, resource: { requests } });

    const url = `https://docs.google.com/spreadsheets/d/${BILLING_SHEET_ID}/edit#gid=${sheetId}`;
    return ok({ ok: true, url, rows: rows.length });
  } catch (e) {
    return err(e.message);
  }
};
