// POST /api/notes-add  body: { patient_id, text }
const { getSheetsClient, BILLING_SHEET_ID, cors, ok, err } = require('./_sheets');

const NOTES_TAB = 'Notes';

async function ensureNotesTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BILLING_SHEET_ID });
  const exists = (meta.data.sheets || []).find(s => s.properties?.title === NOTES_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BILLING_SHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: NOTES_TAB } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${NOTES_TAB}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [['id','patient_id','text','at']] }
    });
  }
}

async function getAllNotes(sheets) {
  await ensureNotesTab(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BILLING_SHEET_ID, range: `${NOTES_TAB}!A:D` });
  return (res.data.values || []).slice(1).filter(r => r[0]).map(r => ({
    id: r[0], patient_id: r[1], text: r[2], at: Number(r[3])
  }));
}

async function writeAllNotes(sheets, notes) {
  await ensureNotesTab(sheets);
  await sheets.spreadsheets.values.clear({ spreadsheetId: BILLING_SHEET_ID, range: `${NOTES_TAB}!A2:D9999` });
  if (notes.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BILLING_SHEET_ID,
      range: `${NOTES_TAB}!A2`,
      valueInputOption: 'RAW',
      resource: { values: notes.map(n => [n.id, n.patient_id, n.text, n.at]) }
    });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { patient_id, text } = JSON.parse(event.body || '{}');
    if (!patient_id || !text) return err('patient_id and text required', 400);
    const sheets = getSheetsClient();
    const all = await getAllNotes(sheets);
    const newNote = { id: 'n_' + Math.random().toString(36).slice(2, 9), patient_id, text, at: Date.now() };
    all.push(newNote);
    await writeAllNotes(sheets, all);
    return ok({ ok: true, note: newNote });
  } catch (e) {
    return err(e.message);
  }
};
