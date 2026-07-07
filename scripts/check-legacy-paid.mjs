/**
 * Check invoices for legacy `paid` field > 0.
 * Run: GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json node scripts/check-legacy-paid.mjs
 * Add --migrate to create payment docs (deduped).
 */
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const EXECUTE = process.argv.includes("--migrate");

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "clinicpilot-fdc-20cd3",
  });
}
const db = getFirestore();

function paymentDateFromInvoice(inv) {
  const ts = inv.created_at;
  if (ts && typeof ts.toDate === "function") {
    return ts.toDate().toISOString().slice(0, 10);
  }
  if (typeof inv.date === "string" && inv.date) return inv.date.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const invSnap = await db.collection("invoices").get();
  const affected = [];

  for (const invDoc of invSnap.docs) {
    const inv = invDoc.data();
    const legacyPaid = Number(inv.paid || 0);
    if (legacyPaid > 0) {
      affected.push({ id: invDoc.id, paid: legacyPaid, patient_id: inv.patient_id });
    }
  }

  console.log(`Legacy invoices with paid > 0: ${affected.length}`);
  if (!affected.length) {
    console.log("No migration needed.");
    return;
  }

  console.log("Affected invoice IDs:");
  for (const row of affected) {
    console.log(`  ${row.id}  paid=${row.paid}  patient_id=${row.patient_id}`);
  }

  if (!EXECUTE) {
    console.log("\nDry run only. Pass --migrate to create payment docs.");
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const row of affected) {
    const existing = await db
      .collection("payments")
      .where("invoice_id", "==", row.id)
      .limit(1)
      .get();
    if (!existing.empty) {
      skipped += 1;
      console.log(`SKIP ${row.id}: payment doc already exists`);
      continue;
    }

    const invSnap = await db.collection("invoices").doc(row.id).get();
    const inv = invSnap.data() || {};
    await db.collection("payments").add({
      invoice_id: row.id,
      patient_id: String(inv.patient_id || row.patient_id || ""),
      date: paymentDateFromInvoice(inv),
      amount: row.paid,
      payment_mode: "Cash",
    });
    created += 1;
    console.log(`CREATE payment for invoice ${row.id}: PKR ${row.paid}`);
  }

  console.log({ created, skipped });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
