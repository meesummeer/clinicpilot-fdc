// netlify/functions/_sheets.js
// Shared helper: returns an authenticated Google Sheets client.
// Credentials come from the GOOGLE_CREDENTIALS env var (JSON string of service account).

const { google } = require('googleapis');

function getSheetsClient() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS env var not set');
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

const PATIENT_SHEET_ID  = process.env.PATIENT_SHEET_ID  || '1qU85D_wogO1MPht83hLw_KmE0uqicYUMIs-Yo1T1EvA';
const BILLING_SHEET_ID  = process.env.BILLING_SHEET_ID  || '1_4GIXvJbFjk0Ak96M82oi1Po7cvI6KOPOdk2JuLos24';

async function getFirstSheetTitle(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const first = (meta.data.sheets || [])[0];
  if (!first) throw new Error('No sheets found');
  return first.properties.title;
}

async function getOrCreateSheetByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === title);
  if (existing) return existing.properties.sheetId;
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [{ addSheet: { properties: { title } } }] }
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

// CORS headers for all responses
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}

function ok(body) {
  return { statusCode: 200, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function err(msg, code = 500) {
  return { statusCode: code, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: msg }) };
}

module.exports = { getSheetsClient, PATIENT_SHEET_ID, BILLING_SHEET_ID, getFirstSheetTitle, getOrCreateSheetByTitle, cors, ok, err };
