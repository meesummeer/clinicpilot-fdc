// _appts.js - shared appointments storage helper
// Appointments stored in "Appointments" tab in BILLING_SHEET_ID
const { BILLING_SHEET_ID } = require('./_sheets');

const APPT_TAB = 'Appointments';
const APPT_HEADER = ['id','patient_id','patient_name','doctor','procedure','date','time','status'];

async function ensureApptTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BILLING_SHEET_ID });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === APPT_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BILLING_SHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: APPT_TAB } } }] }
    });
    const { getSheetsClient } = require('./_sheets');
    const s = getSheetsClient();
    await s.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${APPT_TAB}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [APPT_HEADER] }
    });
  }
}

async function getAllAppts(sheets) {
  await ensureApptTab(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BILLING_SHEET_ID, range: `${APPT_TAB}!A:H` });
  const rows = (res.data.values || []).slice(1);
  return rows.filter(r => r[0]).map(r => ({
    id: Number(r[0]),
    patient_id: r[1] || '',
    patient_name: r[2] || '',
    doctor: r[3] || '',
    procedure: r[4] || '',
    date: r[5] || '',
    time: r[6] || '',
    status: r[7] || 'yellow'
  }));
}

async function writeAllAppts(sheets, appts) {
  await ensureApptTab(sheets);
  await sheets.spreadsheets.values.clear({ spreadsheetId: BILLING_SHEET_ID, range: `${APPT_TAB}!A2:H9999` });
  if (appts.length) {
    const rows = appts.map(a => [a.id, a.patient_id, a.patient_name, a.doctor, a.procedure, a.date, a.time, a.status]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${APPT_TAB}!A2`,
      valueInputOption: 'RAW',
      resource: { values: rows }
    });
  }
}

module.exports = { getAllAppts, writeAllAppts };
