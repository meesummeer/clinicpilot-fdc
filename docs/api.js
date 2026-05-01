const BASE = "/clinicpilot-fdc";
import "./firebase.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

(function checkAuth() {
  const token = localStorage.getItem("cp_token");
  if (!token) {
    window.location.href = "/clinicpilot-fdc/login.html";
  }
})();

const db = window.db;
const {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  query,
  where
} = window.fbLib;

function localYMD(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function patientFromSnap(snap) {
  if (!snap.exists) return null;
  const d = snap.data() || {};
  const id = snap.id;
  return {
    ...d,
    id,
    external_id: id
  };
}

function mapInvoiceSnapshot(s) {
  const d = s.data();
  return {
    ...d,
    id: s.id,
    patient_id: d.patient_id != null ? String(d.patient_id) : "",
    created_at: toMillis(d.created_at),
    cost: Number(d.cost || 0),
    lab_cost: Number(d.lab_cost || 0),
    notes: d.notes ?? "",
    procedure: d.procedure ?? "",
    status: String(d.status || "unpaid").toLowerCase()
  };
}

function pruneUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function finalizeInvoiceRow(inv, paymentsForInv) {
  const paid =
    paymentsForInv == null
      ? null
      : paymentsForInv.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (paid == null) return inv;
  const cost = Number(inv.cost || 0);
  let st = inv.status || "unpaid";
  const tol = 1e-6;
  if (paid <= tol) st = "unpaid";
  else if (paid + tol >= cost) st = "paid";
  else st = "partial";
  return { ...inv, status: st };
}

function mapPaymentSnap(s) {
  const d = s.data();
  return {
    id: s.id,
    invoice_id: d.invoice_id != null ? String(d.invoice_id) : "",
    patient_id: d.patient_id != null ? String(d.patient_id) : "",
    date: String(d.date || ""),
    amount: Number(d.amount || 0),
    payment_mode: d.payment_mode || ""
  };
}

function mapNoteSnap(s) {
  const d = s.data();
  return {
    id: s.id,
    patient_id: d.patient_id,
    text: d.text ?? "",
    at: toMillis(d.at)
  };
}

function mapApptSnap(s) {
  const d = s.data();
  return {
    ...d,
    id: s.id,
    patient_id: d.patient_id != null ? String(d.patient_id) : "",
    date: String(d.date || ""),
    time: String(d.time || ""),
    status: (d.status || "yellow").toLowerCase(),
    doctor: d.doctor || "",
    patient_name: d.patient_name || "",
    procedure: d.procedure || ""
  };
}

function deriveStatusFromTotals(cost, paid) {
  const tol = 1e-6;
  if (paid <= tol) return "unpaid";
  if (paid + tol >= cost) return "paid";
  return "partial";
}

async function sumPaymentsForInvoice(invoiceDocId) {
  const idStr = String(invoiceDocId);
  const qy = query(collection(db, "payments"), where("invoice_id", "==", idStr));
  const snap = await getDocs(qy);
  let sumPaid = 0;
  snap.forEach((d) => {
    sumPaid += Number(d.data().amount || 0);
  });
  return sumPaid;
}

async function refreshInvoicePaymentStatus(invoiceDocId) {
  const idStr = String(invoiceDocId);
  const invRef = doc(db, "invoices", idStr);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists) return;
  const inv = invSnap.data();
  const cost = Number(inv.cost || 0);
  const paid = await sumPaymentsForInvoice(idStr);
  const nextStatus = deriveStatusFromTotals(cost, paid);
  await updateDoc(invRef, { status: nextStatus });
}

async function nextPatientDocId() {
  const snap = await getDocs(collection(db, "patients"));
  let maxNum = 0;
  snap.forEach((d) => {
    const s = String(d.id || "");
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n > maxNum) maxNum = n;
    }
  });
  const next = maxNum > 0 ? maxNum + 1 : 25001;
  return String(next);
}

window.api = {
  patients: {
    async list(q) {
      const snap = await getDocs(collection(db, "patients"));
      let rows = snap.docs.map(patientFromSnap).filter(Boolean);
      const qq = q != null && String(q).trim() !== "" ? String(q).trim().toLowerCase() : "";
      if (qq) {
        rows = rows.filter((p) => {
          const n = String(p.name || "").toLowerCase();
          const ph = String(p.phone || "").toLowerCase();
          const mr = String(p.id || "").toLowerCase();
          return n.includes(qq) || ph.includes(qq) || mr.includes(qq);
        });
      }
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
      return rows;
    },

    async save(p) {
      const name = p.name || "";
      const phone = p.phone ?? "";
      const address = p.address ?? "";
      const age = p.age ?? "";
      const gender = p.gender ?? "";
      let docId;
      if (p.id != null && String(p.id).trim() !== "") {
        docId = String(p.id).trim();
      } else {
        const ext = (p.external_id ?? "").trim();
        docId = ext || (await nextPatientDocId());
      }
      await setDoc(
        doc(db, "patients", docId),
        { name, phone, address, age, gender },
        { merge: true }
      );
      return patientFromSnap(await getDoc(doc(db, "patients", docId)));
    },

    async get(id) {
      const snap = await getDoc(doc(db, "patients", String(id)));
      return patientFromSnap(snap);
    },

    async delete(id) {
      await deleteDoc(doc(db, "patients", String(id)));
    },

    async deleteAll() {
      const snap = await getDocs(collection(db, "patients"));
      await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "patients", d.id))));
    },

    syncSheets: () => Promise.resolve({ ok: true })
  },

  notes: {
    async list(patient_id) {
      const pid = String(patient_id);
      const snap = await getDocs(
        query(collection(db, "notes"), where("patient_id", "==", pid))
      );
      return snap.docs.map(mapNoteSnap).sort((a, b) => Number(a.at) - Number(b.at));
    },

    async add({ patient_id, text }) {
      const ref = await addDoc(collection(db, "notes"), {
        patient_id: String(patient_id),
        text: String(text || ""),
        at: Timestamp.fromMillis(Date.now())
      });
      const s = await getDoc(ref);
      return mapNoteSnap(s);
    },

    async delete({ patient_id: _pid, note_id }) {
      await deleteDoc(doc(db, "notes", String(note_id)));
    }
  },

  invoices: {
    async list(patient_id) {
      const pid = String(patient_id);
      const qy = query(collection(db, "invoices"), where("patient_id", "==", pid));
      const snap = await getDocs(qy);
      const invoices = snap.docs.map((s) => mapInvoiceSnapshot(s));
      invoices.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
      /** attach payment-derived status consistency */
      const paySnap = await getDocs(collection(db, "payments"));
      const pays = paySnap.docs.map(mapPaymentSnap);
      const byInv = pays.reduce((m, p) => {
        const k = String(p.invoice_id);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(p);
        return m;
      }, new Map());
      return invoices.map((inv) => finalizeInvoiceRow(inv, byInv.get(String(inv.id))));
    },

    async add(invPayload) {
      const pid = invPayload.patient_id != null ? String(invPayload.patient_id) : "";
      const createdTs =
        invPayload.created_at != null
          ? Timestamp.fromMillis(Number(invPayload.created_at))
          : Timestamp.fromMillis(Date.now());
      const ref = await addDoc(collection(db, "invoices"), {
        patient_id: pid,
        created_at: createdTs,
        procedure: invPayload.procedure ?? "",
        lab_cost: Number(invPayload.lab_cost || 0),
        cost: Number(invPayload.cost || 0),
        status: (invPayload.status || "unpaid").toLowerCase(),
        notes: invPayload.notes ?? ""
      });
      const merged = mapInvoiceSnapshot(await getDoc(ref));
      return { ok: true, invoice: merged };
    },

    async update(inv) {
      const idStr = String(inv.id);
      const ref = doc(db, "invoices", idStr);
      const patch = pruneUndefined({
        procedure: inv.procedure,
        lab_cost: Number(inv.lab_cost ?? 0),
        cost: Number(inv.cost ?? 0),
        notes: inv.notes ?? "",
        patient_id: inv.patient_id != null ? String(inv.patient_id) : undefined,
        created_at:
          inv.created_at != null
            ? Timestamp.fromMillis(Number(inv.created_at))
            : Timestamp.fromMillis(Date.now())
      });
      await updateDoc(ref, patch);
      await refreshInvoicePaymentStatus(idStr);
    },

    async delete(id) {
      await deleteDoc(doc(db, "invoices", String(id)));
    },

    async all() {
      const snap = await getDocs(collection(db, "invoices"));
      const invoices = snap.docs.map((s) => mapInvoiceSnapshot(s));
      invoices.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));

      const paySnap = await getDocs(collection(db, "payments"));
      const pays = paySnap.docs.map(mapPaymentSnap);
      const byInv = pays.reduce((m, p) => {
        const k = String(p.invoice_id);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(p);
        return m;
      }, new Map());
      return invoices.map((inv) => finalizeInvoiceRow(inv, byInv.get(String(inv.id))));
    }
  },

  payments: {
    async list(params = {}) {
      const invoice_id =
        params.invoice_id !== undefined &&
        params.invoice_id !== null &&
        params.invoice_id !== ""
          ? String(params.invoice_id)
          : null;
      const patient_id =
        params.patient_id !== undefined &&
        params.patient_id !== null &&
        params.patient_id !== ""
          ? String(params.patient_id)
          : null;
      let snap;
      if (invoice_id !== null)
        snap = await getDocs(
          query(collection(db, "payments"), where("invoice_id", "==", invoice_id))
        );
      else if (patient_id !== null)
        snap = await getDocs(query(collection(db, "payments"), where("patient_id", "==", patient_id)));
      else snap = await getDocs(collection(db, "payments"));

      let rows = snap.docs.map(mapPaymentSnap);
      if (invoice_id === null && patient_id === null) return rows.sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      );
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return rows;
    },

    async add(p) {
      const ref = await addDoc(collection(db, "payments"), {
        invoice_id: String(p.invoice_id),
        patient_id: String(p.patient_id),
        date: String(p.date || ""),
        amount: Number(p.amount || 0),
        payment_mode: p.payment_mode || ""
      });
      await refreshInvoicePaymentStatus(p.invoice_id);
      const s = await getDoc(ref);
      return { ok: true, payment: mapPaymentSnap(s) };
    },

    async delete(id, invoice_id) {
      await deleteDoc(doc(db, "payments", String(id)));
      await refreshInvoicePaymentStatus(invoice_id);
    },

    async all() {
      const snap = await getDocs(collection(db, "payments"));
      const rows = snap.docs.map(mapPaymentSnap);
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return rows;
    }
  },

  appts: {
    async list(ym) {
      const snap = await getDocs(collection(db, "appointments"));
      let rows = snap.docs.map(mapApptSnap);
      const prefix = ym != null && ym !== undefined ? String(ym) : "";
      if (prefix) rows = rows.filter((a) => String(a.date).startsWith(prefix));
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
      return rows;
    },

    async add(a) {
      const ref = await addDoc(collection(db, "appointments"), {
        patient_id: String(a.patient_id),
        patient_name: a.patient_name || "",
        doctor: a.doctor || "",
        procedure: a.procedure ?? "",
        date: String(a.date || ""),
        time: String(a.time || ""),
        status: (a.status || "yellow").toLowerCase()
      });
      return mapApptSnap(await getDoc(ref));
    },

    async update(appt) {
      const idStr = String(appt.id);
      const { id: _id, ...rest } = appt;
      const patch = pruneUndefined({
        patient_id:
          rest.patient_id !== undefined ? String(rest.patient_id) : undefined,
        patient_name: rest.patient_name,
        doctor: rest.doctor,
        procedure: rest.procedure,
        date: rest.date !== undefined ? String(rest.date) : undefined,
        time: rest.time !== undefined ? String(rest.time) : undefined,
        status: rest.status != null ? String(rest.status).toLowerCase() : undefined
      });
      await updateDoc(doc(db, "appointments", idStr), patch);
    },

    async delete(id) {
      await deleteDoc(doc(db, "appointments", String(id)));
    },

    async get(id) {
      const snap = await getDoc(doc(db, "appointments", String(id)));
      if (!snap.exists) return null;
      return mapApptSnap(snap);
    },

    async nextFor(patient_id) {
      const pid = String(patient_id);
      const today = localYMD(new Date());
      const snap = await getDocs(collection(db, "appointments"));
      const rows = snap
        .docs
        .map(mapApptSnap)
        .filter((a) => String(a.patient_id) === pid && String(a.date) >= today);
      rows.sort(
        (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time))
      );
      return rows[0] ?? null;
    }
  },

  ui: {
    openExternal: (url) => {
      window.open(url, "_blank");
      return Promise.resolve(true);
    },
    revealInFolder: () => Promise.resolve(true)
  },

  whatsapp: {
    open: ({ phone, message }) => {
      const encoded = encodeURIComponent(message || "");
      const clean = (phone || "").replace(/\D/g, "");
      window.open(`https://wa.me/${clean}?text=${encoded}`, "_blank");
      return Promise.resolve(true);
    }
  },

  report: {
    syncMonthly: (_ym) => Promise.resolve({ ok: true })
  },

  auth: {
    logout: () => {
      localStorage.removeItem("cp_token");
      window.location.href = "/clinicpilot-fdc/login.html";
    }
  }
};

document.body.style.display = "block";
