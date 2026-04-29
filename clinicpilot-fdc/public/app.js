const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let currentPatient = null;
let currentPatientKey = null;
let currentMonth = new Date();

/* ----- Helpers ----- */
function fmt12(timeHHMM=""){
  // "14:05" -> "2:05 PM"
  if(!/^\d{2}:\d{2}$/.test(timeHHMM)) return timeHHMM || "";
  const [H,M]=timeHHMM.split(':').map(Number);
  const ampm = H>=12?'PM':'AM';
  const h = ((H+11)%12)+1;
  return `${h}:${String(M).padStart(2,'0')} ${ampm}`;
}

function parseTimeToHHMM(input=""){
  // Accepts: "14:05" or "2:05 PM" or "2 PM" etc. Returns "HH:MM" (24h) or null.
  const s = String(input||"").trim();
  if(!s) return null;
  if(/^\d{2}:\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if(!m) return null;

  let h = parseInt(m[1],10);
  let min = m[2] ? parseInt(m[2],10) : 0;
  const ap = m[3].toUpperCase();

  if(isNaN(h) || isNaN(min) || h<1 || h>12 || min<0 || min>59) return null;
  if(ap==="AM"){ if(h===12) h=0; }
  if(ap==="PM"){ if(h!==12) h+=12; }

  return String(h).padStart(2,'0') + ":" + String(min).padStart(2,'0');
}


function localYMD(d){
  const y=d.getFullYear();
  const mth=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${mth}-${day}`;
}


function patientKey(p){
  if(!p) return '';
  return String(p.id || p.external_id || p['Case No.'] || '').trim();
}
/* ----- Month picker (no window.prompt) ----- */
function askMonth(defaultYM){
  return new Promise(resolve=>{
    const ov = document.createElement('div');
    ov.style.position='fixed'; ov.style.inset='0';
    ov.style.background='rgba(0,0,0,.35)'; ov.style.display='grid';
    ov.style.placeItems='center'; ov.style.zIndex='9999';

    const box = document.createElement('div');
    box.style.background='#fff'; box.style.padding='16px';
    box.style.borderRadius='12px'; box.style.width='320px';
    box.style.boxShadow='0 10px 30px rgba(0,0,0,.25)';
    box.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Select month</h3>
      <input id="monthInput" type="month" style="width:100%;padding:8px;border:1px solid #ccd;border-radius:8px;">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button id="mCancel" class="btn">Cancel</button>
        <button id="mOk" class="btn primary">Open Report</button>
      </div>
    `;
    ov.appendChild(box);
    document.body.appendChild(ov);

    const mi = box.querySelector('#monthInput');
    const nowDef = defaultYM || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    mi.value = nowDef;

    box.querySelector('#mCancel').onclick = ()=>{ document.body.removeChild(ov); resolve(null); };
    box.querySelector('#mOk').onclick = ()=>{
      const v = mi.value; // 2025-09
      if(!/^\d{4}-\d{2}$/.test(v)) return;
      document.body.removeChild(ov); resolve(v);
    };
  });
}

/* ----- Patients list ----- */
async function loadList(query="") {
  const patients = await window.api.patients.list(query);
  const list = $('#patientList');
  list.innerHTML = "";
  patients.forEach(p=>{
    const div = document.createElement('div');
    const key = patientKey(p);
    div.className = 'patient' + (currentPatientKey && key && key===currentPatientKey ? ' active' : '');
    div.dataset.key = key;
    div.textContent = `${p.external_id||p['Case No.']||''} - ${p.name||p['Patient Name']||''}`;
    div.onclick = ()=>{
      currentPatientKey = key;
      openProfile(p);
      // Visual immediate highlight
      $$('#patientList .patient').forEach(x=>x.classList.remove('active'));
      div.classList.add('active');
    };
    list.appendChild(div);
  });

  // Keep selection visible when list refreshes
  if(currentPatientKey){
    const el = list.querySelector(`.patient[data-key="${currentPatientKey}"]`);
    if(el) el.scrollIntoView({block:'nearest'});
  }
}
/* ----- Views ----- */
function show(view){
  $('#homeView').classList.add('hidden');
  $('#profileView').classList.add('hidden');
  $(view).classList.remove('hidden');
}

/* ----- Profile ----- */
async function openProfile(p){
  currentPatient = await window.api.patients.get(p.id||p.external_id) || p;
  currentPatientKey = patientKey(currentPatient);
  show('#profileView');

  $('#profileName').textContent = currentPatient.name || currentPatient['Patient Name'] || "Unnamed";
  $('#profileInfo').textContent = `${currentPatient.external_id||currentPatient['Case No.']||''} | ${currentPatient.phone||currentPatient.Contact||''}`;

  openTab('profile');

  // refresh list highlight
  loadList($('#search')?.value || "");

  $$('#profileView .tab').forEach(t=>{
    t.onclick = ()=>openTab(t.dataset.tab);
  });
}

function openTab(tab){
  $$('#profileView .tab').forEach(t=>t.classList.remove('active'));
  $(`#profileView .tab[data-tab="${tab}"]`).classList.add('active');

  const c = $('#tabContent');
  c.innerHTML = "";

  if(tab==="profile"){
    c.innerHTML = `
      <p><b>Case No:</b> ${currentPatient.external_id||currentPatient['Case No.']||'-'}</p>
      <p><b>Name:</b> ${currentPatient.name||currentPatient['Patient Name']||'-'}</p>
      <p><b>Phone:</b> ${currentPatient.phone||currentPatient.Contact||'-'}</p>
      <p><b>Address:</b> ${currentPatient.address||currentPatient.Address||'-'}</p>
      <p><b>Age:</b> ${currentPatient.age||'-'}</p>
      <p><b>Gender:</b> ${currentPatient.gender||'-'}</p>
    `;
  }
  else if(tab==="soap"){
    const area = document.createElement('textarea');
    area.className = 'note';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn primary small';
    saveBtn.textContent = 'Add Note';

    const notesContainer = document.createElement('div');
    notesContainer.style.marginTop = '12px';

    const renderNotes = async () => {
      notesContainer.innerHTML = '<em style="color:#aaa">Loading notes...</em>';
      const pid = currentPatient.id || currentPatient.external_id;
      const notes = await window.api.notes.list(pid);
      notesContainer.innerHTML = '';
      (notes || []).forEach(n => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '8px';
        row.style.marginBottom = '6px';
        const txt = document.createElement('div');
        txt.textContent = `${new Date(n.at).toLocaleString()}: ${n.text}`;
        const del = document.createElement('button');
        del.textContent = '×';
        del.title = 'Delete note';
        del.className = 'btn danger small';
        del.onclick = async () => {
          await window.api.notes.delete({ patient_id: pid, note_id: n.id });
          renderNotes();
        };
        row.append(txt, del);
        notesContainer.appendChild(row);
      });
    };

    saveBtn.onclick = async () => {
      const text = (area.value || '').trim();
      if (!text) return;
      saveBtn.disabled = true;
      await window.api.notes.add({ patient_id: currentPatient.id || currentPatient.external_id, text });
      area.value = '';
      saveBtn.disabled = false;
      renderNotes();
    };

    c.append(area, saveBtn, notesContainer);
    renderNotes();
  }
  else if(tab==="billing"){
  const pid = currentPatient.id || currentPatient.external_id;
  const today = new Date();
  const defaultDate = localYMD(today);

  // --- Add Invoice form (procedure record only) ---
  const form = document.createElement('div');
  form.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <label>Date</label>
        <input id="bDate" type="date" value="${defaultDate}">
      </div>
      <div>
        <label>Procedure</label>
        <input id="bProcedure" list="procList" placeholder="Select or type">
        <datalist id="procList">
          <option value="RCT"></option>
          <option value="Scaling"></option>
          <option value="Extraction"></option>
          <option value="Diagnosis"></option>
          <option value="Filling"></option>
          <option value="Crown"></option>
          <option value="Other"></option>
        </datalist>
      </div>
      <div>
        <label>Total Cost (PKR)</label>
        <input id="bCost" type="number" min="0" step="1" placeholder="0">
      </div>
      <div>
        <label>Lab Cost (PKR)</label>
        <input id="bLab" type="number" min="0" step="1" placeholder="0">
      </div>
    </div>
  `;
  const addInvBtn = document.createElement('button');
  addInvBtn.className = 'btn primary small';
  addInvBtn.textContent = '+ Add Invoice';
  addInvBtn.style.marginTop = '8px';
  addInvBtn.onclick = async () => {
    const procedure = (document.getElementById('bProcedure').value || '').trim();
    if (!procedure) { alert('Procedure is required'); return; }
    const cost = Number(document.getElementById('bCost').value || 0);
    const lab_cost = Number(document.getElementById('bLab').value || 0);
    const dateStr = document.getElementById('bDate').value || defaultDate;
    const created_at = new Date(dateStr + 'T00:00:00').getTime();
    addInvBtn.disabled = true;
    addInvBtn.textContent = 'Saving...';
    await window.api.invoices.add({ patient_id: pid, procedure, cost, lab_cost, created_at });
    addInvBtn.disabled = false;
    addInvBtn.textContent = '+ Add Invoice';
    document.getElementById('bProcedure').value = '';
    document.getElementById('bCost').value = '';
    document.getElementById('bLab').value = '';
    renderBilling();
  };

  c.append(form, addInvBtn);

  // --- Invoices list with payments ---
  const listWrap = document.createElement('div');
  listWrap.className = 'section';
  listWrap.id = 'billingList';
  c.appendChild(listWrap);

  const statusBadge = (status) => {
    const map = { paid: '#e8f5e9|#2e7d32|Paid', partial: '#fff8e1|#f57f17|Partial', unpaid: '#ffebee|#c62828|Unpaid' };
    const [bg, color, label] = (map[status] || map.unpaid).split('|');
    return `<span style="background:${bg};color:${color};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">${label}</span>`;
  };

  async function renderBilling() {
    listWrap.innerHTML = '<p style="color:#aaa;font-size:13px;">Loading...</p>';
    const [invoices, allPayments] = await Promise.all([
      window.api.invoices.list(pid),
      window.api.payments.list({ patient_id: pid })
    ]);

    listWrap.innerHTML = '';
    if (!invoices.length) {
      listWrap.innerHTML = '<p style="color:#aaa;font-size:13px;">No invoices yet.</p>';
      return;
    }

    invoices.forEach(inv => {
      const invPayments = allPayments.filter(p => p.invoice_id === inv.id);
      const totalPaid = invPayments.reduce((s, p) => s + p.amount, 0);
      const due = Math.max(0, inv.cost - totalPaid);
      const dt = inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '';

      const block = document.createElement('div');
      block.style.cssText = 'border:1px solid #e1e8e8;border-radius:14px;padding:12px;margin-bottom:12px;background:var(--card);';

      // Invoice header row
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;';
      hdr.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:700;">${inv.procedure || ''}</span>
          ${statusBadge(inv.status)}
          <span style="color:var(--muted);font-size:12px;">${dt}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;">Cost: <b>${Number(inv.cost||0).toLocaleString()}</b> PKR</span>
          ${inv.lab_cost ? `<span style="font-size:13px;color:var(--muted)">Lab: ${Number(inv.lab_cost).toLocaleString()}</span>` : ''}
          <span style="font-size:13px;">Paid: <b style="color:#2e7d32">${totalPaid.toLocaleString()}</b></span>
          <span style="font-size:13px;">Due: <b style="color:${due>0?'#c62828':'#2e7d32'}">${due.toLocaleString()}</b></span>
        </div>
      `;

      // Action buttons
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';

      const addPayBtn = document.createElement('button');
      addPayBtn.className = 'btn primary small';
      addPayBtn.textContent = '+ Payment';
      addPayBtn.onclick = () => openPaymentModal(inv, pid, renderBilling);

      const editInvBtn = document.createElement('button');
      editInvBtn.className = 'btn small';
      editInvBtn.textContent = 'Edit';
      editInvBtn.onclick = () => openEditInvoiceModal(inv, renderBilling);

      const delInvBtn = document.createElement('button');
      delInvBtn.className = 'btn danger small';
      delInvBtn.textContent = 'Delete';
      delInvBtn.onclick = async () => {
        if (!confirm('Delete this invoice and all its payments?')) return;
        // Delete associated payments first, then invoice.
        // This keeps invoice-status recalculation on payment deletes valid.
        for (const p of invPayments) {
          await window.api.payments.delete(p.id, inv.id);
        }
        await window.api.invoices.delete(inv.id);
        renderBilling();
      };

      actions.append(addPayBtn, editInvBtn, delInvBtn);

      // Payments sub-table
      const paySection = document.createElement('div');
      paySection.style.marginTop = '10px';
      if (invPayments.length) {
        const pt = document.createElement('table');
        pt.style.cssText = 'width:100%;font-size:12px;';
        pt.innerHTML = `<thead><tr><th>Date</th><th>Amount (PKR)</th><th>Mode</th><th></th></tr></thead><tbody></tbody>`;
        const ptbody = pt.querySelector('tbody');
        invPayments.sort((a,b) => a.date.localeCompare(b.date)).forEach(p => {
          const pr = document.createElement('tr');
          pr.innerHTML = `
            <td>${p.date}</td>
            <td><b>${Number(p.amount).toLocaleString()}</b></td>
            <td>${p.payment_mode || ''}</td>
            <td><button class="btn danger small" style="padding:3px 8px;font-size:11px;">×</button></td>
          `;
          pr.querySelector('button').onclick = async () => {
            if (!confirm('Delete this payment?')) return;
            await window.api.payments.delete(p.id, inv.id);
            renderBilling();
          };
          ptbody.appendChild(pr);
        });
        paySection.appendChild(pt);
      } else {
        paySection.innerHTML = '<p style="font-size:12px;color:#aaa;margin:6px 0 0 0;">No payments recorded yet.</p>';
      }

      block.append(hdr, actions, paySection);
      listWrap.appendChild(block);
    });
  }

  renderBilling();
}

}

/* ----- Payment modal ----- */
function openPaymentModal(inv, patient_id, onSave) {
  const today = new Date();
  const defaultDate = localYMD(today);
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML = `
    <div class="modal-content">
      <h3 style="margin:0 0 4px 0;">Record Payment</h3>
      <p style="margin:0 0 12px 0;font-size:13px;color:var(--muted);">${inv.procedure || ''} — Invoice #${inv.id}</p>
      <label>Payment Date</label>
      <input id="pDate" type="date" value="${defaultDate}">
      <label>Amount (PKR)</label>
      <input id="pAmount" type="number" min="1" step="1" placeholder="0">
      <label>Mode of Payment</label>
      <select id="pMode">
        <option value="Cash">Cash</option>
        <option value="Bank Transfer">Bank Transfer</option>
      </select>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="pCancel" class="btn">Cancel</button>
        <button id="pSave" class="btn primary">Save Payment</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#pCancel').onclick = () => ov.remove();
  ov.querySelector('#pSave').onclick = async () => {
    const date = ov.querySelector('#pDate').value;
    const amount = Number(ov.querySelector('#pAmount').value || 0);
    const payment_mode = ov.querySelector('#pMode').value;
    if (!date || !amount) { alert('Date and amount are required'); return; }
    ov.querySelector('#pSave').disabled = true;
    ov.querySelector('#pSave').textContent = 'Saving...';
    await window.api.payments.add({ invoice_id: inv.id, patient_id, date, amount, payment_mode });
    ov.remove();
    if (onSave) onSave();
  };
}

/* ----- Edit invoice modal ----- */
function openEditInvoiceModal(inv, onSave) {
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML = `
    <div class="modal-content">
      <h3 style="margin:0 0 12px 0;">Edit Invoice #${inv.id}</h3>
      <label>Date <input id="eDate" type="date" value="${localYMD(new Date(inv.created_at))}"></label>
      <label>Procedure <input id="eProc" list="editProcList" value="${inv.procedure || ''}"></label>
      <datalist id="editProcList">
        <option value="RCT"></option>
        <option value="Scaling"></option>
        <option value="Extraction"></option>
        <option value="Diagnosis"></option>
        <option value="Filling"></option>
        <option value="Crown"></option>
        <option value="Other"></option>
      </datalist>
      <label>Total Cost (PKR) <input id="eCost" type="number" value="${inv.cost || 0}"></label>
      <label>Lab Cost (PKR) <input id="eLab" type="number" value="${inv.lab_cost || 0}"></label>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="eCancel" class="btn">Cancel</button>
        <button id="eSave" class="btn primary">Save</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#eCancel').onclick = () => ov.remove();
  ov.querySelector('#eSave').onclick = async () => {
    const procedure = (ov.querySelector('#eProc').value || '').trim();
    if (!procedure) { alert('Procedure is required'); return; }
    const upd = {
      id: inv.id,
      created_at: new Date(ov.querySelector('#eDate').value + 'T00:00:00').getTime(),
      procedure,
      cost: Number(ov.querySelector('#eCost').value || 0),
      lab_cost: Number(ov.querySelector('#eLab').value || 0)
    };
    ov.querySelector('#eSave').disabled = true;
    await window.api.invoices.update(upd);
    ov.remove();
    if (onSave) onSave();
  };
}

/* ----- Appointment Modal (view/delete/set status) ----- */
function openApptModal(a){
  const ov = document.createElement('div');
  ov.style.position='fixed'; ov.style.inset='0';
  ov.style.background='rgba(0,0,0,.4)'; ov.style.display='grid';
  ov.style.placeItems='center'; ov.style.zIndex='9999';

  const box = document.createElement('div');
  box.style.background='var(--card)';
  box.style.color='var(--fg)';
  box.style.padding='16px'; box.style.borderRadius='14px';
  box.style.width='420px'; box.style.maxWidth='95vw';
  box.style.boxShadow='0 14px 40px rgba(0,0,0,.25)';
  const dateNice = new Date(a.date).toLocaleDateString();
  const timeNice = fmt12(a.time||"");
  box.innerHTML = `
    <h3 style="margin:0 0 8px 0;">Appointment</h3>
    <div style="font-size:13px;color:var(--muted);margin-bottom:8px;">Click save to apply a new color code.</div>
    <div class="pill" style="display:inline-block;margin-bottom:10px;">Case: ${a.patient_id||'-'} &nbsp; • &nbsp; ${a.patient_name||''}</div>
    <div style="display:grid;gap:6px;margin-bottom:10px;">
      <div><b>Doctor:</b> ${a.doctor||'-'}</div>
      <div><b>Procedure:</b> ${a.procedure||'-'}</div>
      <div><b>Date:</b> ${dateNice}</div>
      <div><b>Time:</b> ${timeNice}</div>
    </div>

    <label>Status Color</label>
    <select id="statusSel" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccd;">
      <option value="yellow">Yellow — Scheduled</option>
      <option value="blue">Blue — In Progress</option>
      <option value="green">Green — Fulfilled</option>
      <option value="red">Red — Cancelled</option>
    </select>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
      <button id="delBtn" class="btn danger">Delete</button>
      <button id="closeBtn" class="btn">Close</button>
      <button id="saveBtn" class="btn primary">Save</button>
    </div>
  `;
  ov.appendChild(box);
  document.body.appendChild(ov);

  const sel = box.querySelector('#statusSel');
  sel.value = (a.status||'yellow');

  box.querySelector('#closeBtn').onclick = ()=> document.body.removeChild(ov);
  box.querySelector('#delBtn').onclick = async ()=>{
    if(confirm("Delete this appointment?")){
      await window.api.appts.delete(a.id);
      document.body.removeChild(ov);
      drawCalendar();
    }
  };
  box.querySelector('#saveBtn').onclick = async ()=>{
    const status = sel.value;
    const res = await window.api.appts.update({ id: a.id, status });
    if(!res || res.ok===false){ alert(res?.error || 'Failed to update'); return; }
    document.body.removeChild(ov);
    drawCalendar();
  };
}

/* ----- Calendar ----- */
async function drawCalendar() {
  const monthLabel = $('#monthLabel');
  const dayLabels = $('#dayLabels');
  const calGrid = $('#calGrid');

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const ym = `${year}-${String(month+1).padStart(2,'0')}`;

  const monthName = currentMonth.toLocaleString('default',{month:'long'});
  monthLabel.textContent = `${monthName} ${year}`;

  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  dayLabels.innerHTML = days.map(d=>`<div class="day">${d}</div>`).join('');
  calGrid.innerHTML="";

  const firstDay = new Date(year,month,1);
  const startDay=(firstDay.getDay()+6)%7;
  const daysInMonth=new Date(year,month+1,0).getDate();

  for(let i=0;i<startDay;i++) calGrid.innerHTML+='<div class="cell empty"></div>';

  const appts = await window.api.appts.list(ym);
  for(let d=1;d<=daysInMonth;d++){
    const cell = document.createElement('div');
    cell.className = 'cell';
    const span = document.createElement('div');
    span.className = 'date';
    span.textContent = d;
    cell.appendChild(span);

    const dateStr = `${ym}-${String(d).padStart(2,'0')}`;
    appts.filter(a=>a.date===dateStr).forEach(a=>{
      const apptDiv = document.createElement('div');
      const st = (a.status||'yellow').toLowerCase();
      apptDiv.className = `appt status-${st}`;
      const namePart = a.patient_name ? `${a.patient_name} • ` : '';
      const timePart = fmt12(a.time||'');
      const procPart = a.procedure || '';
      apptDiv.textContent = `${namePart}${timePart} — ${procPart}`;
      apptDiv.title = "Click to view details / set color / delete";
      apptDiv.onclick = ()=> openApptModal(a);
      cell.appendChild(apptDiv);
    });

    calGrid.appendChild(cell);
  }
}

/* ----- Drawer (Add Patient / Appointment) ----- */
async function openDrawer(type, patient=null){
  const d=$('#drawer'), c=$('#drawerContent');
  $('#drawerTitle').textContent= type==="patient"?(patient?"Edit Patient":"New Patient"):"New Appointment";
  c.innerHTML="";

  if(type==="patient"){
    // If patient is provided, we are editing (including Case No / Patient ID).
    if(patient){
      $('#drawer').dataset.editId = patient.id || "";
      $('#drawer').dataset.oldExternal = patient.external_id || patient['Case No.'] || "";
    } else {
      $('#drawer').dataset.editId = "";
      $('#drawer').dataset.oldExternal = "";
    }

    c.innerHTML=`
      <label>Case No</label><input id="pCaseNo" placeholder="Leave blank for auto (25YYYY)">
      <label>Name</label><input id="pName">
      <label>Age</label><input id="pAge">
      <label>Gender</label><input id="pGender">
      <label>Phone</label><input id="pPhone">
      <label>Address</label><input id="pAddress">`;

    // Prefill when editing
    if(patient){
      $('#pCaseNo').value = patient.external_id || patient['Case No.'] || "";
      $('#pName').value = patient.name || patient['Patient Name'] || "";
      $('#pAge').value = patient.age || "";
      $('#pGender').value = patient.gender || "";
      $('#pPhone').value = patient.phone || patient.Contact || "";
      $('#pAddress').value = patient.address || patient.Address || "";
    }
  
  } else {
    const patients = await window.api.patients.list("");
    const options = patients.map(p=>{
      const id = p.id || p.external_id || "";
      const nm = p.name || p['Patient Name'] || "";
      return `<option value="${id}" data-name="${nm}">${(p.external_id||p['Case No.']||'') } - ${nm}</option>`;
    }).join('');

    const today = new Date();
    const dfltDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const dfltTime = `${String(today.getHours()).padStart(2,'0')}:${String(today.getMinutes()).padStart(2,'0')}`;

    c.innerHTML = `
      <div class="pill" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <label><input type="radio" name="apptMode" id="modeExisting" checked> Select Existing Patient</label>
        <label><input type="radio" name="apptMode" id="modeNew"> Create New Patient</label>
      </div>

      <div id="existingBlock">
        <label>Patient (existing)</label>
        <input id="aPatientSearch" type="text" placeholder="Search patient by Case No, name, or phone" style="margin-bottom:8px;">
        <select id="aPatientSelect">${options}</select>
      </div>

      <div id="newBlock" class="hidden">
        <label>New Patient Name</label><input id="npName">
        <label>Phone</label><input id="npPhone">
        <label>Address</label><input id="npAddress">
      </div>

      <label>Doctor</label><input id="aDoctor">
      <label>Procedure</label><input id="aProcedure">
      <label>Date</label><input type="date" id="aDate" value="${dfltDate}">
      <label>Time</label>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <select id="aHour"></select>
        <select id="aMin"></select>
        <select id="aAmPm">
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    `;

    
    
    // 🔎 Appointment patient search (existing patients)
    const pSearch = document.getElementById('aPatientSearch');
    const pSelect = document.getElementById('aPatientSelect');
    if(pSearch && pSelect){
      const allPatients = patients.slice(); // local copy
      const renderOptions = (query="")=>{
        const q = String(query||"").toLowerCase().trim();
        const keep = pSelect.value;
        const filtered = !q ? allPatients : allPatients.filter(p=>{
          const name = String(p.name||p['Patient Name']||"").toLowerCase();
          const caseNo = String(p.external_id||p['Case No.']||"").toLowerCase();
          const phone = String(p.phone||p.Contact||"").toLowerCase();
          return name.includes(q) || caseNo.includes(q) || phone.includes(q);
        });
        pSelect.innerHTML = filtered.map(p=>{
          const id = p.id || p.external_id || "";
          const nm = p.name || p['Patient Name'] || "";
          return `<option value="${id}" data-name="${nm}">${(p.external_id||p['Case No.']||'') } - ${nm}</option>`;
        }).join('');
        // restore previous selection if still exists
        if(keep && Array.from(pSelect.options).some(o=>o.value===keep)) pSelect.value = keep;
      };
      pSearch.addEventListener('input', (e)=> renderOptions(e.target.value));
      // Initial render ensures DOM options are tied to filter logic
      renderOptions("");
    }

// Populate time selectors (12-hour + AM/PM)
    const hourSel = $('#aHour');
    const minSel = $('#aMin');
    const apSel = $('#aAmPm');

    if(hourSel && minSel && apSel){
      hourSel.innerHTML = Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
      const mins = ["00","05","10","15","20","25","30","35","40","45","50","55"];
      minSel.innerHTML = mins.map(m=>`<option value="${m}">${m}</option>`).join('');

      // Default from current time
      const now = new Date();
      let h = now.getHours();
      const m = String(now.getMinutes()).padStart(2,'0');
      const ap = h>=12 ? "PM" : "AM";
      h = ((h+11)%12)+1;

      hourSel.value = String(h);
      // snap minutes to nearest 5
      const mm = Math.round(parseInt(m,10)/5)*5;
      const mmStr = String((mm===60?55:mm)).padStart(2,'0');
      minSel.value = mins.includes(mmStr) ? mmStr : "00";
      apSel.value = ap;
    }
$('#modeExisting').onchange = ()=>{ $('#existingBlock').classList.remove('hidden'); $('#newBlock').classList.add('hidden'); };
    $('#modeNew').onchange = ()=>{ $('#existingBlock').classList.add('hidden'); $('#newBlock').classList.remove('hidden'); };
  }

  d.classList.remove('hidden');
  d.dataset.type = type;
}
function closeDrawer(){ $('#drawer').classList.add('hidden'); }

async function saveDrawer(){
  const type=$('#drawer').dataset.type;
  if(type==="patient"){
    const editId = $('#drawer').dataset.editId || "";
    const oldExternal = $('#drawer').dataset.oldExternal || "";
    const caseNoRaw = ($('#pCaseNo').value||"").trim();
    const p={
      id: editId || undefined,
      external_id: caseNoRaw || (editId ? oldExternal : undefined),
      name: $('#pName').value,
      age: $('#pAge').value,
      gender: $('#pGender').value,
      phone: $('#pPhone').value,
      address: $('#pAddress').value
    };
    if(!p.name) return;
    await window.api.patients.save(p);
    loadList();
  } else {
    const useExisting = $('#modeExisting')?.checked;
    let patient_id = "";
    let patient_name = "";

    if(useExisting){
      const sel = $('#aPatientSelect');
      if(!sel || !sel.value) return;
      patient_id = sel.value;
      patient_name = sel.options[sel.selectedIndex].dataset.name || "";
    } else {
      const pName = $('#npName').value.trim();
      if(!pName) return;
      const newP = await window.api.patients.save({
        name: pName,
        phone: $('#npPhone').value || "",
        address: $('#npAddress').value || ""
      });
      patient_id = newP.id || newP.external_id;
      patient_name = newP.name || "";
      loadList();
    }

        // Build HH:MM (24-hour) from selectors
    const h12 = parseInt(($('#aHour')?.value||""),10);
    const mStr = ($('#aMin')?.value||"00");
    const ap = ($('#aAmPm')?.value||"AM");
    if(!h12 || h12<1 || h12>12){ alert('Please select a valid hour'); return; }
    const min = parseInt(mStr,10);
    if(isNaN(min) || min<0 || min>59){ alert('Please select minutes'); return; }
    let h24 = h12 % 12;
    if(ap==="PM") h24 += 12;
    const timeHHMM = String(h24).padStart(2,'0') + ":" + String(min).padStart(2,'0');

    const a={
      doctor: $('#aDoctor').value || "",
      patient_id,
      patient_name,
      procedure: $('#aProcedure').value || "",
      date: $('#aDate').value,
      time: timeHHMM,
      status: 'yellow' // default: Scheduled
    };
    if(!a.date || !a.time) return;
    await window.api.appts.add(a);
    drawCalendar();
  }
  closeDrawer();
}

/* ----- DOM Ready ----- */
window.addEventListener('DOMContentLoaded', ()=>{
  loadList(); drawCalendar();

  // Month nav
  $('#prevMonth').onclick=()=>{currentMonth.setMonth(currentMonth.getMonth()-1);drawCalendar();};
  $('#nextMonth').onclick=()=>{currentMonth.setMonth(currentMonth.getMonth()+1);drawCalendar();};

  // Views
  $('#backHome').onclick=()=>show('#homeView');

  // Drawer buttons
  $('#newPatient').onclick=()=>openDrawer("patient");
  $('#addAppt').onclick=()=>openDrawer("appt");
  $('#drawerClose').onclick=closeDrawer;
  $('#drawerSave').onclick=saveDrawer;

  // 🗑️ Danger: delete all patients from Sheets
  $('#deleteAllPatients').onclick=async()=>{
    if(confirm("Delete ALL patients from Google Sheets? This cannot be undone.")){
      await window.api.patients.deleteAll();
      loadList();
    }
  };

  // ✏️ Edit current patient (including Case No)
  const editBtn = document.getElementById('editPatient');
  if(editBtn){
    editBtn.onclick = async ()=>{
      if(!currentPatient) return;
      // Ensure we have the latest copy
      const p = await window.api.patients.get(currentPatient.id||currentPatient.external_id) || currentPatient;
      openDrawer("patient", p);
    };
  }

  // ❌ Delete current patient
  $('#deletePatient').onclick=async()=>{
    if(currentPatient && confirm(`Delete ${currentPatient.name||currentPatient['Patient Name']} from local system?`)){
      await window.api.patients.delete(currentPatient.id||currentPatient.external_id);
      show('#homeView');
      loadList();
    }
  };

  // 🔎 Live search
  const searchInput = document.getElementById('search');
  if(searchInput){
    searchInput.addEventListener('input', (e)=> loadList(e.target.value));
  }

  // 📊 MONTHLY REPORT -> publish/overwrite to Google Sheets and open it
  const repBtn = document.getElementById('downloadReport');
  if(repBtn){
    repBtn.textContent = 'Open Monthly Report';
    repBtn.onclick = async ()=>{
      const defYM = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth()+1).padStart(2,'0')}`;
      const ym = await askMonth(defYM);
      if(!ym) return;
      const res = await window.api.report.syncMonthly(ym);
      if(!res.ok){ alert('Report failed: '+res.error); return; }
      await window.api.ui.openExternal(res.url);
    };
  }
});

