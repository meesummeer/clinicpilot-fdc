// POST /api/appts-add  body: { appt }
const { getSheetsClient, cors, ok, err } = require('./_sheets');
const { getAllAppts, writeAllAppts } = require('./_appts');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try {
    const { appt: a } = JSON.parse(event.body || '{}');
    const sheets = getSheetsClient();
    const all = await getAllAppts(sheets);
    const nextId = all.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    const newAppt = { ...a, id: nextId, status: a.status || 'yellow' };
    all.push(newAppt);
    await writeAllAppts(sheets, all);
    return ok({ ok: true, appt: newAppt });
  } catch (e) {
    return err(e.message);
  }
};
