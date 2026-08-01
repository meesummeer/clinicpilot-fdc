const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentMonth = new Date();
let currentPatient = null;
let currentPatientKey = null;
let cachedPatients = null;
let allPatients = [];
let billingAllTime = false;
let clinicBillingView = "invoices";
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

function displayDateYYYYMMDD(raw) {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatDate(s);
}

function pkMoney(n) { return `PKR ${Number(n || 0).toLocaleString()}`; }
function patientDisplayName(p) { return (p?.name || p?.["Patient Name"] || "").trim() || "—"; }

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
  const prevAfterPrint = window.onafterprint;
  const cleanup = () => {
    if (cleaned) return; cleaned = true; sheet.remove(); document.body.classList.remove("printing-invoice"); window.onafterprint = prevAfterPrint || null;
  };
  window.onafterprint = () => cleanup();
  document.body.classList.add("printing-invoice");
  window.print();
  setTimeout(cleanup, 1000);
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
  const costN = Number(inv?.cost || 0);
  const paidN = Number(paid || 0);
  const dueN = Math.max(0, Number(due ?? 0));
  const costStr = costN.toLocaleString();
  const paidStr = paidN.toLocaleString();
  const dueStr = dueN.toLocaleString();
  const dueColor = dueN > 0 ? "#c62828" : "#2e7d32";
  const dueDisplay = dueN > 0 ? `PKR ${dueStr}` : "Paid in Full";
  const dueTotalsRowStyle = dueN > 0 ? "color:#c62828;" : "";
  const hasLineItems = inv.line_items && inv.line_items.length > 0;
  const payTol = 1e-6;
  const discountN = Number(inv?.discount || 0);

  let invStatusLabel = "Unpaid", invStatusColor = "#c62828";
  if (paidN <= payTol) { invStatusLabel = "Unpaid"; invStatusColor = "#c62828"; }
  else if (paidN + payTol >= costN) { invStatusLabel = "Paid"; invStatusColor = "#2e7d32"; }
  else { invStatusLabel = "Partial"; invStatusColor = "#e65100"; }

  const tableBodyRows = hasLineItems
    ? inv.line_items.map((item) => `
      <tr style="background:#f9f9f9;">
        <td style="padding:10px 12px;font-weight:600;font-size:13px;">${item.name}</td>
        <td style="padding:10px 12px;text-align:right;font-size:13px;">PKR ${Number(item.cost).toLocaleString()}</td>
        <td style="padding:10px 12px;text-align:center;font-size:13px;font-weight:600;color:${invStatusColor};">${invStatusLabel}</td>
      </tr>`).join("")
    : (() => {
        const proc = String(inv.procedure ?? "").trim() || "—";
        const total = Number(inv.cost || 0);
        const row = (name, amt) => `
      <tr style="background:#f9f9f9;">
        <td style="padding:10px 12px;font-weight:600;font-size:13px;">${name}</td>
        <td style="padding:10px 12px;text-align:right;font-size:13px;">PKR ${Number(amt).toLocaleString()}</td>
        <td style="padding:10px 12px;text-align:center;font-size:13px;font-weight:600;color:${invStatusColor};">${invStatusLabel}</td>
      </tr>`;
        if (proc.includes(",")) {
          const names = proc.split(",").map((s) => s.trim()).filter(Boolean);
          const each = total / (names.length || 1);
          return names.map((n) => row(n, each)).join("");
        }
        return row(proc, total);
      })();

  const discountRow = discountN > 0 ? `
      <div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; color:#e65100;">
        <span style="margin-right:40px;">Discount:</span>
        <span style="font-weight:600;">- PKR ${discountN.toLocaleString()}</span>
      </div>` : "";

  return `
<div id="invoice-print-area" style="font-family: Arial, sans-serif; background: white; padding: 40px; max-width: 700px; margin: 0 auto; color: #222;">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
    <div><img src="/fdc-logo.png" style="height:70px; width:auto;"></div>
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
        <th style="padding:10px 12px; text-align:right; font-size:13px;">Amount</th>
        <th style="padding:10px 12px; text-align:center; font-size:13px;">Status</th>
      </tr>
    </thead>
    <tbody>${tableBodyRows}</tbody>
  </table>
  <div style="display:flex; justify-content:flex-end; margin-bottom:24px;">
    <div style="text-align:right; min-width:200px;">
      <div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;">
        <span style="color:#555; margin-right:40px;">Total:</span>
        <span style="font-weight:600;">PKR ${costStr}</span>
      </div>
      ${discountRow}
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
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".invoice-copy-btn-pdf").onclick = () => runInvoiceCustomerPdfPrint(inv, paid, due);
  overlay.querySelector(".invoice-copy-btn-wa").onclick = (e) => sendCustomerInvoiceWhatsApp(inv, paid, due, e.currentTarget);
}

async function sendCustomerInvoiceWhatsApp(_inv, _paid, _due, triggerBtn) {
  const pt = currentPatient || {};
  const name = patientDisplayName(pt);
  const rawPhone = pt.phone ?? pt.Contact ?? "";
  const digits = waDigitsFromPakistanPhone(rawPhone);
  if (!digits) { showToast("No phone number on file for this patient", "error"); return; }
  const invoiceEl = document.querySelector(".invoice-copy-modal-body #invoice-print-area");
  if (!invoiceEl) { showToast("Invoice preview is not available", "error"); return; }
  if (typeof window.html2canvas !== "function") { showToast("Screenshot library not loaded", "error"); return; }
  const btn = triggerBtn || null;
  const originalText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }
  try {
    const canvas = await window.html2canvas(invoiceEl, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG generation failed");
    const safeName = name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "Patient";
    const href = URL.createObjectURL(blob);
    const dl = document.createElement("a");
    dl.href = href; dl.download = `Invoice-${safeName}.png`;
    document.body.appendChild(dl); dl.click(); dl.remove(); URL.revokeObjectURL(href);
    const msg = whatsappInvoiceMessage(name);
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    setTimeout(() => window.open(url, "_blank", "noopener,noreferrer"), 800);
  } catch (_) { showToast("Could not prepare invoice image", "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = originalText || "Send via WhatsApp"; } }
}

function ensureSavingPeekEl() {
  let el = document.getElementById("savingPeek");
  if (!el) {
    el = document.createElement("div"); el.id = "savingPeek"; el.className = "saving-peek";
    el.setAttribute("aria-live", "polite"); el.textContent = "Saving…"; document.body.appendChild(el);
  }
  return el;
}
function showSavingPeek() { savingPeekCount += 1; ensureSavingPeekEl().classList.add("visible"); }
function hideSavingPeek() { savingPeekCount = Math.max(0, savingPeekCount - 1); if (savingPeekCount === 0) ensureSavingPeekEl().classList.remove("visible"); }

async function reloadPatientBillingQuiet() {
  const pid = currentPatient?.id ?? currentPatient?.external_id;
  if (!pid || !$("#billingList")) return;
  try {
    const [inv, pay] = await Promise.all([window.api.invoices.list(pid), window.api.payments.list({ patient_id: pid })]);
    billingDataCache = { pid, invoices: inv || [], payments: pay || [] };
    paintBillingInvoiceCards();
  } catch (_) {}
}

const BILLING_PROCEDURE_OPTIONS = ["RCT","Scaling","Extraction","Diagnosis","Filling","Crown","Denture","Bridge","Implant","Whitening","Other"];

function escapeHtml(text) {
  const d = document.createElement("div"); d.textContent = text == null ? "" : String(text); return d.innerHTML;
}
function billingProcedureOptionTags() { return BILLING_PROCEDURE_OPTIONS.map((p) => `<option value="${p}">`).join(""); }
function readProcedureChoice(inputEl) { return (inputEl?.value || "").trim(); }

function normalizeInvoiceLineItems(inv) {
  const raw = inv?.line_items;
  if (!Array.isArray(raw) || !raw.length) return null;
  const items = raw.map((i) => ({ name: String(i?.name ?? i?.procedure ?? "").trim(), cost: Number(i?.cost ?? 0) })).filter((i) => i.name || i.cost > 0);
  return items.length ? items : null;
}

function formatLineItemsCardHtml(inv) {
  if (!inv.line_items || !inv.line_items.length) return "";
  const lines = inv.line_items.map((item) => `• ${escapeHtml(String(item.name ?? ""))}: PKR ${Number(item.cost || 0).toLocaleString()}`);
  return `<div style="margin:4px 0 8px;font-size:12px;line-height:1.6;color:#374151;">${lines.join("<br>")}</div>`;
}

function buildCustomerCopyProcedureRows(inv) {
  let tableRows;
  if (inv.line_items && inv.line_items.length > 0) {
    tableRows = inv.line_items.map((item) => `
    <tr style="background:#f9f9f9;">
      <td style="padding:10px 12px; font-weight:600; font-size:13px;">${escapeHtml(String(item.name ?? ""))}</td>
      <td style="padding:10px 12px; text-align:right; font-size:13px;">PKR ${Number(item.cost).toLocaleString()}</td>
    </tr>`).join("");
  } else {
    const proc = String(inv.procedure ?? "").trim() || "—";
    const total = Number(inv.cost || 0);
    const row = (name, amt) => `
    <tr style="background:#f9f9f9;">
      <td style="padding:10px 12px; font-weight:600; font-size:13px;">${escapeHtml(name)}</td>
      <td style="padding:10px 12px; text-align:right; font-size:13px;">PKR ${Number(amt).toLocaleString()}</td>
    </tr>`;
    if (proc.includes(",")) {
      const names = proc.split(",").map((s) => s.trim()).filter(Boolean);
      const each = total / (names.length || 1);
      tableRows = names.map((n) => row(n, each)).join("");
    } else { tableRows = row(proc, total); }
  }
  return tableRows;
}

function attachLineItemsEditor(hostEl, options = {}) {
  const { initialItems = [{ name: "", cost: "" }, { name: "", cost: "" }], listId = "msProcList", onTotalChange } = options;
  const rowsWrap = hostEl.querySelector("[data-line-items-rows]");
  const totalEl = hostEl.querySelector("[data-line-items-total]");
  const addBtn = hostEl.querySelector("[data-add-service]");
  const updateTotal = () => {
    const total = [...rowsWrap.querySelectorAll(".ms-line-row")].reduce((s, row) => s + Number(row.querySelector(".ms-line-cost")?.value || 0), 0);
    if (totalEl) totalEl.textContent = `Total: PKR ${total.toLocaleString()}`;
    onTotalChange?.(total); return total;
  };
  const collectItems = () => [...rowsWrap.querySelectorAll(".ms-line-row")].map((row) => ({ name: (row.querySelector(".ms-line-proc")?.value || "").trim(), cost: Number(row.querySelector(".ms-line-cost")?.value || 0) })).filter((i) => i.name && i.cost > 0);
  const addRow = (name = "", cost = "") => {
    const row = document.createElement("div"); row.className = "ms-line-row"; row.style.cssText = "display:flex;gap:8px;margin-bottom:8px;align-items:center;";
    const costVal = cost === "" || cost == null ? "" : String(cost);
    row.innerHTML = `<input type="text" class="ms-line-proc billing-select" list="${listId}" placeholder="Procedure" autocomplete="off" value="${escapeHtml(String(name))}" style="flex:1;min-width:0;"><input type="number" class="ms-line-cost" placeholder="Cost" value="${escapeHtml(costVal)}" min="0" step="any" style="max-width:110px;"><button type="button" class="btn btn-danger btn-small ms-line-remove" title="Remove">×</button>`;
    row.querySelector(".ms-line-cost").addEventListener("input", updateTotal);
    row.querySelector(".ms-line-remove").onclick = () => { if (rowsWrap.querySelectorAll(".ms-line-row").length <= 1) return; row.remove(); updateTotal(); };
    rowsWrap.appendChild(row); updateTotal();
  };
  initialItems.forEach((i) => addRow(i.name || "", i.cost ?? ""));
  addBtn?.addEventListener("click", () => addRow());
  return { collectItems, updateTotal, addRow };
}

const THEME_MAP = { cyan: "#009688", purple: "#7c3aed", blue: "#1d4ed8" };
let loadingCount = 0, loadingTimer = null;
function showLoading() { if (loadingCount === 0) loadingTimer = setTimeout(() => $("#loadingOverlay")?.classList.remove("hidden"), 300); loadingCount += 1; }
function hideLoading() { loadingCount = Math.max(0, loadingCount - 1); if (loadingCount === 0) { clearTimeout(loadingTimer); $("#loadingOverlay")?.classList.add("hidden"); } }
async function withLoading(fn) { showLoading(); try { return await fn(); } finally { hideLoading(); } }

function showToast(message, type = "success") {
  const host = $("#toastHost"); if (!host) return;
  const t = document.createElement("div"); t.className = `toast${type === "error" ? " error" : ""}`; t.textContent = message; host.appendChild(t); setTimeout(() => t.remove(), 3000);
}

function localYMD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function computeInvoiceTotals(inv, paymentsForInv = []) {
  return window.api.billing.computeInvoiceTotals(inv, paymentsForInv);
}

function invoiceCreatedInPeriod(inv, ym, allTime) {
  if (allTime) return true;
  const d = inv.created_at ? localYMD(new Date(inv.created_at)) : "";
  return ym ? d.startsWith(ym) : true;
}

function paymentInPeriod(p, ym, allTime) {
  if (allTime) return true;
  return ym ? String(p.date || "").startsWith(ym) : true;
}

function buildPaymentsByInvoice(payments) {
  return (payments || []).reduce((m, p) => {
    const key = String(p.invoice_id ?? "");
    if (!key) return m;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(p);
    return m;
  }, new Map());
}

function bindInvoicePaidToggle(btn) {
  let isPaid = false;
  const sync = () => { btn.textContent = isPaid ? "Paid" : "Unpaid"; btn.style.background = isPaid ? "#2e7d32" : "#9e9e9e"; btn.style.borderColor = isPaid ? "#2e7d32" : "#9e9e9e"; btn.style.color = "#fff"; };
  btn.onclick = () => { isPaid = !isPaid; sync(); }; sync(); return () => isPaid;
}

function patientKey(p) { return String(p?.id || p?.external_id || p?.["Case No."] || "").trim(); }

function fmt12(timeHHMM = "") {
  if (!/^\d{2}:\d{2}$/.test(timeHHMM)) return timeHHMM || "";
  const [h, m] = timeHHMM.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

function statusBadge(status) {
  const map = { paid: '<span class="statusBadge status-paid">Paid</span>', partial: '<span class="statusBadge status-partial">Partial</span>', unpaid: '<span class="statusBadge status-unpaid">Unpaid</span>' };
  return map[(status || "unpaid").toLowerCase()] || map.unpaid;
}

function applyTheme(themeKey) {
  const key = THEME_MAP[themeKey] ? themeKey : "cyan";
  document.documentElement.style.setProperty("--accent", THEME_MAP[key]); localStorage.setItem("cp_theme", key);
  $$(".themeSwatch").forEach((b) => {
    const swatchTheme = b.dataset.theme; const on = swatchTheme === key;
    b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    const dot = b.querySelector(".themeSwatch-dot");
    if (dot) { const accent = THEME_MAP[swatchTheme] || THEME_MAP.cyan; dot.style.boxShadow = on ? `0 0 0 3px var(--bg, #f1f5f9), 0 0 0 6px ${accent}` : "none"; }
  });
}

function mountSettingsSection() {
  const sec = $("#settingsSection"); if (!sec) return;
  const swatchBtn = (id, hex, label) => `<button type="button" class="themeSwatch" data-theme="${id}" aria-pressed="false" style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;border:none;background:transparent;cursor:pointer;padding:10px;font:inherit;color:inherit;font-weight:600;font-size:0.875rem"><span class="themeSwatch-dot" style="display:block;width:48px;height:48px;border-radius:50%;background:${hex};flex-shrink:0;margin:2px;"></span><span>${label}</span></button>`;
  sec.innerHTML = `
    <div class="card settings-block"><h3 class="settings-block-title">App Theme</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">${swatchBtn("cyan","#009688","Cyan")}${swatchBtn("purple","#7c3aed","Purple")}${swatchBtn("blue","#1d4ed8","Blue")}</div></div>
    <div class="card settings-block"><h3 class="settings-block-title">Backup to Google Sheets</h3><p class="settings-desc">Export all patient and billing data to Google Sheets.</p><button type="button" id="backupDataBtn" class="btn btn-primary">Run Backup</button></div>
    <div class="card settings-block" style="border-left:4px solid #dc2626"><h3 class="settings-block-title danger-t">Danger Zone</h3><button type="button" id="deleteAllPatients" class="btn btn-danger">Delete All Patients</button></div>`;
}

function setActiveNav(nav) {
  $$(".nav-btn[data-nav]").forEach((el) => el.classList.toggle("active", el.dataset.nav === nav));
  const titles = { home: "Home", patients: "Patients", billings: "Billings", settings: "Settings" };
  const pt = $("#pageTitle"); if (pt) pt.textContent = titles[nav] || "Home";
  $$(".pane").forEach((s) => s.classList.remove("active"));
  const map = { home: "#homeSection", patients: "#patientsSection", billings: "#billingsSection", settings: "#settingsSection" };
  $(map[nav])?.classList.add("active");
  if (nav !== "patients") hidePatientProfile(); else openPatientsSection();
  if (nav === "billings") renderClinicBilling();
}

async function refreshPatientsCache() {
  try { const list = await withLoading(() => window.api.patients.list()); cachedPatients = Array.isArray(list) ? list : []; allPatients = cachedPatients; renderPatientList(); }
  catch (e) { renderPatientList(); throw e; }
}

async function refreshPatientsInBackground() {
  try { const list = await window.api.patients.list(); cachedPatients = Array.isArray(list) ? list : []; allPatients = cachedPatients; renderPatientList(); } catch (_) {}
}

function renderPatientList() {
  const q = String($("#search")?.value || "").toLowerCase();
  const list = $("#patientList"); if (!list) return;
  const source = Array.isArray(allPatients) ? allPatients : [];
  const filtered = !q ? source : source.filter((p) => {
    const n = String(p.name || p["Patient Name"] || "").toLowerCase();
    const ph = String(p.phone || p.Contact || "").toLowerCase();
    const mr = String(p.external_id || p["Case No."] || "").toLowerCase();
    return n.includes(q) || ph.includes(q) || mr.includes(q);
  });
  list.innerHTML = "";
  filtered.forEach((p) => {
    const key = patientKey(p); const row = document.createElement("button"); row.type = "button";
    row.className = `patient-row${key && key === currentPatientKey ? " active" : ""}`;
    const mr = p.external_id || p["Case No."] || ""; const nm = p.name || p["Patient Name"] || "—"; const ph = p.phone || p.Contact || "";
    row.innerHTML = `<span class="patient-row__badge">${mr || "—"}</span><span class="patient-row__main"><span class="patient-row__name">${nm}</span><span class="patient-row__phone">${ph || ""}</span></span><span class="patient-row__chevron" aria-hidden="true">›</span>`;
    row.onclick = () => openProfile(p); list.appendChild(row);
  });
  if (!filtered.length) list.innerHTML = '<p class="patientSmall">No patients found.</p>';
}

function openPatientsSection() {
  showPatientBrowse(); const sb = $("#search"); if (sb) sb.placeholder = "Search by name, phone, or MR number...";
  if (cachedPatients !== null) { allPatients = cachedPatients; renderPatientList(); refreshPatientsInBackground(); }
  else { refreshPatientsCache().catch(() => { renderPatientList(); showToast("Could not load patients", "error"); }); }
}

function showPatientBrowse() { $("#patientBrowse")?.classList.remove("hidden"); $("#patientProfileView")?.classList.add("hidden"); }
function hidePatientBrowse() { $("#patientBrowse")?.classList.add("hidden"); $("#patientProfileView")?.classList.remove("hidden"); }
function hidePatientProfile() { showPatientBrowse(); }

async function openProfile(p) {
  currentPatient = (await withLoading(() => window.api.patients.get(p.id || p.external_id))) || p;
  currentPatientKey = patientKey(currentPatient);
  $("#profileName").textContent = currentPatient.name || currentPatient["Patient Name"] || "Unnamed";
  $("#profileInfo").textContent = `${currentPatient.external_id || "—"} · ${currentPatient.phone || "—"}`;
  hidePatientBrowse(); await openTab("profile"); renderPatientList();
}

async function openTab(tab) {
  $$("#patientTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  const c = $("#tabContent"); c.innerHTML = "";
  if (tab === "profile") {
    c.innerHTML = `<p><b>Case No:</b> ${currentPatient.external_id || "—"}</p><p><b>Name:</b> ${currentPatient.name || "—"}</p><p><b>Phone:</b> ${currentPatient.phone || "—"}</p><p><b>Address:</b> ${currentPatient.address || "—"}</p><p><b>Age:</b> ${currentPatient.age || "—"}</p><p><b>Gender:</b> ${currentPatient.gender || "—"}</p>`;
    return;
  }
  await renderPatientBilling();
}

function paintBillingInvoiceCards() {
  const pid = currentPatient?.id ?? currentPatient?.external_id;
  const list = $("#billingList"); if (!list) return;
  if (!billingDataCache.pid || billingDataCache.pid !== pid) { list.innerHTML = '<p class="patientSmall">Loading…</p>'; return; }
  const { invoices, payments } = billingDataCache;
  list.innerHTML = "";
  if (!invoices.length) { list.innerHTML = '<p class="patientSmall">No invoices yet.</p>'; return; }

  invoices.forEach((inv) => {
    const invPayments = payments.filter((p) => String(p.invoice_id) === String(inv.id));
    const { paid, due, status } = computeInvoiceTotals(inv, invPayments);
    const discountN = Number(inv.discount || 0);
    const card = document.createElement("div"); card.className = "invoice-block";
    const synced = !inv.__optimistic;
    const notesHtml = inv.notes ? `<p class="patientSmall invoice-notes-line" style="margin:6px 0 0;line-height:1.4">${escapeHtml(inv.notes)}</p>` : "";
    const lineItemsCard = formatLineItemsCardHtml(inv);
    const invoiceTitle = inv.line_items && inv.line_items.length > 0 ? "Multi-Service Invoice" : escapeHtml(inv.procedure || "");
    const discountBadge = discountN > 0 ? `<span style="font-size:11px;color:#e65100;margin-left:6px;">-PKR ${discountN.toLocaleString()} disc</span>` : "";
    const actionsHtml = synced
      ? `<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;"><button type="button" class="btn btn-primary btn-small addPay">+ Payment</button><button type="button" class="btn btn-secondary btn-small editInv">Edit</button><button type="button" class="btn btn-danger btn-small delInv">Delete</button><button type="button" class="btn btn-secondary btn-small billing-customer-copy">Customer Copy</button></div>`
      : `<p class="patientSmall" style="margin-bottom:8px;">Saving invoice…</p>`;

    card.innerHTML = `
      <div class="pane-head" style="margin-bottom:8px;"><b>${invoiceTitle}</b>${synced ? statusBadge(status) : ""}${discountBadge}<span class="patientSmall">${displayDateTs(inv.created_at)}</span></div>
      ${lineItemsCard}${notesHtml}
      <div style="display:flex;flex-wrap:wrap;gap:8px 10px;margin-bottom:8px;font-size:12px;">
        <span>Total: ${Number(inv.cost || 0).toLocaleString()}</span>
        <span>Paid: ${paid.toLocaleString()}</span>
        <span>Due: ${due.toLocaleString()}</span>
      </div>
      ${actionsHtml}
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Date</th>
          <th style="text-align:right;padding:4px 8px;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Amount</th>
          <th style="text-align:left;padding:4px 8px;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Mode</th>
          <th style="padding:4px 8px;border-bottom:1px solid #e5e7eb;"></th>
        </tr></thead>
        <tbody class="pay-tbody"></tbody>
      </table>`;

    const tb = card.querySelector(".pay-tbody");
    invPayments.sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;">${displayDateYYYYMMDD(p.date)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${Number(p.amount).toLocaleString()}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(String(p.payment_mode || ""))}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${!p.__optimistic ? `<button type="button" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;" class="pay-del">✕ Delete</button>` : ""}</td>`;
      const delBtn = tr.querySelector(".pay-del");
      if (delBtn) {
        delBtn.onclick = async () => {
          delBtn.disabled = true; delBtn.textContent = "...";
          await window.api.payments.delete(p.id, p.invoice_id);
          showToast("Payment deleted");
          await reloadPatientBillingQuiet();
        };
      }
      tb.appendChild(tr);
    });

    const addPay = card.querySelector(".addPay"); if (addPay) addPay.onclick = () => openPaymentModal(inv, pid);
    const editInv = card.querySelector(".editInv"); if (editInv) editInv.onclick = () => openEditInvoiceModal(inv, () => reloadPatientBillingQuiet());
    const delInv = card.querySelector(".delInv");
    if (delInv) {
      delInv.onclick = async () => {
        if (!confirm("Delete this invoice and all its payments?")) return;
        for (const p of invPayments) await window.api.payments.delete(p.id, inv.id);
        await window.api.invoices.delete(inv.id); showToast("Invoice deleted"); await renderPatientBilling();
      };
    }
    const customerCopyBtn = card.querySelector(".billing-customer-copy");
    if (customerCopyBtn && synced) customerCopyBtn.onclick = () => openCustomerCopyModal(inv, paid, due);
    list.appendChild(card);
  });
}

async function renderPatientBilling() {
  const pid = currentPatient.id || currentPatient.external_id;
  const c = $("#tabContent"); const d = localYMD(new Date());
  c.innerHTML = `
    <div class="invoice-block">
      <div class="billing-add-form">
        <div class="billing-add-row" style="background:var(--card);padding:12px;border-radius:var(--radius);border:1px solid var(--border);">
          <input id="bDate" type="date" value="${d}">
          <input id="bProcedure" type="text" class="billing-select" list="procList" placeholder="Select or type procedure..." autocomplete="off">
          <datalist id="procList">${billingProcedureOptionTags()}</datalist>
          <input id="bCost" type="number" placeholder="Total Cost" style="max-width:120px;">
          <input id="bDiscount" type="number" placeholder="Discount" style="max-width:90px;">
          <input id="bPaidAmount" type="number" placeholder="Paid Now" style="max-width:100px;">
          <select id="bPayMode" style="min-height:44px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius);font:inherit;background:var(--card);max-width:110px;">
            <option value="Cash">Cash</option>
            <option value="Online">Online</option>
            <option value="Card">Card</option>
          </select>
          <button type="button" id="addInvoiceBtn" class="btn btn-primary">+ Add Invoice</button>
        </div>
        <textarea id="bNotes" class="billing-notes" placeholder="Treatment notes, observations..." rows="3"></textarea>
      </div>
      <div id="billingList"></div>
    </div>`;

  const addInvBtn = $("#addInvoiceBtn");
  const multiBtn = document.createElement("button");
  multiBtn.className = "btn"; multiBtn.textContent = "+ Multi-Service"; multiBtn.style.marginLeft = "8px";
  multiBtn.onclick = () => openMultiServiceModal(pid, renderPatientBilling);
  addInvBtn.insertAdjacentElement("afterend", multiBtn);

  $("#addInvoiceBtn").onclick = async () => {
    const procedure = readProcedureChoice($("#bProcedure")); if (!procedure) return showToast("Procedure is required", "error");
    const notes = ($("#bNotes").value || "").trim();
    const costVal = Number($("#bCost").value || 0);
    const discountVal = Number($("#bDiscount").value || 0);
    const dateStr = $("#bDate").value || d;
    const createdAtMs = new Date(`${dateStr}T12:00:00`).getTime();
    const snap = { invoices: billingDataCache.invoices.map((x) => ({ ...x })), payments: billingDataCache.payments.map((x) => ({ ...x })) };
    const optimisticInv = { __optimistic: true, id: `opt-inv-${Date.now()}`, patient_id: pid, procedure, cost: costVal, discount: discountVal, lab_cost: 0, created_at: createdAtMs, notes, status: "unpaid" };
    billingDataCache = { pid, invoices: [optimisticInv, ...(billingDataCache.pid === pid ? billingDataCache.invoices : [])], payments: billingDataCache.pid === pid ? [...billingDataCache.payments] : [] };
    paintBillingInvoiceCards(); showSavingPeek();
    try {
      const invRes = await window.api.invoices.add({ patient_id: pid, procedure, cost: costVal, lab_cost: 0, discount: discountVal, created_at: createdAtMs, notes });
      const paidNow = Number($("#bPaidAmount")?.value || 0);
      if (paidNow > 0) {
        await window.api.payments.add({
          invoice_id: invRes.invoice.id,
          patient_id: pid,
          date: localYMD(new Date()),
          amount: paidNow,
          payment_mode: $("#bPayMode")?.value || "Cash"
        });
      }
      showToast("Invoice added"); await reloadPatientBillingQuiet();
    } catch (e) { billingDataCache = { pid, invoices: snap.invoices, payments: snap.payments }; paintBillingInvoiceCards(); showToast(e.message || "Could not save invoice", "error"); }
    finally { hideSavingPeek(); }
  };

  await withLoading(async () => {
    const [inv, pay] = await Promise.all([window.api.invoices.list(pid), window.api.payments.list({ patient_id: pid })]);
    billingDataCache = { pid, invoices: inv || [], payments: pay || [] };
  });
  paintBillingInvoiceCards();
}

function buildBillingPatientLookup(patients) {
  const map = new Map();
  for (const p of patients || []) {
    const name = (p.name || p["Patient Name"] || "").trim();
    const register = (k) => { const key = String(k ?? "").trim(); if (!key || !name) return; if (!map.has(key)) map.set(key, name); };
    register(p.external_id); register(p.id); register(p["Case No."]);
  }
  return map;
}

async function renderClinicBilling() {
  const monthEl = $("#billingMonth");
  if (monthEl && !monthEl.value) { const n = new Date(); monthEl.value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
  const ym = monthEl?.value || "";
  const [invoices, payments, patients] = await withLoading(() => Promise.all([window.api.invoices.all(), window.api.payments.all(), window.api.patients.list()]));
  const pMap = buildBillingPatientLookup(patients);
  const payByInvoice = buildPaymentsByInvoice(payments);
  const invoicePaymentsFor = (inv) => payByInvoice.get(String(inv.id)) || [];
  const invById = new Map((invoices || []).map((inv) => [String(inv.id), inv]));

  const filteredInvoices = (invoices || []).filter((inv) => invoiceCreatedInPeriod(inv, ym, billingAllTime));
  const invoiceRows = filteredInvoices.map((inv) => {
    const { paid, netTotal, due, status } = computeInvoiceTotals(inv, invoicePaymentsFor(inv));
    const pidStr = String(inv.patient_id ?? "").trim();
    return { sortTs: inv.created_at ? Number(inv.created_at) : 0, dateLabel: displayDateTs(inv.created_at), mr: pidStr, name: pMap.get(pidStr) || "—", procedure: inv.procedure || "", total: netTotal, paid, due, status };
  }).sort((a, b) => b.sortTs - a.sortTs);

  const sumInvoiced = invoiceRows.reduce((s, r) => s + r.total, 0);
  const sumCollected = (payments || []).filter((p) => paymentInPeriod(p, ym, billingAllTime)).reduce((s, p) => s + Number(p.amount || 0), 0);
  const sumOutstanding = Math.max(0, sumInvoiced - sumCollected);
  if (sumOutstanding > 0) {
    console.log("[Billings Outstanding]", filteredInvoices.map((inv) => {
      const { paid, due } = computeInvoiceTotals(inv, invoicePaymentsFor(inv));
      return { id: inv.id, patient_id: inv.patient_id, cost: Number(inv.cost || 0), discount: Number(inv.discount || 0), paid, due };
    }).filter((row) => row.due > 0));
  }
  const periodPayments = (payments || []).filter((p) => paymentInPeriod(p, ym, billingAllTime));

  const fmt = (n) => Number(n || 0).toLocaleString();
  const invEl = $("#billingSummaryInvoiced"); const colEl = $("#billingSummaryCollected"); const outEl = $("#billingSummaryOutstanding");
  if (invEl) invEl.textContent = (billingAllTime || invoiceRows.length) ? fmt(sumInvoiced) : "—";
  if (colEl) colEl.textContent = (billingAllTime || invoiceRows.length) ? fmt(sumCollected) : "—";
  if (outEl) outEl.textContent = (billingAllTime || invoiceRows.length) ? fmt(sumOutstanding) : "—";

  const body = $("#clinicBillingBody");
  if (body) {
    body.innerHTML = "";
    invoiceRows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.dateLabel}</td><td>${escapeHtml(r.mr)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.procedure)}</td><td>${r.total.toLocaleString()}</td><td>${r.paid.toLocaleString()}</td><td>${r.due.toLocaleString()}</td><td>${statusBadge(r.status)}</td>`;
      body.appendChild(tr);
    });
    if (!invoiceRows.length) body.innerHTML = '<tr><td colspan="8" class="patientSmall">No billing records for selected period.</td></tr>';
  }

  const payBody = $("#clinicBillingPaymentsBody");
  if (payBody) {
    const paymentRows = periodPayments.map((p) => {
      const inv = invById.get(String(p.invoice_id));
      const { status } = inv ? computeInvoiceTotals(inv, invoicePaymentsFor(inv)) : { status: "unpaid" };
      const pidStr = String(p.patient_id ?? inv?.patient_id ?? "").trim();
      return { sortDate: String(p.date || ""), dateLabel: displayDateYYYYMMDD(p.date), mr: pidStr, name: pMap.get(pidStr) || "—", procedure: inv?.procedure || "—", amount: Number(p.amount || 0), mode: p.payment_mode || "—", status };
    }).sort((a, b) => b.sortDate.localeCompare(a.sortDate));

    payBody.innerHTML = "";
    paymentRows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.dateLabel}</td><td>${escapeHtml(r.mr)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.procedure)}</td><td>${r.amount.toLocaleString()}</td><td>${escapeHtml(r.mode)}</td><td>${statusBadge(r.status)}</td>`;
      payBody.appendChild(tr);
    });
    if (!paymentRows.length) payBody.innerHTML = '<tr><td colspan="7" class="patientSmall">No payments for selected period.</td></tr>';
  }

  $("#clinicBillingInvoicesPanel")?.classList.toggle("hidden", clinicBillingView !== "invoices");
  $("#clinicBillingPaymentsPanel")?.classList.toggle("hidden", clinicBillingView !== "payments");
  $$("#clinicBillingTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.billingView === clinicBillingView));
}

async function drawCalendar() {
  const year = currentMonth.getFullYear(); const month = currentMonth.getMonth();
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  $("#monthLabel").textContent = `${currentMonth.toLocaleString("default", { month: "long" })} ${year}`;
  $("#dayLabels").innerHTML = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => `<div class="day">${d}</div>`).join("");
  const grid = $("#calGrid"); grid.innerHTML = "";
  const firstDay = new Date(year, month, 1); const start = (firstDay.getDay() + 6) % 7;
  const dim = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < start; i += 1) grid.innerHTML += '<div class="cell empty"></div>';
  const appts = await withLoading(() => window.api.appts.list(ym));
  for (let d = 1; d <= dim; d += 1) {
    const cell = document.createElement("div"); cell.className = "cell"; cell.innerHTML = `<div class="date">${d}</div>`;
    const ds = `${ym}-${String(d).padStart(2, "0")}`;
    appts.filter((a) => a.date === ds).forEach((a) => {
      const div = document.createElement("div"); div.className = `appt status-${(a.status || "yellow").toLowerCase()}`;
      div.textContent = `${a.patient_name || ""} ${fmt12(a.time || "")} — ${a.procedure || ""}`;
      div.onclick = () => openApptModal(a); cell.appendChild(div);
    });
    grid.appendChild(cell);
  }
}

function openPaymentModal(inv, patient_id) {
  const totalCost = Number(inv.cost || 0);
  const linked = billingDataCache.payments.filter((p) => String(p.invoice_id) === String(inv.id));
  const { due: outstanding } = computeInvoiceTotals(inv, linked);
  let _normalizedItems = normalizeInvoiceLineItems(inv) || [];
  if (_normalizedItems.length === 0 && inv.procedure && inv.procedure.includes(",")) {
    const names = inv.procedure.split(",").map(s => s.trim()).filter(Boolean);
    const each = Number(inv.cost || 0) / (names.length || 1);
    _normalizedItems = names.map(name => ({ name, cost: each }));
  }
  const hasLineItems = _normalizedItems.length > 0;
  const lineItemPickerHtml = hasLineItems
    ? `<div id="pLineItemPicker" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin-bottom:12px;"><p style="font-weight:600;font-size:13px;margin:0 0 8px 0;color:#374151;">Select services being paid:</p></div>` : "";

  const ov = document.createElement("div"); ov.className = "modal";
  ov.innerHTML = `<div class="modal-content modal-content--payment-record" role="dialog" aria-labelledby="payModalTitle">
    <h2 id="payModalTitle" class="payment-modal-title">Record Payment</h2>
    <p class="payment-modal-sub"><span style="display:block">${escapeHtml(inv.procedure || "—")}</span><span>${pkMoney(totalCost)} invoice total</span></p>
    ${lineItemPickerHtml}
    <div class="payment-form-stack">
      <div><label for="pDate">Payment Date</label><input id="pDate" type="date" value="${localYMD(new Date())}"></div>
      <div><label for="pAmount">Amount in PKR</label><input id="pAmount" type="number" step="any" min="1" placeholder="0"></div>
      <p class="payment-remaining-hint" id="pRemainingHint">Remaining: ${pkMoney(outstanding)}</p>
      <div><label for="pMode">Mode of Payment</label><select id="pMode"><option>Cash</option><option>Bank Transfer</option><option>Card</option></select></div>
    </div>
    <div class="payment-actions-stack">
      <button type="button" id="pSave" class="btn btn-primary">Save Payment</button>
      <button type="button" id="pCancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  if (hasLineItems) {
    const items = _normalizedItems; const picker = document.getElementById("pLineItemPicker");
    if (picker && items.length > 0) {
      const selected = new Set();
      items.forEach((item, i) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer;margin-bottom:4px;background:#fff;border:1px solid #e5e7eb;";
        row.innerHTML = `<input type="checkbox" style="width:16px;height:16px;cursor:pointer;pointer-events:none;"><span style="flex:1;font-weight:600;font-size:13px;">${escapeHtml(item.name)}</span><span style="font-size:13px;color:#374151;">PKR ${Number(item.cost||0).toLocaleString()}</span>`;
        row.addEventListener("click", () => {
          const cb = row.querySelector("input");
          if (selected.has(i)) { selected.delete(i); row.style.background="#fff"; row.style.borderColor="#e5e7eb"; cb.checked=false; }
          else { selected.add(i); row.style.background="#f0fdf4"; row.style.borderColor="#16a34a"; cb.checked=true; }
          const sum = [...selected].reduce((s, idx) => s + Number(items[idx].cost || 0), 0);
          const amtEl = document.getElementById("pAmount");
          if (amtEl) { amtEl.value = sum > 0 ? String(sum) : "0"; amtEl.dispatchEvent(new Event("input")); }
        });
        picker.appendChild(row);
      });
    }
  }

  const amtInput = ov.querySelector("#pAmount"); const hintEl = ov.querySelector("#pRemainingHint");
  const updateRemainingHint = () => {
    const entered = Number(amtInput?.value || 0); const projected = outstanding - entered; if (!hintEl) return;
    hintEl.textContent = projected >= 0 ? `Remaining: ${pkMoney(projected)}` : `Over outstanding by ${pkMoney(Math.abs(projected))}`;
  };
  amtInput?.addEventListener("input", updateRemainingHint);
  ov.querySelector("#pCancel").onclick = () => ov.remove();
  ov.querySelector("#pSave").onclick = async () => {
    const date = ov.querySelector("#pDate").value; const amount = Number(ov.querySelector("#pAmount").value || 0); const payment_mode = ov.querySelector("#pMode").value;
    if (!date || !amount) return showToast("Date and amount required", "error");
    const rollback = billingDataCache.payments.map((p) => ({ ...p }));
    const optimisticPay = { __optimistic: true, id: `opt-pay-${Date.now()}`, invoice_id: inv.id, patient_id, date, amount, payment_mode };
    billingDataCache.payments = [...billingDataCache.payments, optimisticPay]; paintBillingInvoiceCards(); ov.remove(); showSavingPeek();
    try { await window.api.payments.add({ invoice_id: inv.id, patient_id, date, amount, payment_mode }); await reloadPatientBillingQuiet(); showToast("Payment saved"); }
    catch (e) { billingDataCache.payments = rollback.map((x) => ({ ...x })); paintBillingInvoiceCards(); showToast(e.message || "Could not save payment", "error"); }
    finally { hideSavingPeek(); }
  };
}

function openEditInvoiceModal(inv, onSave) {
  const procedures = ["RCT","Scaling","Extraction","Diagnosis","Filling","Crown","Denture","Bridge","Implant","Whitening","Other"];
  const existingLineItems = normalizeInvoiceLineItems(inv);
  const ov = document.createElement("div"); ov.className = "modal";
  ov.innerHTML = `<div class="modal-content modal-content--billing">
    <h3>Edit Invoice #${inv.id}</h3>
    <label>Date</label><input id="eDate" type="date" value="${localYMD(new Date(inv.created_at))}">
    <label id="eProcLabel">${existingLineItems ? "Services" : "Procedure"}</label>
    <div id="eProcField"></div>
    <label>Total Cost</label><input id="eCost" type="number" value="${Number(inv.cost || 0)}" ${existingLineItems ? "readonly" : ""}>
    <label>Discount (PKR)</label><input id="eDiscount" type="number" value="${Number(inv.discount || 0)}" placeholder="0">
    <label>Notes</label>
    <textarea id="eNotes" class="billing-notes" placeholder="Treatment notes, observations..." rows="3"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" id="eCancel" class="btn btn-secondary">Cancel</button>
      <button type="button" id="eSave" class="btn btn-primary">Save</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const eCost = ov.querySelector("#eCost"); let lineEditor = null, onDocClick = null;
  if (existingLineItems) {
    const listId = `eProcList-${Date.now()}`;
    ov.querySelector("#eProcField").innerHTML = `<datalist id="${listId}">${billingProcedureOptionTags()}</datalist><div data-line-items-editor><div data-line-items-rows></div><button type="button" class="btn btn-secondary btn-small" data-add-service style="margin:4px 0 12px;">Add Service</button><div data-line-items-total style="font-weight:700;font-size:14px;margin-bottom:8px;">Total: PKR ${Number(inv.cost || 0).toLocaleString()}</div></div>`;
    lineEditor = attachLineItemsEditor(ov.querySelector("[data-line-items-editor]"), { listId, initialItems: existingLineItems.map((i) => ({ name: i.name, cost: i.cost })), onTotalChange: (total) => { eCost.value = String(total); } });
  } else {
    ov.querySelector("#eProcField").innerHTML = `<div id="eProcWrap" style="position:relative;"><input id="eProc" type="text" value="${escapeHtml(String(inv.procedure || ""))}" autocomplete="off" style="width:100%; padding:8px; border:1px solid #ccd; border-radius:8px; font-size:14px; box-sizing:border-box;"><div id="eProcDropdown" style="display:none; position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:9999; background:#fff; border:1px solid #ccd; border-radius:8px; box-shadow:0 10px 24px rgba(0,0,0,0.12); max-height:200px; overflow-y:auto;"></div></div>`;
    const procWrap = ov.querySelector("#eProcWrap"); const procInput = ov.querySelector("#eProc"); const procDropdown = ov.querySelector("#eProcDropdown");
    const renderProcedureOptions = (needle = "") => {
      const q = String(needle || "").trim().toLowerCase(); const filtered = procedures.filter((p) => p.toLowerCase().includes(q));
      procDropdown.innerHTML = filtered.map((p) => `<div class="e-proc-item" data-value="${escapeHtml(p)}" style="padding:8px 12px; cursor:pointer;">${escapeHtml(p)}</div>`).join("");
      if (!filtered.length) procDropdown.innerHTML = '<div style="padding:8px 12px; color:#6b7280;">No matches</div>';
    };
    procInput.addEventListener("focus", () => { renderProcedureOptions(procInput.value); procDropdown.style.display = "block"; });
    procInput.addEventListener("click", () => { renderProcedureOptions(procInput.value); procDropdown.style.display = "block"; });
    procInput.addEventListener("input", () => { renderProcedureOptions(procInput.value); procDropdown.style.display = "block"; });
    procDropdown.addEventListener("mouseover", (e) => { const item = e.target.closest(".e-proc-item"); if (item) item.style.background = "#f0f9f9"; });
    procDropdown.addEventListener("mouseout", (e) => { const item = e.target.closest(".e-proc-item"); if (item) item.style.background = "transparent"; });
    procDropdown.addEventListener("click", (e) => { const item = e.target.closest(".e-proc-item"); if (!item) return; procInput.value = item.dataset.value || ""; procDropdown.style.display = "none"; });
    onDocClick = (e) => { if (!procWrap.contains(e.target)) procDropdown.style.display = "none"; };
    document.addEventListener("click", onDocClick);
  }

  ov.querySelector("#eNotes").value = inv.notes ?? "";
  ov.querySelector("#eCancel").onclick = () => { if (onDocClick) document.removeEventListener("click", onDocClick); ov.remove(); };
  ov.querySelector("#eSave").onclick = async () => {
    const notes = (ov.querySelector("#eNotes").value || "").trim(); const discount = Number(ov.querySelector("#eDiscount").value || 0);
    let procedure, cost, line_items;
    if (lineEditor) { line_items = lineEditor.collectItems(); if (!line_items.length) return showToast("Add at least one service with procedure and cost", "error"); procedure = line_items.map((i) => i.name).join(", "); cost = line_items.reduce((s, i) => s + i.cost, 0); }
    else { procedure = readProcedureChoice(ov.querySelector("#eProc")); if (!procedure) return showToast("Procedure is required", "error"); cost = Number(eCost.value || 0); }
    const payload = { id: inv.id, created_at: new Date(`${ov.querySelector("#eDate").value}T12:00:00`).getTime(), procedure, cost, lab_cost: 0, discount, notes };
    if (line_items) payload.line_items = line_items;
    await window.api.invoices.update(payload); showToast("Invoice updated");
    if (onDocClick) document.removeEventListener("click", onDocClick); ov.remove(); onSave?.();
  };
}

async function openAddAppointmentModal() {
  const plist = await withLoading(() => window.api.patients.list());
  if (!plist || !plist.length) { showToast("Add at least one patient before scheduling appointments.", "error"); return; }
  const dv = document.createElement("div"); dv.className = "modal modal--appt";
  const hh = String(new Date().getHours()).padStart(2, "0"); const mm = String(new Date().getMinutes()).padStart(2, "0");
  dv.innerHTML = `<div class="modal-content modal-content--appt">
    <h2 class="modal-card-title">Add Appointment</h2>
    <div class="modal-form-stack">
      <label for="amPatient">Patient</label><select id="amPatient"></select>
      <label for="amDoctor">Doctor</label><input id="amDoctor" type="text" placeholder="Doctor name">
      <label for="amProcedure">Procedure</label><input id="amProcedure" type="text" placeholder="Procedure">
      <label for="amDate">Date</label><input id="amDate" type="date" value="${localYMD(new Date())}">
      <label for="amTime">Time</label><input id="amTime" type="time" value="${hh}:${mm}">
    </div>
    <div class="modal-actions-row">
      <button type="button" id="amSave" class="btn btn-primary">Save</button>
      <button type="button" id="amCancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(dv);
  const psel = dv.querySelector("#amPatient");
  (plist || []).forEach((p) => {
    const idPart = String(p.id ?? p.external_id ?? "").trim(); if (!idPart) return;
    const o = document.createElement("option"); o.value = idPart; o.dataset.name = p.name || p["Patient Name"] || "";
    const mr = String(p.external_id ?? p["Case No."] ?? "").trim(); const nm = (p.name || p["Patient Name"] || "").trim();
    o.textContent = mr ? `${mr} — ${nm || mr}` : nm || idPart; psel.appendChild(o);
  });
  dv.querySelector("#amCancel").onclick = () => dv.remove();
  dv.querySelector("#amSave").onclick = async () => {
    const amSel = dv.querySelector("#amPatient"); if (!amSel?.value) return showToast("Select patient", "error");
    await window.api.appts.add({ doctor: (dv.querySelector("#amDoctor").value || "").trim(), patient_id: amSel.value, patient_name: amSel.options[amSel.selectedIndex]?.dataset?.name || "", procedure: (dv.querySelector("#amProcedure").value || "").trim(), date: dv.querySelector("#amDate").value, time: dv.querySelector("#amTime").value, status: "yellow" });
    showToast("Appointment added"); dv.remove(); drawCalendar();
  };
}

function openNewPatientModal() {
  const dv = document.createElement("div"); dv.className = "modal modal--appt";
  dv.innerHTML = `<div class="modal-content modal-content--appt">
    <h2 class="modal-card-title">New Patient</h2>
    <div class="modal-form-stack">
      <label for="npCaseNo">Case No</label><input id="npCaseNo" type="text" placeholder="Leave blank for auto">
      <label for="npName">Name</label><input id="npName" type="text" placeholder="Full name">
      <label for="npAge">Age</label><input id="npAge" type="text" placeholder="Age">
      <label for="npGender">Gender</label>
      <select id="npGender"><option value="">Select…</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select>
      <label for="npPhone">Phone</label><input id="npPhone" type="text" placeholder="Phone">
      <label for="npAddress">Address</label><input id="npAddress" type="text" placeholder="Address">
    </div>
    <div class="modal-actions-row">
      <button type="button" id="npSave" class="btn btn-primary">Save</button>
      <button type="button" id="npCancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(dv);
  dv.querySelector("#npCancel").onclick = () => dv.remove();
  dv.querySelector("#npSave").onclick = async () => {
    const p = { external_id: (dv.querySelector("#npCaseNo").value || "").trim() || undefined, name: dv.querySelector("#npName").value || "", age: dv.querySelector("#npAge").value || "", gender: dv.querySelector("#npGender").value || "", phone: dv.querySelector("#npPhone").value || "", address: dv.querySelector("#npAddress").value || "" };
    if (!p.name.trim()) return showToast("Name is required", "error");
    await window.api.patients.save(p); showToast("Patient saved"); dv.remove(); await refreshPatientsCache(); renderPatientList();
  };
}

function openApptModal(a) {
  const ov = document.createElement("div"); ov.className = "modal";
  ov.innerHTML = `<div class="modal-content">
    <h3>Appointment</h3>
    <p><b>Case:</b> ${a.patient_id || "—"}</p><p><b>Name:</b> ${a.patient_name || "—"}</p>
    <p><b>Date:</b> ${displayDateYYYYMMDD(a.date)}</p><p><b>Time:</b> ${fmt12(a.time || "")}</p>
    <label>Status Color</label>
    <select id="statusSel" style="width:100%;min-height:44px;">
      <option value="yellow">Yellow — Scheduled</option><option value="blue">Blue — In Progress</option>
      <option value="green">Green — Fulfilled</option><option value="red">Red — Cancelled</option>
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
  ov.querySelector("#delBtn").onclick = async () => { if (!confirm("Delete this appointment?")) return; await window.api.appts.delete(a.id); showToast("Appointment deleted"); ov.remove(); drawCalendar(); };
  ov.querySelector("#saveBtn").onclick = async () => { await window.api.appts.update({ id: a.id, status: ov.querySelector("#statusSel").value }); showToast("Appointment updated"); ov.remove(); drawCalendar(); };
}

function openDrawer(type, patient = null) {
  if (type !== "patient") return;
  $("#drawerTitle").textContent = patient ? "Edit Patient" : "New Patient";
  const dr = $("#drawer"); const c = $("#drawerContent"); c.innerHTML = ""; dr.dataset.editId = patient?.id || "";
  c.innerHTML = `<label>Case No</label><input id="pCaseNo" placeholder="Leave blank for auto"><label>Name</label><input id="pName"><label>Age</label><input id="pAge"><label>Gender</label><input id="pGender"><label>Phone</label><input id="pPhone"><label>Address</label><input id="pAddress">`;
  if (patient) { $("#pCaseNo").value = patient.external_id || ""; $("#pName").value = patient.name || ""; $("#pAge").value = patient.age || ""; $("#pGender").value = patient.gender || ""; $("#pPhone").value = patient.phone || ""; $("#pAddress").value = patient.address || ""; }
  dr.dataset.type = "patient"; dr.classList.remove("hidden"); dr.setAttribute("aria-hidden", "false");
}

function closeDrawer() { const dr = $("#drawer"); dr.classList.add("hidden"); dr.setAttribute("aria-hidden", "true"); }

async function saveDrawer() {
  if ($("#drawer").dataset.type !== "patient") return;
  const p = { id: $("#drawer").dataset.editId || undefined, external_id: ($("#pCaseNo").value || "").trim() || undefined, name: $("#pName").value || "", age: $("#pAge").value || "", gender: $("#pGender").value || "", phone: $("#pPhone").value || "", address: $("#pAddress").value || "" };
  if (!p.name.trim()) return showToast("Name is required", "error");
  await window.api.patients.save(p); showToast("Patient saved"); closeDrawer(); await refreshPatientsCache(); renderPatientList();
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!localStorage.getItem("cp_token")) return;
  mountSettingsSection(); applyTheme(localStorage.getItem("cp_theme") || "cyan");
  const m = new Date(); $("#billingMonth").value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
  $$(".nav-btn[data-nav]").forEach((el) => (el.onclick = () => setActiveNav(el.dataset.nav)));
  const signOutBtn = document.querySelector(".sign-out-btn");
  if (signOutBtn) { signOutBtn.onclick = () => { localStorage.removeItem("cp_token"); window.location.href = "https://app.faseehdentalclinic.com/login.html"; }; }
  $("#prevMonth").onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); drawCalendar(); };
  $("#nextMonth").onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); drawCalendar(); };
  $("#newPatient").onclick = () => openNewPatientModal(); $("#addAppt").onclick = () => openAddAppointmentModal();
  $("#drawerClose").onclick = closeDrawer; $("#drawerSave").onclick = saveDrawer;
  $("#search").addEventListener("input", () => renderPatientList());
  $("#backToPatients").onclick = () => { hidePatientProfile(); renderPatientList(); };
  $$("#patientTabs .tab").forEach((t) => (t.onclick = () => openTab(t.dataset.tab)));
  $("#billingMonth").onchange = renderClinicBilling;
  $("#billingAllTime").onclick = () => { billingAllTime = !billingAllTime; const btn = $("#billingAllTime"); btn.classList.toggle("active", billingAllTime); btn.textContent = billingAllTime ? "All Time (on)" : "All Time"; renderClinicBilling(); };
  $$("#clinicBillingTabs .tab").forEach((t) => {
    t.onclick = () => { clinicBillingView = t.dataset.billingView || "invoices"; renderClinicBilling(); };
  });
  $("#downloadPdf").onclick = () => {
    const ym = $("#billingMonth").value;
    const label = billingAllTime ? "All Time" : ym;
    const rows = Array.from($("#clinicBillingBody")?.querySelectorAll("tr") || []);
    const invEl = $("#billingSummaryInvoiced")?.textContent || "—";
    const colEl = $("#billingSummaryCollected")?.textContent || "—";
    const outEl = $("#billingSummaryOutstanding")?.textContent || "—";

    const rowsHtml = rows.map(tr => {
      const cells = Array.from(tr.querySelectorAll("td")).map(td => `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${td.textContent}</td>`);
      return `<tr>${cells.join("")}</tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Billing Report — ${label}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 32px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .clinic-name { font-size: 20px; font-weight: 700; color: #2d3748; }
    .clinic-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .report-title { font-size: 14px; font-weight: 600; color: #374151; text-align: right; }
    .report-period { font-size: 12px; color: #6b7280; text-align: right; }
    hr { border: none; border-top: 2px solid #009688; margin: 0 0 20px; }
    .kpis { display: flex; gap: 16px; margin-bottom: 24px; }
    .kpi { flex: 1; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; }
    .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
    .kpi-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #2d3748; color: white; }
    thead th { padding: 10px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .footer { margin-top: 24px; font-size: 10px; color: #9ca3af; text-align: center; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="clinic-name">Faseeh Dental Clinic</div>
      <div class="clinic-sub">Dr. Faseeh Ur Rehman | BDS | RDS</div>
      <div class="clinic-sub">+923211507943 | faseehdentalclinic@gmail.com</div>
    </div>
    <div>
      <div class="report-title">BILLING REPORT</div>
      <div class="report-period">Period: ${label}</div>
      <div class="report-period">Generated: ${new Date().toLocaleDateString("en-GB")}</div>
    </div>
  </div>
  <hr>
  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Total Invoiced</div><div class="kpi-value">PKR ${invEl}</div></div>
    <div class="kpi"><div class="kpi-label">Total Collected</div><div class="kpi-value">PKR ${colEl}</div></div>
    <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">PKR ${outEl}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>MR No</th><th>Patient Name</th><th>Procedure</th>
        <th>Invoice Total</th><th>Paid</th><th>Due</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">Powered by CyberHealth Solutions | Meesum Mir — Generated ${new Date().toLocaleString("en-GB")}</div>
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
  };
  $("#backupDataBtn").onclick = async () => { try { const res = await withLoading(() => window.api.patients.syncSheets()); if (res?.ok === false) throw new Error(res.error || "Backup failed"); window.alert(typeof res === "object" && res !== null ? JSON.stringify(res) : String(res ?? "Backup completed.")); } catch (e) { window.alert(`Backup failed: ${e.message || String(e)}`); } };
  $("#deleteAllPatients").onclick = async () => { if (!confirm("Delete ALL patients? This cannot be undone.")) return; await withLoading(() => window.api.patients.deleteAll()); showToast("All patients deleted"); await refreshPatientsCache(); renderPatientList(); };
  $("#editPatient").onclick = async () => { if (!currentPatient) return; const p = await withLoading(() => window.api.patients.get(currentPatient.id || currentPatient.external_id)); openDrawer("patient", p || currentPatient); };
  $("#deletePatient").onclick = async () => { if (!currentPatient) return; if (!confirm(`Delete ${currentPatient.name || "this patient"}?`)) return; try { await window.api.patients.delete(currentPatient.id || currentPatient.external_id); showPatientBrowse(); showToast("Patient deleted"); await refreshPatientsCache(); renderPatientList(); } catch (e) { showToast(e.message || "Couldn't delete patient", "error"); } };
  $$(".themeSwatch").forEach((el) => { el.onclick = () => applyTheme(el.dataset.theme); });
  $("#billingAllTime").textContent = "All Time";
  await Promise.all([drawCalendar(), renderClinicBilling()]);
  setActiveNav("home");
});

function openMultiServiceModal(pid, onSave) {
  const today = new Date().toISOString().split("T")[0];
  const procedures = ["RCT","Scaling","Extraction","Diagnosis","Filling","Crown","Denture","Bridge","Implant","Whitening","Other"];
  const ov = document.createElement("div"); ov.className = "modal"; ov.style.zIndex = "10000";
  ov.innerHTML = `
    <div class="modal-content" style="width:560px; max-width:95vw; max-height:85vh; overflow-y:auto;">
      <h3 style="margin:0 0 16px 0;">Multi-Service Invoice</h3>
      <label>Date</label>
      <input id="msDate" type="date" value="${today}" style="width:100%;padding:8px;border:1px solid #ccd;border-radius:8px;margin-bottom:12px;">
      <label>Services</label>
      <div id="msLineItems" style="margin-bottom:8px;"></div>
      <button id="msAddRow" class="btn ghost small" style="margin-bottom:12px;">+ Add Service</button>
      <div id="msTotal" style="text-align:right;font-weight:700;font-size:15px;margin-bottom:12px;">Total: PKR 0</div>
      <label>Discount (PKR)</label>
      <input id="msDiscount" type="number" placeholder="0" style="width:100%;padding:8px;border:1px solid #ccd;border-radius:8px;margin-bottom:12px;" min="0">
      <label>Paid Now (PKR)</label>
      <input id="msPaidAmount" type="number" placeholder="0" style="width:100%;padding:8px;border:1px solid #ccd;border-radius:8px;margin-bottom:12px;" min="0">
      <label>Notes</label>
      <textarea id="msNotes" style="width:100%;padding:8px;border:1px solid #ccd;border-radius:8px;min-height:60px;margin-bottom:16px;" placeholder="Treatment notes..."></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="msCancel" class="btn">Cancel</button>
        <button id="msSave" class="btn primary">Save Invoice</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const lineItemsDiv = ov.querySelector("#msLineItems"); const totalDiv = ov.querySelector("#msTotal");

  function addRow(name = "", cost = "") {
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;margin-bottom:8px;align-items:center;";
    row.innerHTML = `<input type="text" list="msProcList" placeholder="Procedure" value="${name}" style="flex:2;padding:8px;border:1px solid #ccd;border-radius:8px;"><datalist id="msProcList">${procedures.map((p) => `<option value="${p}">`).join("")}</datalist><input type="number" placeholder="Cost (PKR)" value="${cost}" style="flex:1;padding:8px;border:1px solid #ccd;border-radius:8px;" min="0"><button class="btn danger small" style="padding:6px 10px;">×</button>`;
    row.querySelector("button").onclick = () => { if (lineItemsDiv.children.length > 1) { row.remove(); updateTotal(); } };
    row.querySelectorAll("input").forEach((i) => i.addEventListener("input", updateTotal));
    lineItemsDiv.appendChild(row); updateTotal();
  }

  function updateTotal() {
    let total = 0; lineItemsDiv.querySelectorAll("div").forEach((row) => { const inputs = row.querySelectorAll("input"); total += Number(inputs[1]?.value || 0); });
    totalDiv.textContent = "Total: PKR " + total.toLocaleString(); return total;
  }

  function getLineItems() {
    const items = [];
    lineItemsDiv.querySelectorAll("div").forEach((row) => { const inputs = row.querySelectorAll("input"); const name = inputs[0]?.value?.trim(); const cost = Number(inputs[1]?.value || 0); if (name && cost > 0) items.push({ name, cost }); });
    return items;
  }

  addRow(); addRow();
  ov.querySelector("#msAddRow").onclick = () => addRow();
  ov.querySelector("#msCancel").onclick = () => ov.remove();
  ov.querySelector("#msSave").onclick = async () => {
    const items = getLineItems(); if (!items.length) { alert("Add at least one service with a cost."); return; }
    const total = items.reduce((s, i) => s + i.cost, 0);
    const discountVal = Number(ov.querySelector("#msDiscount").value || 0);
    const dateStr = ov.querySelector("#msDate").value; const notes = ov.querySelector("#msNotes").value;
    const btn = ov.querySelector("#msSave"); btn.disabled = true; btn.textContent = "Saving...";
    try {
      const invRes = await window.api.invoices.add({ patient_id: pid, procedure: items.map((i) => i.name).join(", "), cost: total, lab_cost: 0, discount: discountVal, notes, created_at: new Date(dateStr + "T00:00:00").getTime(), line_items: items });
      const paidNow = Number(ov.querySelector("#msPaidAmount")?.value || 0);
      if (paidNow > 0) {
        await window.api.payments.add({
          invoice_id: invRes.invoice.id,
          patient_id: pid,
          date: localYMD(new Date()),
          amount: paidNow,
          payment_mode: "Cash"
        });
      }
      ov.remove(); if (onSave) onSave();
    } catch (e) {
      showToast(e.message || "Could not save invoice", "error");
      btn.disabled = false; btn.textContent = "Save";
    }
  };
}
