const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentMonth = new Date();
let currentPatient = null;
let currentPatientKey = null;
/** Last successful `patients.list()` result; null until first fetch completes */
let cachedPatients = null;
let allPatients = [];
let billingAllTime = false;

const BILLING_PROCEDURE_OPTIONS = [
  "RCT",
  "Scaling",
  "Extraction",
  "Diagnosis",
  "Filling",
  "Crown",
  "Denture",
  "Bridge",
  "Implant",
  "Whitening",
  "Other"
];

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}

function billingProcedureOptionTags() {
  return BILLING_PROCEDURE_OPTIONS.map((p) => `<option value="${p}">${p}</option>`).join("");
}

/** Selected procedure label from a select + optional "Other" text field. */
function readProcedureChoice(selectEl, otherInputEl) {
  const v = (selectEl?.value || "").trim();
  if (v === "Other") return (otherInputEl?.value || "").trim();
  return v;
}

function wireBillingProcedureOtherToggle(root, selectSel, wrapSel, inputSel) {
  const sel = root.querySelector(selectSel);
  const wrap = root.querySelector(wrapSel);
  const input = root.querySelector(inputSel);
  if (!sel || !wrap) return;
  const sync = () => {
    const isOther = sel.value === "Other";
    wrap.classList.toggle("hidden", !isOther);
    if (!isOther && input) input.value = "";
  };
  sel.addEventListener("change", sync);
  sync();
}

/** Pre-fill procedure select when stored value may be custom (not in preset list). */
function applyStoredProcedure(selectEl, otherWrap, otherInput, stored) {
  const s = String(stored || "").trim();
  const preset = new Set(BILLING_PROCEDURE_OPTIONS);
  preset.delete("Other");
  if (preset.has(s)) {
    selectEl.value = s;
    if (otherInput) otherInput.value = "";
  } else if (s) {
    selectEl.value = "Other";
    if (otherInput) otherInput.value = s;
  } else selectEl.value = BILLING_PROCEDURE_OPTIONS[0];
  const isOther = selectEl.value === "Other";
  otherWrap.classList.toggle("hidden", !isOther);
}

const THEME_MAP = { cyan: "#009688", purple: "#7c3aed", blue: "#1d4ed8" };

let loadingCount = 0;
let loadingTimer = null;

function showLoading() {
  if (loadingCount === 0) {
    loadingTimer = setTimeout(() => $("#loadingOverlay")?.classList.remove("hidden"), 300);
  }
  loadingCount += 1;
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) {
    clearTimeout(loadingTimer);
    $("#loadingOverlay")?.classList.add("hidden");
  }
}

async function withLoading(fn) {
  showLoading();
  try {
    return await fn();
  } finally {
    hideLoading();
  }
}

function showToast(message, type = "success") {
  const host = $("#toastHost");
  if (!host) return;
  const t = document.createElement("div");
  t.className = `toast${type === "error" ? " error" : ""}`;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function localYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtInvoiceDateDDMMM(ts) {
  if (ts == null || ts === "") return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-GB", { month: "short" });
  const yr = d.getFullYear();
  return `${day} ${mon} ${yr}`;
}

function patientKey(p) {
  return String(p?.id || p?.external_id || p?.["Case No."] || "").trim();
}

function fmt12(timeHHMM = "") {
  if (!/^\d{2}:\d{2}$/.test(timeHHMM)) return timeHHMM || "";
  const [h, m] = timeHHMM.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

function statusBadge(status) {
  const map = {
    paid: '<span class="statusBadge status-paid">Paid</span>',
    partial: '<span class="statusBadge status-partial">Partial</span>',
    unpaid: '<span class="statusBadge status-unpaid">Unpaid</span>'
  };
  return map[(status || "unpaid").toLowerCase()] || map.unpaid;
}

function applyTheme(themeKey) {
  const key = THEME_MAP[themeKey] ? themeKey : "cyan";
  document.documentElement.style.setProperty("--accent", THEME_MAP[key]);
  localStorage.setItem("cp_theme", key);
  $$(".themeSwatch").forEach((b) => {
    const on = b.dataset.theme === key;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function setActiveNav(nav) {
  $$(".nav-btn[data-nav]").forEach((el) => el.classList.toggle("active", el.dataset.nav === nav));
  const titles = {
    home: "Home",
    patients: "Patients",
    billings: "Billings",
    settings: "Settings"
  };
  const pt = $("#pageTitle");
  if (pt) pt.textContent = titles[nav] || "Home";

  $$(".pane").forEach((s) => s.classList.remove("active"));
  const map = {
    home: "#homeSection",
    patients: "#patientsSection",
    billings: "#billingsSection",
    settings: "#settingsSection"
  };
  $(map[nav])?.classList.add("active");

  if (nav !== "patients") hidePatientProfile();
  else openPatientsSection();

  if (nav === "billings") renderClinicBilling();
}

/** Loads patients with global loading spinner; updates `cachedPatients` and list UI. */
async function refreshPatientsCache() {
  try {
    const list = await withLoading(() => window.api.patients.list());
    cachedPatients = Array.isArray(list) ? list : [];
    allPatients = cachedPatients;
    renderPatientList();
  } catch (e) {
    renderPatientList();
    throw e;
  }
}

/** Silent background refresh — keeps cached data on failure. */
async function refreshPatientsInBackground() {
  try {
    const list = await window.api.patients.list();
    cachedPatients = Array.isArray(list) ? list : [];
    allPatients = cachedPatients;
    renderPatientList();
  } catch (_) {
    /* stale cache */
  }
}

/**
 * Filter cached patients against #search value (instant, client-side only).
 */
function renderPatientList() {
  const q = String($("#search")?.value || "").toLowerCase();
  const list = $("#patientList");
  if (!list) return;
  const source = Array.isArray(allPatients) ? allPatients : [];
  const filtered = !q
    ? source
    : source.filter((p) => {
        const n = String(p.name || p["Patient Name"] || "").toLowerCase();
        const ph = String(p.phone || p.Contact || "").toLowerCase();
        const mr = String(p.external_id || p["Case No."] || "").toLowerCase();
        return n.includes(q) || ph.includes(q) || mr.includes(q);
      });

  list.innerHTML = "";
  filtered.forEach((p) => {
    const key = patientKey(p);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `patient-row${key && key === currentPatientKey ? " active" : ""}`;
    const mr = p.external_id || p["Case No."] || "";
    const nm = p.name || p["Patient Name"] || "—";
    const ph = p.phone || p.Contact || "";
    row.innerHTML = `
      <span class="patient-row__badge">${mr || "—"}</span>
      <span class="patient-row__main">
        <span class="patient-row__name">${nm}</span>
        <span class="patient-row__phone">${ph || ""}</span>
      </span>
      <span class="patient-row__chevron" aria-hidden="true">›</span>`;
    row.onclick = () => openProfile(p);
    list.appendChild(row);
  });
  if (!filtered.length) list.innerHTML = '<p class="patientSmall">No patients found.</p>';
}

function openPatientsSection() {
  showPatientBrowse();
  const sb = $("#search");
  if (sb) sb.placeholder = "Search by name, phone, or MR number...";
  if (cachedPatients !== null) {
    allPatients = cachedPatients;
    renderPatientList();
    refreshPatientsInBackground();
  } else {
    refreshPatientsCache().catch(() => {
      renderPatientList();
      showToast("Could not load patients", "error");
    });
  }
}

function showPatientBrowse() {
  $("#patientBrowse")?.classList.remove("hidden");
  $("#patientProfileView")?.classList.add("hidden");
}

function hidePatientBrowse() {
  $("#patientBrowse")?.classList.add("hidden");
  $("#patientProfileView")?.classList.remove("hidden");
}

function hidePatientProfile() {
  showPatientBrowse();
}

async function openProfile(p) {
  currentPatient = (await withLoading(() => window.api.patients.get(p.id || p.external_id))) || p;
  currentPatientKey = patientKey(currentPatient);
  $("#profileName").textContent = currentPatient.name || currentPatient["Patient Name"] || "Unnamed";
  $("#profileInfo").textContent = `${currentPatient.external_id || "—"} · ${currentPatient.phone || "—"}`;
  hidePatientBrowse();
  await openTab("profile");
  renderPatientList();
}

async function openTab(tab) {
  $$("#patientTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  const c = $("#tabContent");
  c.innerHTML = "";
  if (tab === "profile") {
    c.innerHTML = `
      <p><b>Case No:</b> ${currentPatient.external_id || "—"}</p>
      <p><b>Name:</b> ${currentPatient.name || "—"}</p>
      <p><b>Phone:</b> ${currentPatient.phone || "—"}</p>
      <p><b>Address:</b> ${currentPatient.address || "—"}</p>
      <p><b>Age:</b> ${currentPatient.age || "—"}</p>
      <p><b>Gender:</b> ${currentPatient.gender || "—"}</p>`;
    return;
  }
  if (tab === "soap") {
    const pid = currentPatient.id || currentPatient.external_id;
    c.innerHTML =
      '<textarea id="soapText" class="note"></textarea><button type="button" id="soapSave" class="btn btn-primary" style="margin-top:8px">Add Note</button><div id="soapList" style="margin-top:12px"></div>';
    const render = async () => {
      const notes = await withLoading(() => window.api.notes.list(pid));
      const sl = $("#soapList");
      sl.innerHTML = "";
      notes.forEach((n) => {
        const r = document.createElement("div");
        r.className = "soap-note-row";
        r.innerHTML = `<div>${new Date(n.at).toLocaleString()}: ${n.text}</div><button type="button" class="btn btn-danger btn-small">×</button>`;
        r.querySelector("button").onclick = async () => {
          await window.api.notes.delete({ patient_id: pid, note_id: n.id });
          showToast("Note deleted");
          render();
        };
        sl.appendChild(r);
      });
    };
    $("#soapSave").onclick = async () => {
      const text = ($("#soapText").value || "").trim();
      if (!text) return;
      await window.api.notes.add({ patient_id: pid, text });
      $("#soapText").value = "";
      showToast("Note saved");
      render();
    };
    await render();
    return;
  }
  await renderPatientBilling();
}

async function renderPatientBilling() {
  const pid = currentPatient.id || currentPatient.external_id;
  const c = $("#tabContent");
  const d = localYMD(new Date());
  c.innerHTML = `
    <div class="invoice-block">
      <div class="billing-add-form">
        <div class="billing-add-row">
          <input id="bDate" type="date" value="${d}">
          <select id="bProcedure" class="billing-select" aria-label="Procedure">${billingProcedureOptionTags()}</select>
          <input id="bCost" type="number" placeholder="Total Cost" style="max-width:120px;">
          <input id="bLab" type="number" placeholder="Lab Cost" style="max-width:120px;">
          <button type="button" id="addInvoiceBtn" class="btn btn-primary">+ Add Invoice</button>
        </div>
        <div id="bProcedureOtherWrap" class="billing-other-row hidden">
          <input id="bProcedureOther" type="text" class="billing-other-input" placeholder="Custom procedure name">
        </div>
        <textarea id="bNotes" class="billing-notes" placeholder="Treatment notes, observations..." rows="3"></textarea>
      </div>
      <div id="billingList"></div>
    </div>`;
  wireBillingProcedureOtherToggle(c, "#bProcedure", "#bProcedureOtherWrap", "#bProcedureOther");

  $("#addInvoiceBtn").onclick = async () => {
    const procedure = readProcedureChoice($("#bProcedure"), $("#bProcedureOther"));
    if (!procedure) return showToast("Procedure is required", "error");
    const notes = ($("#bNotes").value || "").trim();
    await window.api.invoices.add({
      patient_id: pid,
      procedure,
      cost: Number($("#bCost").value || 0),
      lab_cost: Number($("#bLab").value || 0),
      created_at: new Date(($("#bDate").value || d) + "T00:00:00").getTime(),
      notes
    });
    showToast("Invoice added");
    renderPatientBilling();
  };

  const [invoices, payments] = await withLoading(() =>
    Promise.all([window.api.invoices.list(pid), window.api.payments.list({ patient_id: pid })])
  );
  const list = $("#billingList");
  list.innerHTML = "";
  if (!invoices.length) {
    list.innerHTML = '<p class="patientSmall">No invoices yet.</p>';
    return;
  }

  invoices.forEach((inv) => {
    const invPayments = payments.filter((p) => Number(p.invoice_id) === Number(inv.id));
    const paid = invPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const due = Math.max(0, Number(inv.cost || 0) - paid);
    const card = document.createElement("div");
    card.className = "invoice-block";
    const notesHtml = inv.notes
      ? `<p class="patientSmall invoice-notes-line" style="margin:6px 0 0;line-height:1.4">${escapeHtml(inv.notes)}</p>`
      : "";
    card.innerHTML = `
      <div class="pane-head" style="margin-bottom:8px;"><b>${escapeHtml(inv.procedure || "")}</b>${statusBadge(inv.status)}<span class="patientSmall">${fmtInvoiceDateDDMMM(inv.created_at)}</span></div>${notesHtml}
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;font-size:0.875rem;">
        <span>Total: ${Number(inv.cost || 0).toLocaleString()}</span><span>Lab: ${Number(inv.lab_cost || 0).toLocaleString()}</span>
        <span>Paid: ${paid.toLocaleString()}</span><span>Due: ${due.toLocaleString()}</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button type="button" class="btn btn-primary btn-small addPay">+ Payment</button>
        <button type="button" class="btn btn-secondary btn-small editInv">Edit</button>
        <button type="button" class="btn btn-danger btn-small delInv">Delete</button>
      </div>
      <div class="table-scroll">
        <table class="billing-table"><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th></th></tr></thead><tbody></tbody></table>
      </div>`;
    const tb = card.querySelector("tbody");
    invPayments
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${p.date}</td><td>${Number(p.amount).toLocaleString()}</td><td>${p.payment_mode || ""}</td><td><button type="button" class="btn btn-danger btn-small">×</button></td>`;
        tr.querySelector("button").onclick = async () => {
          await window.api.payments.delete(p.id, inv.id);
          showToast("Payment deleted");
          renderPatientBilling();
        };
        tb.appendChild(tr);
      });
    card.querySelector(".addPay").onclick = () => openPaymentModal(inv, pid, renderPatientBilling);
    card.querySelector(".editInv").onclick = () => openEditInvoiceModal(inv, renderPatientBilling);
    card.querySelector(".delInv").onclick = async () => {
      if (!confirm("Delete this invoice and all its payments?")) return;
      for (const p of invPayments) await window.api.payments.delete(p.id, inv.id);
      await window.api.invoices.delete(inv.id);
      showToast("Invoice deleted");
      renderPatientBilling();
    };
    list.appendChild(card);
  });
}

/** Map MR / Case No / internal id strings to patient display name for clinic billing rows. */
function buildBillingPatientLookup(patients) {
  const map = new Map();
  for (const p of patients || []) {
    const name = (p.name || p["Patient Name"] || "").trim();
    const register = (k) => {
      const key = String(k ?? "").trim();
      if (!key || !name) return;
      if (!map.has(key)) map.set(key, name);
    };
    register(p.external_id);
    register(p.id);
    register(p["Case No."]);
  }
  return map;
}

async function renderClinicBilling() {
  const monthEl = $("#billingMonth");
  if (monthEl && !monthEl.value) {
    const n = new Date();
    monthEl.value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  }
  const ym = monthEl?.value || "";

  const [invoices, payments, patients] = await withLoading(() =>
    Promise.all([window.api.invoices.all(), window.api.payments.all(), window.api.patients.list()])
  );

  const pMap = buildBillingPatientLookup(patients);
  const payByInvoice = (payments || []).reduce((m, p) => {
    const raw = p.invoice_id;
    const num = Number(raw);
    const key = Number.isFinite(num) ? num : String(raw ?? "");
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(p);
    return m;
  }, new Map());

  const invoicePaymentsFor = (inv) => {
    const raw = inv.id;
    const num = Number(raw);
    const key = Number.isFinite(num) ? num : String(raw ?? "");
    return payByInvoice.get(key) || [];
  };

  const filteredInvoices = (invoices || []).filter((inv) => {
    if (billingAllTime) return true;
    const d = inv.created_at ? localYMD(new Date(inv.created_at)) : "";
    return ym ? d.startsWith(ym) : true;
  });

  const rows = filteredInvoices
    .map((inv) => {
      const invPays = invoicePaymentsFor(inv);
      const paid = invPays.reduce((s, p) => s + Number(p.amount || 0), 0);
      const total = Number(inv.cost || 0);
      const due = Math.max(0, total - paid);
      const tol = 1e-6;
      const status = paid <= tol ? "unpaid" : paid + tol >= total ? "paid" : "partial";
      const pidStr = String(inv.patient_id ?? "").trim();
      return {
        sortTs: inv.created_at ? Number(inv.created_at) : 0,
        dateLabel: fmtInvoiceDateDDMMM(inv.created_at),
        mr: pidStr,
        name: pMap.get(pidStr) || "—",
        procedure: inv.procedure || "",
        total,
        paid,
        due,
        status
      };
    })
    .sort((a, b) => b.sortTs - a.sortTs);

  let sumInvoiced = 0;
  rows.forEach((r) => {
    sumInvoiced += r.total;
  });

  const paymentsInPeriod = (payments || []).filter((p) => {
    if (billingAllTime) return true;
    const pd = String(p.date || "");
    return ym ? pd.startsWith(ym) : true;
  });
  const sumCollected = paymentsInPeriod.reduce((s, p) => s + Number(p.amount || 0), 0);
  const sumOutstanding = sumInvoiced - sumCollected;

  const invEl = $("#billingSummaryInvoiced");
  const colEl = $("#billingSummaryCollected");
  const outEl = $("#billingSummaryOutstanding");
  const fmt = (n) => Number(n || 0).toLocaleString();
  if (invEl) invEl.textContent = rows.length ? fmt(sumInvoiced) : "—";
  if (colEl) colEl.textContent = rows.length ? fmt(sumCollected) : "—";
  if (outEl) outEl.textContent = rows.length ? fmt(sumOutstanding) : "—";

  const body = $("#clinicBillingBody");
  if (!body) return;
  body.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.dateLabel}</td><td>${escapeHtml(r.mr)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.procedure)}</td><td>${r.total.toLocaleString()}</td><td>${r.paid.toLocaleString()}</td><td>${r.due.toLocaleString()}</td><td>${statusBadge(r.status)}</td>`;
    body.appendChild(tr);
  });
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="patientSmall">No billing records for selected period.</td></tr>';
  }
}

async function drawCalendar() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  $("#monthLabel").textContent = `${currentMonth.toLocaleString("default", { month: "long" })} ${year}`;
  $("#dayLabels").innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    .map((d) => `<div class="day">${d}</div>`)
    .join("");
  const grid = $("#calGrid");
  grid.innerHTML = "";
  const firstDay = new Date(year, month, 1);
  const start = (firstDay.getDay() + 6) % 7;
  const dim = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < start; i += 1) grid.innerHTML += '<div class="cell empty"></div>';
  const appts = await withLoading(() => window.api.appts.list(ym));
  for (let d = 1; d <= dim; d += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = `<div class="date">${d}</div>`;
    const ds = `${ym}-${String(d).padStart(2, "0")}`;
    appts
      .filter((a) => a.date === ds)
      .forEach((a) => {
        const div = document.createElement("div");
        div.className = `appt status-${(a.status || "yellow").toLowerCase()}`;
        div.textContent = `${a.patient_name || ""} ${fmt12(a.time || "")} — ${a.procedure || ""}`;
        div.onclick = () => openApptModal(a);
        cell.appendChild(div);
      });
    grid.appendChild(cell);
  }
}

function openPaymentModal(inv, patient_id, onSave) {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-content">
    <h3>Record Payment</h3>
    <label>Payment Date</label><input id="pDate" type="date" value="${localYMD(new Date())}">
    <label>Amount</label><input id="pAmount" type="number" min="1">
    <label>Mode</label><select id="pMode"><option>Cash</option><option>Bank Transfer</option></select>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" id="pCancel" class="btn btn-secondary">Cancel</button>
      <button type="button" id="pSave" class="btn btn-primary">Save Payment</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector("#pCancel").onclick = () => ov.remove();
  ov.querySelector("#pSave").onclick = async () => {
    const date = ov.querySelector("#pDate").value;
    const amount = Number(ov.querySelector("#pAmount").value || 0);
    if (!date || !amount) return showToast("Date and amount required", "error");
    await window.api.payments.add({
      invoice_id: inv.id,
      patient_id,
      date,
      amount,
      payment_mode: ov.querySelector("#pMode").value
    });
    showToast("Payment saved");
    ov.remove();
    onSave?.();
  };
}

function openEditInvoiceModal(inv, onSave) {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-content modal-content--billing">
    <h3>Edit Invoice #${inv.id}</h3>
    <label>Date</label><input id="eDate" type="date" value="${localYMD(new Date(inv.created_at))}">
    <label>Procedure</label>
    <select id="eProcedure" class="billing-select">${billingProcedureOptionTags()}</select>
    <div id="eProcedureOtherWrap" class="billing-other-row hidden">
      <input id="eProcedureOther" type="text" class="billing-other-input" placeholder="Custom procedure name">
    </div>
    <label>Total Cost</label><input id="eCost" type="number" value="${Number(inv.cost || 0)}">
    <label>Lab Cost</label><input id="eLab" type="number" value="${Number(inv.lab_cost || 0)}">
    <label>Notes</label>
    <textarea id="eNotes" class="billing-notes" placeholder="Treatment notes, observations..." rows="3"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" id="eCancel" class="btn btn-secondary">Cancel</button>
      <button type="button" id="eSave" class="btn btn-primary">Save</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const mc = ov.querySelector(".modal-content");
  applyStoredProcedure(ov.querySelector("#eProcedure"), ov.querySelector("#eProcedureOtherWrap"), ov.querySelector("#eProcedureOther"), inv.procedure || "");
  wireBillingProcedureOtherToggle(mc, "#eProcedure", "#eProcedureOtherWrap", "#eProcedureOther");
  ov.querySelector("#eNotes").value = inv.notes ?? "";
  ov.querySelector("#eCancel").onclick = () => ov.remove();
  ov.querySelector("#eSave").onclick = async () => {
    const sel = ov.querySelector("#eProcedure");
    const otherIn = ov.querySelector("#eProcedureOther");
    const procedure = readProcedureChoice(sel, otherIn);
    if (!procedure) return showToast("Procedure is required", "error");
    const notes = (ov.querySelector("#eNotes").value || "").trim();
    await window.api.invoices.update({
      id: inv.id,
      created_at: new Date(`${ov.querySelector("#eDate").value}T00:00:00`).getTime(),
      procedure,
      cost: Number(ov.querySelector("#eCost").value || 0),
      lab_cost: Number(ov.querySelector("#eLab").value || 0),
      notes
    });
    showToast("Invoice updated");
    ov.remove();
    onSave?.();
  };
}

function openApptModal(a) {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-content">
    <h3>Appointment</h3>
    <p><b>Case:</b> ${a.patient_id || "—"}</p>
    <p><b>Name:</b> ${a.patient_name || "—"}</p>
    <p><b>Date:</b> ${new Date(a.date).toLocaleDateString()}</p>
    <p><b>Time:</b> ${fmt12(a.time || "")}</p>
    <label>Status Color</label>
    <select id="statusSel" style="width:100%;min-height:44px;">
      <option value="yellow">Yellow — Scheduled</option>
      <option value="blue">Blue — In Progress</option>
      <option value="green">Green — Fulfilled</option>
      <option value="red">Red — Cancelled</option>
    </select>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" id="delBtn" class="btn btn-danger">Delete</button>
      <button type="button" id="closeBtn" class="btn btn-secondary">Close</button>
      <button type="button" id="saveBtn" class="btn btn-primary">Save</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector("#statusSel").value = a.status || "yellow";
  ov.querySelector("#closeBtn").onclick = () => ov.remove();
  ov.querySelector("#delBtn").onclick = async () => {
    if (!confirm("Delete this appointment?")) return;
    await window.api.appts.delete(a.id);
    showToast("Appointment deleted");
    ov.remove();
    drawCalendar();
  };
  ov.querySelector("#saveBtn").onclick = async () => {
    await window.api.appts.update({ id: a.id, status: ov.querySelector("#statusSel").value });
    showToast("Appointment updated");
    ov.remove();
    drawCalendar();
  };
}

async function openDrawer(type, patient = null) {
  $("#drawerTitle").textContent = type === "patient" ? (patient ? "Edit Patient" : "New Patient") : "New Appointment";
  const dr = $("#drawer");
  const c = $("#drawerContent");
  c.innerHTML = "";
  if (type === "patient") {
    dr.dataset.editId = patient?.id || "";
    c.innerHTML = `
      <label>Case No</label><input id="pCaseNo" placeholder="Leave blank for auto">
      <label>Name</label><input id="pName">
      <label>Age</label><input id="pAge">
      <label>Gender</label><input id="pGender">
      <label>Phone</label><input id="pPhone">
      <label>Address</label><input id="pAddress">`;
    if (patient) {
      $("#pCaseNo").value = patient.external_id || "";
      $("#pName").value = patient.name || "";
      $("#pAge").value = patient.age || "";
      $("#pGender").value = patient.gender || "";
      $("#pPhone").value = patient.phone || "";
      $("#pAddress").value = patient.address || "";
    }
  } else {
    const plist = await withLoading(() => window.api.patients.list(""));
    c.innerHTML = `
      <label>Patient</label>
      <select id="aPatientSelect">${plist.map((p) => `<option value="${p.id || p.external_id}" data-name="${(p.name || "").replace(/"/g, "&quot;")}">${p.external_id || ""} — ${p.name || ""}</option>`).join("")}</select>
      <label>Doctor</label><input id="aDoctor">
      <label>Procedure</label><input id="aProcedure">
      <label>Date</label><input id="aDate" type="date" value="${localYMD(new Date())}">
      <label>Time</label><input id="aTime" type="time" value="${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}">`;
  }
  dr.dataset.type = type;
  dr.classList.remove("hidden");
  dr.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  const dr = $("#drawer");
  dr.classList.add("hidden");
  dr.setAttribute("aria-hidden", "true");
}

async function saveDrawer() {
  const type = $("#drawer").dataset.type;
  if (type === "patient") {
    const p = {
      id: $("#drawer").dataset.editId || undefined,
      external_id: ($("#pCaseNo").value || "").trim() || undefined,
      name: $("#pName").value || "",
      age: $("#pAge").value || "",
      gender: $("#pGender").value || "",
      phone: $("#pPhone").value || "",
      address: $("#pAddress").value || ""
    };
    if (!p.name.trim()) return showToast("Name is required", "error");
    await window.api.patients.save(p);
    showToast("Patient saved");
    closeDrawer();
    await refreshPatientsCache();
    renderPatientList();
  } else {
    const sel = $("#aPatientSelect");
    if (!sel?.value) return showToast("Select patient", "error");
    await window.api.appts.add({
      doctor: $("#aDoctor").value || "",
      patient_id: sel.value,
      patient_name: sel.options[sel.selectedIndex]?.dataset?.name || "",
      procedure: $("#aProcedure").value || "",
      date: $("#aDate").value,
      time: $("#aTime").value,
      status: "yellow"
    });
    showToast("Appointment added");
    closeDrawer();
    drawCalendar();
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  applyTheme(localStorage.getItem("cp_theme") || "cyan");
  const m = new Date();
  $("#billingMonth").value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;

  $$(".nav-btn[data-nav]").forEach((el) => (el.onclick = () => setActiveNav(el.dataset.nav)));

  $("#prevMonth").onclick = () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    drawCalendar();
  };
  $("#nextMonth").onclick = () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    drawCalendar();
  };
  $("#newPatient").onclick = () => openDrawer("patient");
  $("#addAppt").onclick = () => openDrawer("appt");
  $("#drawerClose").onclick = closeDrawer;
  $("#drawerSave").onclick = saveDrawer;
  $("#search").addEventListener("input", () => renderPatientList());
  $("#backToPatients").onclick = () => {
    hidePatientProfile();
    renderPatientList();
  };
  $$("#patientTabs .tab").forEach((t) => (t.onclick = () => openTab(t.dataset.tab)));

  $("#billingMonth").onchange = renderClinicBilling;
  $("#billingAllTime").onclick = () => {
    billingAllTime = !billingAllTime;
    const btn = $("#billingAllTime");
    btn.classList.toggle("active", billingAllTime);
    btn.textContent = billingAllTime ? "All Time (on)" : "All Time";
    renderClinicBilling();
  };
  $("#downloadPdf").onclick = () => {
    const ph = $("#printPageHeader");
    const ym = $("#billingMonth").value;
    if (ph) {
      ph.textContent = billingAllTime
        ? "ClinicPilot — Faseeh Dental Clinic | All periods"
        : `ClinicPilot — Faseeh Dental Clinic | ${ym}`;
    }
    window.print();
  };
  $("#backupDataBtn").onclick = async () => {
    try {
      const res = await withLoading(() => window.api.patients.syncSheets());
      if (res?.ok === false) throw new Error(res.error || "Backup failed");
      showToast(
        typeof res?.count === "number" ? `Backup completed (${res.count} rows)` : "Backup completed"
      );
    } catch (e) {
      showToast(`Backup failed: ${e.message}`, "error");
    }
  };
  $("#deleteAllPatients").onclick = async () => {
    if (!confirm("Delete ALL patients? This cannot be undone.")) return;
    await withLoading(() => window.api.patients.deleteAll());
    showToast("All patients deleted");
    await refreshPatientsCache();
    renderPatientList();
  };
  $("#editPatient").onclick = async () => {
    if (!currentPatient) return;
    const p = await withLoading(() => window.api.patients.get(currentPatient.id || currentPatient.external_id));
    openDrawer("patient", p || currentPatient);
  };
  $("#deletePatient").onclick = async () => {
    if (!currentPatient) return;
    if (!confirm(`Delete ${currentPatient.name || "this patient"}?`)) return;
    await window.api.patients.delete(currentPatient.id || currentPatient.external_id);
    showPatientBrowse();
    showToast("Patient deleted");
    await refreshPatientsCache();
    renderPatientList();
  };

  $$(".themeSwatch").forEach((el) => {
    el.onclick = () => applyTheme(el.dataset.theme);
  });

  $("#billingAllTime").textContent = "All Time";

  await Promise.all([drawCalendar(), renderClinicBilling()]);
  setActiveNav("home");
});
