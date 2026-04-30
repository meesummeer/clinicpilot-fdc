// POST /api/appts-update  body: { appt: patch }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllAppts, writeAllAppts } = require('./_appts');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { appt: patch } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllAppts(sheets);
    const idx = all.findIndex(a => a.id === Number(patch.id));
    if (idx < 0) return err('Appointment not found', 404);
    all[idx] = { ...all[idx], ...patch, id: all[idx].id };
    await writeAllAppts(sheets, all);
    return ok({ ok: true, appt: all[idx] });
  } catch (e) {
    return err(e.message);
  }
};
