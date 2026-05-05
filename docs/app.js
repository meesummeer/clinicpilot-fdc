const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentMonth = new Date();
let currentPatient = null;
let currentPatientKey = null;
/** Last successful `patients.list()` result; null until first fetch completes */
let cachedPatients = null;
let allPatients = [];
let billingAllTime = false;

/** Cached patient billing payloads for optimistic list updates between refetches */
let billingDataCache = { pid: null, invoices: [], payments: [] };

let savingPeekCount = 0;

function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB");
}

function displayDateTs(ts) {
  if (ts == null || ts === "") return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDate(d);
}

/** Display ISO date-only strings like YYYY-MM-DD as DD/MM/YYYY without TZ shift issues. */
function displayDateYYYYMMDD(raw) {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatDate(s);
}

function pkMoney(n) {
  return `PKR ${Number(n || 0).toLocaleString()}`;
}

function patientDisplayName(p) {
  return (p?.name || p?.["Patient Name"] || "").trim() || "—";
}

/** wa.me phone: leading 0 → 92 (e.g. 03… → 923…). Keeps leading 92 as-is. */
function waDigitsFromPakistanPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("92")) return d;
  if (d.startsWith("0")) return `92${d.slice(1)}`;
  return `92${d}`;
}

function whatsappInvoiceMessage(patientName) {
  return `Hi ${patientName}, here's your invoice from your visit at Faseeh Dental Clinic. Thank you!`;
}

function runInvoiceCustomerPdfPrint(inv, paid, due) {
  const wrap = document.createElement("div");
  wrap.innerHTML = buildCustomerCopyInvoiceHtml(inv, paid, due);
  const sheet = wrap.firstElementChild;
  if (!sheet) return;
  document.body.appendChild(sheet);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    sheet.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 2000);
}

function buildCustomerCopyInvoiceHtml(inv, paid, due) {
  const pt = currentPatient || {};
  const invoiceId = escapeHtml(String(inv?.id ?? "—"));
  const date = escapeHtml(displayDateTs(inv?.created_at));
  const patientName = escapeHtml(patientDisplayName(pt));
  const patientId = escapeHtml(String(pt.external_id ?? pt["Case No."] ?? pt.id ?? "").trim() || "—");
  const phoneRaw = String(pt.phone ?? pt.Contact ?? "").trim();
  const phone = phoneRaw ? escapeHtml(phoneRaw) : "—";
  const genderRaw = String(pt.gender ?? pt.Gender ?? "").trim();
  const gender = genderRaw ? escapeHtml(genderRaw) : "—";
  const procedure = escapeHtml(String(inv?.procedure ?? "").trim() || "—");
  const costN = Number(inv?.cost || 0);
  const paidN = Number(paid || 0);
  const dueN = Math.max(0, Number(due ?? 0));
  const costStr = costN.toLocaleString();
  const paidStr = paidN.toLocaleString();
  const dueStr = dueN.toLocaleString();
  const dueColor = dueN > 0 ? "#c62828" : "#2e7d32";
  const dueDisplay = dueN > 0 ? `PKR ${dueStr}` : "Paid in Full";
  const dueTotalsRowStyle = dueN > 0 ? "color:#c62828;" : "";
  return `
<div id="invoice-print-area" style="font-family: Arial, sans-serif; background: white; padding: 40px; max-width: 700px; margin: 0 auto; color: #222;">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
    <div>
      <img src="/clinicpilot-fdc/fdc-logo.png" style="height:70px; width:auto;">
    </div>
    <div style="text-align:right;">
      <div style="font-size:36px; font-weight:900; color:#2d3748; letter-spacing:2px;">INVOICE</div>
      <div style="font-size:16px; color:#666;"># ${invoiceId}</div>
    </div>
  </div>

  <hr style="border:none; border-top:2px solid #009688; margin:0 0 16px 0;">

  <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
    <div>
      <div style="font-weight:700; font-size:15px;">Dr. Faseeh Ur Rehman</div>
      <div style="color:#555; font-size:13px;">Dentist</div>
      <div style="color:#555; font-size:13px;">BDS | RDS</div>
    </div>
    <div style="text-align:right;">
      <div style="color:#555; font-size:13px;">Date:</div>
      <div style="font-weight:600; font-size:14px;">${date}</div>
    </div>
  </div>

  <div style="background:#f0f0f0; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-radius:4px;">
    <span style="font-weight:700; font-size:14px;">Balance Due:</span>
    <span style="font-weight:700; font-size:16px; color:${dueColor};">${dueDisplay}</span>
  </div>

  <div style="margin-bottom:20px;">
    <div style="color:#888; font-size:12px; margin-bottom:6px;">Patient Information:</div>
    <div style="font-weight:700; font-size:15px;">Name: ${patientName}</div>
    <div style="font-size:13px; color:#444;">MR#: ${patientId}</div>
    <div style="font-size:13px; color:#444;">Phone: ${phone}</div>
    <div style="font-size:13px; color:#444;">Gender: ${gender}</div>
  </div>

  <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
    <thead>
      <tr style="background:#2d3748; color:white;">
        <th style="padding:10px 12px; text-align:left; font-size:13px;">Procedure</th>
        <th style="padding:10px 12px; text-align:center; font-size:13px;">Quantity</th>
        <th style="padding:10px 12px; text-align:right; font-size:13px;">Rate</th>
        <th style="padding:10px 12px; text-align:right; font-size:13px;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background:#f9f9f9;">
        <td style="padding:10px 12px; font-weight:600; font-size:13px;">${procedure}</td>
        <td style="padding:10px 12px; text-align:center; font-size:13px;">1</td>
        <td style="padding:10px 12px; text-align:right; font-size:13px;">PKR ${costStr}</td>
        <td style="padding:10px 12px; text-align:right; font-size:13px;">PKR ${costStr}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex; justify-content:flex-end; margin-bottom:24px;">
    <div style="text-align:right; min-width:200px;">
      <div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;">
        <span style="color:#555; margin-right:40px;">Total:</span>
        <span style="font-weight:600;">PKR ${costStr}</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;">
        <span style="color:#555; margin-right:40px;">Paid:</span>
        <span style="font-weight:600; color:#2e7d32;">PKR ${paidStr}</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; ${dueTotalsRowStyle}">
        <span style="margin-right:40px;">Due:</span>
        <span style="font-weight:700;">PKR ${dueStr}</span>
      </div>
    </div>
  </div>

  <hr style="border:none; border-top:1px solid #ddd; margin-bottom:12px;">
  <div style="font-size:12px; color:#666;">
    <div>Phone: +923211507943</div>
    <div>Email: faseehdentalclinic@gmail.com</div>
    <div>Location: Shop 2, L-11 Block-17, Gulshan-e-Iqbal, Karachi</div>
  </div>
</div>`;
}

function openCustomerCopyModal(inv, paid, due) {
  const invoiceHtml = buildCustomerCopyInvoiceHtml(inv, paid, due);
  const overlay = document.createElement("div");
  overlay.className = "invoice-copy-overlay";
  overlay.innerHTML = `
    <div class="invoice-copy-modal" role="dialog" aria-label="Customer copy invoice preview">
      <button type="button" class="invoice-copy-x" aria-label="Close">&times;</button>
      <div class="invoice-copy-modal-body">${invoiceHtml}</div>
      <div class="invoice-copy-modal-actions">
        <button type="button" class="btn invoice-copy-btn-pdf">Open PDF</button>
        <button type="button" class="btn invoice-copy-btn-wa">Send via WhatsApp</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".invoice-copy-x").onclick = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".invoice-copy-btn-pdf").onclick = () => runInvoiceCustomerPdfPrint(inv, paid, due);
  overlay.querySelector(".invoice-copy-btn-wa").onclick = (e) =>
    sendCustomerInvoiceWhatsApp(inv, paid, due, e.currentTarget);
}

async function sendCustomerInvoiceWhatsApp(_inv, _paid, _due, triggerBtn) {
  const pt = currentPatient || {};
  const name = patientDisplayName(pt);
  const rawPhone = pt.phone ?? pt.Contact ?? "";
  const digits = waDigitsFromPakistanPhone(rawPhone);
  if (!digits) {
    showToast("No phone number on file for this patient", "error");
    return;
  }
  const invoiceEl = document.querySelector(".invoice-copy-modal-body #invoice-print-area");
  if (!invoiceEl) {
    showToast("Invoice preview is not available", "error");
    return;
  }
  if (typeof window.html2canvas !== "function") {
    showToast("Screenshot library not loaded", "error");
    return;
  }

  const btn = triggerBtn || null;
  const originalText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparing...";
  }

  try {
    const canvas = await window.html2canvas(invoiceEl, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG generation failed");

    const safeName = name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "Patient";
    const href = URL.createObjectURL(blob);
    const dl = document.createElement("a");
    dl.href = href;
    dl.download = `Invoice-${safeName}.png`;
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    URL.revokeObjectURL(href);

    const msg = whatsappInvoiceMessage(name);
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    setTimeout(() => window.open(url, "_blank", "noopener,noreferrer"), 800);
  } catch (_) {
    showToast("Could not prepare invoice image", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || "Send via WhatsApp";
    }
  }
}

function ensureSavingPeekEl() {
  let el = document.getElementById("savingPeek");
  if (!el) {
    el = document.createElement("div");
    el.id = "savingPeek";
    el.className = "saving-peek";
    el.setAttribute("aria-live", "polite");
    el.textContent = "Saving…";
    document.body.appendChild(el);
  }
  return el;
}

function showSavingPeek() {
  savingPeekCount += 1;
  ensureSavingPeekEl().classList.add("visible");
}

function hideSavingPeek() {
  savingPeekCount = Math.max(0, savingPeekCount - 1);
  if (savingPeekCount === 0) ensureSavingPeekEl().classList.remove("visible");
}

async function reloadPatientBillingQuiet() {
  const pid = currentPatient?.id ?? currentPatient?.external_id;
  if (!pid || !$("#billingList")) return;
  try {
    const [inv, pay] = await Promise.all([
      window.api.invoices.list(pid),
      window.api.payments.list({ patient_id: pid })
    ]);
    billingDataCache = { pid, invoices: inv || [], payments: pay || [] };
    paintBillingInvoiceCards();
  } catch (_) {
    /* optimistic path may continue */
  }
}

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
  return BILLING_PROCEDURE_OPTIONS.map((p) => `<option value="${p}">`).join("");
}

/** Selected procedure label from input/datalist (free-typed allowed). */
function readProcedureChoice(inputEl) {
  return (inputEl?.value || "").trim();
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
    const swatchTheme = b.dataset.theme;
    const on = swatchTheme === key;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    const dot = b.querySelector(".themeSwatch-dot");
    if (dot) {
      const accent = THEME_MAP[swatchTheme] || THEME_MAP.cyan;
      dot.style.boxShadow = on ? `0 0 0 3px var(--bg, #f1f5f9), 0 0 0 6px ${accent}` : "none";
    }
  });
}

/** Build Settings pane (Markup + IDs) — index.html untouched; avoids stylesheet edits for circle swatches. */
function mountSettingsSection() {
  const sec = $("#settingsSection");
  if (!sec) return;
  const swatchBtn = (id, hex, label) =>
    `<button type="button" class="themeSwatch" data-theme="${id}" aria-pressed="false" style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;border:none;background:transparent;cursor:pointer;padding:10px;font:inherit;color:inherit;font-weight:600;font-size:0.875rem">
      <span class="themeSwatch-dot" style="display:block;width:48px;height:48px;border-radius:50%;background:${hex};flex-shrink:0;margin:2px;"></span>
      <span>${label}</span>
    </button>`;
  sec.innerHTML = `
    <div class="card settings-block">
      <h3 class="settings-block-title">App Theme</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">${swatchBtn("cyan", "#009688", "Cyan")}${swatchBtn("purple", "#7c3aed", "Purple")}${swatchBtn("blue", "#1d4ed8", "Blue")}</div>
    </div>
    <div class="card settings-block">
      <h3 class="settings-block-title">Backup to Google Sheets</h3>
      <p class="settings-desc">Export all patient and billing data to Google Sheets.</p>
      <button type="button" id="backupDataBtn" class="btn btn-primary">Run Backup</button>
    </div>
    <div class="card settings-block" style="border-left:4px solid #dc2626">
      <h3 class="settings-block-title danger-t">Danger Zone</h3>
      <button type="button" id="deleteAllPatients" class="btn btn-danger">Delete All Patients</button>
    </div>`;
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
        r.innerHTML = `<div>${displayDateTs(n.at)} ${new Date(n.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}: ${escapeHtml(n.text)}</div><button type="button" class="btn btn-danger btn-small">×</button>`;
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

function paintBillingInvoiceCards() {
  const pid = currentPatient?.id ?? currentPatient?.external_id;
  const list = $("#billingList");
  if (!list) return;
  if (!billingDataCache.pid || billingDataCache.pid !== pid) {
    list.innerHTML = '<p class="patientSmall">Loading…</p>';
    return;
  }

  const { invoices, payments } = billingDataCache;
  list.innerHTML = "";
  if (!invoices.length) {
    list.innerHTML = '<p class="patientSmall">No invoices yet.</p>';
    return;
  }

  invoices.forEach((inv) => {
    const invPayments = payments.filter((p) => String(p.invoice_id) === String(inv.id));
    const paid = invPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const total = Number(inv.cost || 0);
    const due = Math.max(0, total - paid);
    const card = document.createElement("div");
    card.className = "invoice-block";
    const synced = !inv.__optimistic;
    const notesHtml = inv.notes
      ? `<p class="patientSmall invoice-notes-line" style="margin:6px 0 0;line-height:1.4">${escapeHtml(inv.notes)}</p>`
      : "";
    const actionsHtml = synced
      ? `<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-small addPay">+ Payment</button>
        <button type="button" class="btn btn-secondary btn-small editInv">Edit</button>
        <button type="button" class="btn btn-danger btn-small delInv">Delete</button>
        <button type="button" class="btn btn-secondary btn-small billing-customer-copy">Customer Copy</button>
      </div>`
      : `<p class="patientSmall" style="margin-bottom:8px;">Saving invoice…</p>`;
    card.innerHTML = `
      <div class="pane-head" style="margin-bottom:8px;"><b>${escapeHtml(inv.procedure || "")}</b>${synced ? statusBadge(inv.status) : ""}<span class="patientSmall">${displayDateTs(inv.created_at)}</span></div>${notesHtml}
      <div style="display:flex;flex-wrap:wrap;gap:8px 10px;margin-bottom:8px;font-size:12px;">
        <span>Total: ${Number(inv.cost || 0).toLocaleString()}</span>
        <span>Paid: ${paid.toLocaleString()}</span><span>Due: ${due.toLocaleString()}</span>
      </div>
      ${actionsHtml}
      <div class="table-scroll">
        <table class="billing-table billing-payments-table"><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th></th></tr></thead><tbody></tbody></table>
      </div>`;
    const tb = card.querySelector("tbody");
    invPayments
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach((p) => {
        const tr = document.createElement("tr");
        const tail = p.__optimistic ? "<td></td>" : '<td><button type="button" class="btn btn-danger btn-small">×</button></td>';
        tr.innerHTML = `<td>${displayDateYYYYMMDD(p.date)}</td><td>${Number(p.amount).toLocaleString()}</td><td>${escapeHtml(String(p.payment_mode || ""))}</td>${tail}`;
        const delBtn = tr.querySelector("button");
        if (delBtn && !p.__optimistic) {
          delBtn.onclick = async () => {
            await window.api.payments.delete(p.id, inv.id);
            showToast("Payment deleted");
            await renderPatientBilling();
          };
        }
        tb.appendChild(tr);
      });
    const addPay = card.querySelector(".addPay");
    if (addPay) addPay.onclick = () => openPaymentModal(inv, pid);
    const editInv = card.querySelector(".editInv");
    if (editInv) editInv.onclick = () => openEditInvoiceModal(inv, () => reloadPatientBillingQuiet());
    const delInv = card.querySelector(".delInv");
    if (delInv) {
      delInv.onclick = async () => {
        if (!confirm("Delete this invoice and all its payments?")) return;
        for (const p of invPayments) await window.api.payments.delete(p.id, inv.id);
        await window.api.invoices.delete(inv.id);
        showToast("Invoice deleted");
        await renderPatientBilling();
      };
    }
    const customerCopyBtn = card.querySelector(".billing-customer-copy");
    if (customerCopyBtn && synced) customerCopyBtn.onclick = () => openCustomerCopyModal(inv, paid, due);
    list.appendChild(card);
  });
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
          <input id="bProcedure" type="text" class="billing-select" list="procList" placeholder="Select or type procedure..." autocomplete="off">
          <datalist id="procList">${billingProcedureOptionTags()}</datalist>
          <input id="bCost" type="number" placeholder="Total Cost" style="max-width:120px;">
          <input id="bLab" type="number" placeholder="Lab Cost" style="max-width:120px;">
          <button type="button" id="addInvoiceBtn" class="btn btn-primary">+ Add Invoice</button>
        </div>
        <textarea id="bNotes" class="billing-notes" placeholder="Treatment notes, observations..." rows="3"></textarea>
      </div>
      <div id="billingList"></div>
    </div>`;

  $("#addInvoiceBtn").onclick = async () => {
    const procedure = readProcedureChoice($("#bProcedure"));
    if (!procedure) return showToast("Procedure is required", "error");
    const notes = ($("#bNotes").value || "").trim();
    const costVal = Number($("#bCost").value || 0);
    const labVal = Number($("#bLab").value || 0);
    const dateStr = $("#bDate").value || d;
    const createdAtMs = new Date(`${dateStr}T12:00:00`).getTime();

    const snap = {
      invoices: billingDataCache.invoices.map((x) => ({ ...x })),
      payments: billingDataCache.payments.map((x) => ({ ...x }))
    };

    const optimisticId = `opt-inv-${Date.now()}`;
    const optimisticInv = {
      __optimistic: true,
      id: optimisticId,
      patient_id: pid,
      procedure,
      cost: costVal,
      lab_cost: labVal,
      created_at: createdAtMs,
      notes,
      status: "unpaid"
    };

    billingDataCache = {
      pid,
      invoices: [optimisticInv, ...(billingDataCache.pid === pid ? billingDataCache.invoices : [])],
      payments: billingDataCache.pid === pid ? [...billingDataCache.payments] : []
    };

    paintBillingInvoiceCards();
    showSavingPeek();
    try {
      await window.api.invoices.add({
        patient_id: pid,
        procedure,
        cost: costVal,
        lab_cost: labVal,
        created_at: new Date((dateStr || d) + "T12:00:00").getTime(),
        notes
      });
      showToast("Invoice added");
      await reloadPatientBillingQuiet();
    } catch (e) {
      billingDataCache = { pid, invoices: snap.invoices, payments: snap.payments };
      paintBillingInvoiceCards();
      showToast(e.message || "Could not save invoice", "error");
    } finally {
      hideSavingPeek();
    }
  };

  await withLoading(async () => {
    const [inv, pay] = await Promise.all([
      window.api.invoices.list(pid),
      window.api.payments.list({ patient_id: pid })
    ]);
    billingDataCache = { pid, invoices: inv || [], payments: pay || [] };
  });
  paintBillingInvoiceCards();
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
        dateLabel: displayDateTs(inv.created_at),
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

function openPaymentModal(inv, patient_id) {
  const totalCost = Number(inv.cost || 0);
  const linked = billingDataCache.payments.filter((p) => String(p.invoice_id) === String(inv.id));
  const paidPrior = linked.reduce((s, p) => s + Number(p.amount || 0), 0);
  const outstanding = Math.max(0, totalCost - paidPrior);

  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-content modal-content--payment-record" role="dialog" aria-labelledby="payModalTitle">
    <h2 id="payModalTitle" class="payment-modal-title">Record Payment</h2>
    <p class="payment-modal-sub"><span style="display:block">${escapeHtml(inv.procedure || "—")}</span><span>${pkMoney(totalCost)} invoice total</span></p>
    <div class="payment-form-stack">
      <div>
        <label for="pDate">Payment Date</label>
        <input id="pDate" type="date" value="${localYMD(new Date())}">
      </div>
      <div>
        <label for="pAmount">Amount in PKR</label>
        <input id="pAmount" type="number" step="any" min="1" placeholder="0">
      </div>
      <p class="payment-remaining-hint" id="pRemainingHint">Remaining: ${pkMoney(outstanding)}</p>
      <div>
        <label for="pMode">Mode of Payment</label>
        <select id="pMode"><option>Cash</option><option>Bank Transfer</option><option>Card</option></select>
      </div>
    </div>
    <div class="payment-actions-stack">
      <button type="button" id="pSave" class="btn btn-primary">Save Payment</button>
      <button type="button" id="pCancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const amtInput = ov.querySelector("#pAmount");
  const hintEl = ov.querySelector("#pRemainingHint");

  amtInput?.addEventListener("input", () => {
    const entered = Number(amtInput.value || 0);
    const projected = outstanding - entered;
    if (!hintEl) return;
    hintEl.textContent =
      projected >= 0
        ? `Remaining: ${pkMoney(projected)}`
        : `Over outstanding by ${pkMoney(Math.abs(projected))}`;
  });

  ov.querySelector("#pCancel").onclick = () => ov.remove();
  ov.querySelector("#pSave").onclick = async () => {
    const date = ov.querySelector("#pDate").value;
    const amount = Number(ov.querySelector("#pAmount").value || 0);
    const payment_mode = ov.querySelector("#pMode").value;
    if (!date || !amount) return showToast("Date and amount required", "error");

    const rollback = billingDataCache.payments.map((p) => ({ ...p }));
    const optPid = `opt-pay-${Date.now()}`;
    const optimisticPay = {
      __optimistic: true,
      id: optPid,
      invoice_id: inv.id,
      patient_id,
      date,
      amount,
      payment_mode
    };

    billingDataCache.payments = [...billingDataCache.payments, optimisticPay];
    paintBillingInvoiceCards();
    ov.remove();
    showSavingPeek();
    try {
      await window.api.payments.add({ invoice_id: inv.id, patient_id, date, amount, payment_mode });
      await reloadPatientBillingQuiet();
      showToast("Payment saved");
    } catch (e) {
      billingDataCache.payments = rollback.map((x) => ({ ...x }));
      paintBillingInvoiceCards();
      showToast(e.message || "Could not save payment", "error");
    } finally {
      hideSavingPeek();
    }
  };
}

function openEditInvoiceModal(inv, onSave) {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-content modal-content--billing">
    <h3>Edit Invoice #${inv.id}</h3>
    <label>Date</label><input id="eDate" type="date" value="${localYMD(new Date(inv.created_at))}">
    <label>Procedure</label>
    <input id="eProcedure" type="text" class="billing-select" list="procListEdit" placeholder="Select or type procedure..." autocomplete="off" value="${escapeHtml(String(inv.procedure || ""))}">
    <datalist id="procListEdit">${billingProcedureOptionTags()}</datalist>
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
  ov.querySelector("#eNotes").value = inv.notes ?? "";
  ov.querySelector("#eCancel").onclick = () => ov.remove();
  ov.querySelector("#eSave").onclick = async () => {
    const procedure = readProcedureChoice(ov.querySelector("#eProcedure"));
    if (!procedure) return showToast("Procedure is required", "error");
    const notes = (ov.querySelector("#eNotes").value || "").trim();
    await window.api.invoices.update({
      id: inv.id,
      created_at: new Date(`${ov.querySelector("#eDate").value}T12:00:00`).getTime(),
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

async function openAddAppointmentModal() {
  const plist = await withLoading(() => window.api.patients.list());
  if (!plist || !plist.length) {
    showToast("Add at least one patient before scheduling appointments.", "error");
    return;
  }
  const dv = document.createElement("div");
  dv.className = "modal modal--appt";
  const hh = String(new Date().getHours()).padStart(2, "0");
  const mm = String(new Date().getMinutes()).padStart(2, "0");
  dv.innerHTML = `<div class="modal-content modal-content--appt">
    <h2 class="modal-card-title">Add Appointment</h2>
    <div class="modal-form-stack">
      <label for="amPatient">Patient</label>
      <select id="amPatient"></select>
      <label for="amDoctor">Doctor</label>
      <input id="amDoctor" type="text" placeholder="Doctor name">
      <label for="amProcedure">Procedure</label>
      <input id="amProcedure" type="text" placeholder="Procedure">
      <label for="amDate">Date</label>
      <input id="amDate" type="date" value="${localYMD(new Date())}">
      <label for="amTime">Time</label>
      <input id="amTime" type="time" value="${hh}:${mm}">
    </div>
    <div class="modal-actions-row">
      <button type="button" id="amSave" class="btn btn-primary">Save</button>
      <button type="button" id="amCancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(dv);
  const psel = dv.querySelector("#amPatient");
  (plist || []).forEach((p) => {
    const idPart = String(p.id ?? p.external_id ?? "").trim();
    if (!idPart) return;
    const o = document.createElement("option");
    o.value = idPart;
    o.dataset.name = p.name || p["Patient Name"] || "";
    const mr = String(p.external_id ?? p["Case No."] ?? "").trim();
    const nm = (p.name || p["Patient Name"] || "").trim();
    o.textContent = mr ? `${mr} — ${nm || mr}` : nm || idPart;
    psel.appendChild(o);
  });
  dv.querySelector("#amCancel").onclick = () => dv.remove();
  dv.querySelector("#amSave").onclick = async () => {
    const amSel = dv.querySelector("#amPatient");
    if (!amSel?.value) return showToast("Select patient", "error");
    await window.api.appts.add({
      doctor: (dv.querySelector("#amDoctor").value || "").trim(),
      patient_id: amSel.value,
      patient_name: amSel.options[amSel.selectedIndex]?.dataset?.name || "",
      procedure: (dv.querySelector("#amProcedure").value || "").trim(),
      date: dv.querySelector("#amDate").value,
      time: dv.querySelector("#amTime").value,
      status: "yellow"
    });
    showToast("Appointment added");
    dv.remove();
    drawCalendar();
  };
}

function openNewPatientModal() {
  const dv = document.createElement("div");
  dv.className = "modal modal--appt";
  dv.innerHTML = `<div class="modal-content modal-content--appt">
    <h2 class="modal-card-title">New Patient</h2>
    <div class="modal-form-stack">
      <label for="npCaseNo">Case No</label>
      <input id="npCaseNo" type="text" placeholder="Leave blank for auto">
      <label for="npName">Name</label>
      <input id="npName" type="text" placeholder="Full name">
      <label for="npAge">Age</label>
      <input id="npAge" type="text" placeholder="Age">
      <label for="npGender">Gender</label>
      <select id="npGender">
        <option value="">Select…</option>
        <option value="Male">Male</option>
        <option value="Female">Female</option>
        <option value="Other">Other</option>
      </select>
      <label for="npPhone">Phone</label>
      <input id="npPhone" type="text" placeholder="Phone">
      <label for="npAddress">Address</label>
      <input id="npAddress" type="text" placeholder="Address">
    </div>
    <div class="modal-actions-row">
      <button type="button" id="npSave" class="btn btn-primary">Save</button>
      <button type="button" id="npCancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(dv);
  dv.querySelector("#npCancel").onclick = () => dv.remove();
  dv.querySelector("#npSave").onclick = async () => {
    const p = {
      external_id: (dv.querySelector("#npCaseNo").value || "").trim() || undefined,
      name: dv.querySelector("#npName").value || "",
      age: dv.querySelector("#npAge").value || "",
      gender: dv.querySelector("#npGender").value || "",
      phone: dv.querySelector("#npPhone").value || "",
      address: dv.querySelector("#npAddress").value || ""
    };
    if (!p.name.trim()) return showToast("Name is required", "error");
    await window.api.patients.save(p);
    showToast("Patient saved");
    dv.remove();
    await refreshPatientsCache();
    renderPatientList();
  };
}

function openApptModal(a) {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-content">
    <h3>Appointment</h3>
    <p><b>Case:</b> ${a.patient_id || "—"}</p>
    <p><b>Name:</b> ${a.patient_name || "—"}</p>
    <p><b>Date:</b> ${displayDateYYYYMMDD(a.date)}</p>
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

function openDrawer(type, patient = null) {
  if (type !== "patient") return;
  $("#drawerTitle").textContent = patient ? "Edit Patient" : "New Patient";
  const dr = $("#drawer");
  const c = $("#drawerContent");
  c.innerHTML = "";
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
  dr.dataset.type = "patient";
  dr.classList.remove("hidden");
  dr.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  const dr = $("#drawer");
  dr.classList.add("hidden");
  dr.setAttribute("aria-hidden", "true");
}

async function saveDrawer() {
  if ($("#drawer").dataset.type !== "patient") return;
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
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!localStorage.getItem("cp_token")) return;

  mountSettingsSection();
  applyTheme(localStorage.getItem("cp_theme") || "cyan");
  const m = new Date();
  $("#billingMonth").value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;

  $$(".nav-btn[data-nav]").forEach((el) => (el.onclick = () => setActiveNav(el.dataset.nav)));

  const signOutBtn = document.querySelector(".sign-out-btn");
  if (signOutBtn) {
    signOutBtn.onclick = () => {
      localStorage.removeItem("cp_token");
      window.location.href = "https://meesummeer.github.io/clinicpilot-fdc/login.html";
    };
  }

  $("#prevMonth").onclick = () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    drawCalendar();
  };
  $("#nextMonth").onclick = () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    drawCalendar();
  };
  $("#newPatient").onclick = () => openNewPatientModal();
  $("#addAppt").onclick = () => openAddAppointmentModal();
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
      window.alert(
        typeof res === "object" && res !== null
          ? JSON.stringify(res)
          : String(res ?? "Backup completed.")
      );
    } catch (e) {
      window.alert(`Backup failed: ${e.message || String(e)}`);
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
