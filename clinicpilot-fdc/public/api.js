// api.js - replaces window.api from Electron preload
// Adds auth token verification on load + payments API

// ---- Auth guard ----
(async function checkAuth() {
  const token = localStorage.getItem('cp_token');
  if (!token) { window.location.href = '/login.html'; return; }
  try {
    const res = await fetch('/api/auth-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!data.ok) { localStorage.removeItem('cp_token'); window.location.href = '/login.html'; }
  } catch (e) {
    // If verify fails due to network, allow through (offline resilience)
    console.warn('Auth verify failed, allowing through:', e.message);
  }
})();

// ---- API helpers ----
async function post(fn, body) {
  const res = await fetch(`/api/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status}`);
  return res.json();
}

async function get(fn, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/${fn}${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`${fn} failed: ${res.status}`);
  return res.json();
}

window.api = {
  patients: {
    list: (q) => get('patients-list', q ? { q } : {}),
    save: (p) => post('patients-save', { patient: p }).then(r => r.patient),
    get: (id) => get('patients-get', { id }),
    delete: (id) => post('patients-delete', { id }),
    deleteAll: () => post('patients-deleteAll', {}),
    syncSheets: () => Promise.resolve({ ok: true, count: 0 }) // no-op: sheets IS the DB
  },
  notes: {
    add: ({ patient_id, text }) => post('notes-add', { patient_id, text }),
    delete: ({ patient_id, note_id }) => post('notes-delete', { patient_id, note_id }),
    list: (patient_id) => get('notes-list', { patient_id })
  },
  invoices: {
    list: (pid) => post('invoices-list', { patient_id: pid }),
    add: (i) => post('invoices-add', { invoice: i }),
    delete: (id) => post('invoices-delete', { id }),
    update: (inv) => post('invoices-update', { invoice: inv })
  },
  payments: {
    list: (params) => get('payments-list', params),         // { invoice_id } or { patient_id }
    add: (p) => post('payments-add', p),                   // { invoice_id, patient_id, date, amount, payment_mode }
    delete: (id, invoice_id) => post('payments-delete', { id, invoice_id })
  },
  appts: {
    list: (ym) => post('appts-list', { ym }),
    add: (a) => post('appts-add', { appt: a }),
    delete: (id) => post('appts-delete', { id }),
    update: (a) => post('appts-update', { appt: a }),
    get: (id) => get('appts-get', { id }),
    nextFor: (pid) => get('appts-nextFor', { patient_id: pid })
  },
  ui: {
    openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve(true); },
    revealInFolder: () => Promise.resolve(true)
  },
  whatsapp: {
    open: ({ phone, message }) => {
      const encoded = encodeURIComponent(message || '');
      const clean = (phone || '').replace(/\D/g, '');
      window.open(`https://wa.me/${clean}?text=${encoded}`, '_blank');
      return Promise.resolve(true);
    }
  },
  report: {
    syncMonthly: (ym) => post('sync-monthly', { ym })
  },
  auth: {
    logout: () => { localStorage.removeItem('cp_token'); window.location.href = '/login.html'; }
  }
};
