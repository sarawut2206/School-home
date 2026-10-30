/* หน้าครู: เปิดคาบ/QR หมุนรหัส, มอบหมายงาน, ตรวจงานจากรูป, รายงานคะแนน, จัดการนักเรียน */
(function () {
  let tt = store.get('tt', 'session');
  let rooms = [];
  const state = { room: store.get('room') || '', tab: 'checkin' };
  const live = { sid: null, timers: [], nextAt: 0, token: '', fetching: false, lastKey: '' };
  const imgCache = new Map();

  const T = async (action, body) => {
    try { return await api(action, { tt, ...body }); }
    catch (e) { if (e.code === 'AUTH') { logout(); } throw e; }
  };
  const fail = (e) => { if (e && e.code !== 'AUTH') toast(e.message || 'เกิดข้อผิดพลาด', true); };
  const roomLabel = (r) => (rooms.find((x) => x.room === r) || {}).label || 'ห้อง ' + r;
  const roomOptions = (sel) => rooms.map((r) => `<option value="${esc(r.room)}" ${r.room === sel ? 'selected' : ''}>${esc(r.label)} (${r.count} คน)</option>`).join('');
  function ensureRoom() { if (!rooms.some((r) => r.room === state.room)) state.room = rooms[0] ? rooms[0].room : ''; return state.room; }
  const setRoom = (r) => { state.room = r; store.set('room', r); };

  // ───── เข้าสู่ระบบ ─────
  const show = (v) => { $('#view-login').classList.toggle('hidden', v !== 'login'); $('#view-app').classList.toggle('hidden', v !== 'app'); $('#logout').classList.toggle('hidden', v !== 'app'); };
  function logout() { stopLive(); tt = null; store.del('tt', 'session'); show('login'); }
  $('#logout').addEventListener('click', logout);
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await busy(ev.submitter, async () => {
      try {
        const r = await api('t_login', { pass: $('#pass').value });
        tt = r.tt; rooms = r.rooms; store.set('tt', tt, 'session'); $('#pass').value = '';
        ensureRoom(); show('app'); openTab('checkin');
      } catch (e) { fail(e); }
    });
  });

  // ───── แท็บ ─────
  const PANELS = ['checkin', 'assign', 'review', 'report', 'settings'];
  function openTab(name) {
    if (name !== 'checkin') stopLive();
    state.tab = name;
    $$('#tabs .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    PANELS.forEach((p) => $('#p-' + p).classList.toggle('hidden', p !== name));
    ({ checkin: renderCheckin, assign: renderAssign, review: renderReview, report: renderReport, settings: renderSettings })[name]();
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) openTab(b.dataset.tab); });

  // ═════════════ เช็กชื่อ ═════════════
  function stopLive() { live.timers.forEach(clearInterval); live.timers = []; live.sid = null; live.lastKey = ''; }

  async function renderCheckin() {
    stopLive();
    const el = $('#p-checkin'), room = ensureRoom();
    el.innerHTML = `
      <div class="card">
        <h2>เปิดคาบเช็กชื่อ</h2>
        <div class="row">
          <label class="field grow" style="margin:0">ห้อง<select id="ck-room">${roomOptions(room)}</select></label>
          <label class="field grow" style="margin:0">วิชา/คาบ (ไม่บังคับ)<input id="ck-subject" type="text" maxlength="60" value="${esc(store.get('subject') || '')}" placeholder="เช่น คณิตศาสตร์ คาบ 3"></label>
          <button class="btn primary" id="ck-open" type="button" style="align-self:end">เปิดคาบ / แสดง QR</button>
        </div>
      </div>
      <div id="ck-live"></div>
      <div class="card"><h3>คาบที่ผ่านมา</h3><div id="ck-past" class="muted">กำลังโหลด…</div></div>`;
    $('#ck-room').addEventListener('change', (e) => { setRoom(e.target.value); renderCheckin(); });
    $('#ck-open').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      store.set('subject', $('#ck-subject').value);
      try {
        const r = await T('t_openSession', { room: state.room, subject: $('#ck-subject').value });
        await loadPast();
        showSession(r.session.sessionId);
      } catch (err) { fail(err); }
    }));
    await loadPast(true);
  }

  async function loadPast(autoOpen) {
    try {
      const r = await T('t_sessions', { room: state.room });
      const box = $('#ck-past'); if (!box) return;
      box.innerHTML = r.sessions.length ? `<div class="scroll"><table><thead><tr><th>วันที่</th><th>วิชา</th><th class="num">มาเรียน</th><th>สถานะ</th><th></th></tr></thead><tbody>${r.sessions.map((s) =>
        `<tr><td>${esc(thDate(s.date))} ${esc(thTime(s.openedAt))}</td><td>${esc(s.subject)}</td><td class="num">${s.present}</td><td>${s.status === 'open' ? badge('pending', 'เปิดอยู่') : badge('done', 'ปิดแล้ว')}</td><td><button class="btn sm" data-s="${esc(s.sessionId)}" type="button">${s.status === 'open' ? 'แสดง QR' : 'ดู/แก้ไข'}</button></td></tr>`).join('')}</tbody></table></div>` : 'ยังไม่เคยเปิดคาบ';
      $$('[data-s]', box).forEach((b) => b.addEventListener('click', () => { showSession(b.dataset.s); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
      const open = r.sessions.find((s) => s.status === 'open');
      if (autoOpen && open) showSession(open.sessionId);
    } catch (e) { fail(e); }
  }

  async function showSession(sid) {
    stopLive();
    live.sid = sid;
    const box = $('#ck-live');
    box.innerHTML = '<div class="card muted">กำลังโหลด…</div>';
    let st;
    try { st = await T('t_sessionStatus', { sessionId: sid }); } catch (e) { fail(e); return; }
    const open = st.session.status === 'open';
    box.innerHTML = `<div class="grid ${open ? 'cols-2' : ''}">
      ${open ? `<div class="card">
        <div class="qrbox" id="qrbox"><div id="qr" role="img" aria-label="QR Code เช็กชื่อ"></div>
          <div class="count" id="qrcount"></div><div class="countdown" id="cd"></div></div>
        <div class="row" style="margin-top:12px"><button class="btn grow" id="fs" type="button">แสดงเต็มจอ</button><button class="btn danger grow" id="close" type="button">ปิดคาบ (บันทึกขาด)</button></div>
        <p class="small muted" style="margin-top:8px">QR เปลี่ยนรหัสอัตโนมัติ นักเรียนที่เหลือเวลาเช็กชื่อ ${esc(thTime(st.session.closeAt))} น. · ตรงเวลาถึง ${esc(thTime(st.session.onTimeUntil))} น.</p></div>` : ''}
      <div class="card" id="roster"></div></div>`;
    drawRoster(st);
    if (open) {
      $('#fs').addEventListener('click', () => { const q = $('#qrbox'); if (document.fullscreenElement) document.exitFullscreen(); else if (q.requestFullscreen) q.requestFullscreen(); else toast('เบราว์เซอร์นี้ไม่รองรับเต็มจอ', true); });
      $('#close').addEventListener('click', async (e) => {
        if (!confirm('ปิดคาบนี้? คนที่ยังไม่เช็กชื่อจะถูกบันทึกเป็น "ขาด" (แก้ไขภายหลังได้)')) return;
        await busy(e.currentTarget, async () => {
          try { const r = await T('t_closeSession', { sessionId: sid }); toast(`ปิดคาบแล้ว บันทึกขาด ${r.absent} คน`); await loadPast(); showSession(sid); } catch (err) { fail(err); }
        });
      });
      await refreshToken();
      live.timers.push(setInterval(tick, 500));
      live.timers.push(setInterval(pollStatus, 5000));
    }
  }

  function drawRoster(st) {
    const key = JSON.stringify(st.students.map((s) => [s.status, s.flag]));
    const c = st.counts, got = c.present + c.late;
    const qc = $('#qrcount'); if (qc) qc.textContent = `เช็กชื่อแล้ว ${got} / ${st.students.length}`;
    if (key === live.lastKey) return;
    live.lastKey = key;
    const r = $('#roster'); if (!r) return;
    const sid = st.session.sessionId;
    r.innerHTML = `<h3>${esc(roomLabel(st.session.room))} · ${esc(thDate(st.session.date))}${st.session.subject ? ' · ' + esc(st.session.subject) : ''}</h3>
      <p class="row">${badge('present', 'มา ' + c.present)}${badge('late', 'สาย ' + c.late)}${badge('leave', 'ลา ' + c.leave)}${badge('absent', 'ขาด ' + c.absent)}${c.none ? badge('none', 'ยังไม่เช็ก ' + c.none) : ''}</p>
      <div class="scroll"><table><thead><tr><th>ชื่อ</th><th>เวลา</th><th>สถานะ</th></tr></thead><tbody>${st.students.map((s) => `<tr>
        <td>${esc(s.name)}<div class="small muted">${esc(s.id)}${s.flag ? ' · <span style="color:var(--bad)">⚠ ' + esc(s.flag) + '</span>' : ''}</div></td>
        <td>${esc(thTime(s.time))}</td>
        <td><div class="seg" role="group" aria-label="สถานะของ ${esc(s.name)}">${['present', 'late', 'leave', 'absent'].map((k) => `<button type="button" data-id="${esc(s.id)}" data-st="${k}" aria-pressed="${s.status === k}">${STATUS[k]}</button>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-st]', r).forEach((b) => b.addEventListener('click', async () => {
      try { await T('t_setAttendance', { sessionId: sid, studentId: b.dataset.id, status: b.dataset.st }); live.lastKey = ''; await pollStatus(true); } catch (e) { fail(e); }
    }));
  }

  async function pollStatus(force) {
    if (!live.sid || (document.hidden && !force)) return;
    try { const st = await T('t_sessionStatus', { sessionId: live.sid }); if (live.sid) drawRoster(st); } catch (e) { /* รอบหน้าลองใหม่ */ }
  }

  async function refreshToken() {
    if (live.fetching || !live.sid) return;
    live.fetching = true;
    try {
      const r = await T('t_token', { sessionId: live.sid });
      live.token = r.token; live.nextAt = Date.now() + r.nextInSec * 1000 + 300;
      drawQR();
    } catch (e) {
      if (e.code === 'SESSION_CLOSED') { toast('คาบนี้ถูกปิดแล้ว'); showSession(live.sid); } else live.nextAt = Date.now() + 3000;
    } finally { live.fetching = false; }
  }
  function tick() {
    const left = Math.ceil((live.nextAt - Date.now()) / 1000);
    const cd = $('#cd'); if (cd) cd.textContent = left > 0 ? `QR เปลี่ยนรหัสใน ${left} วินาที` : 'กำลังเปลี่ยนรหัส…';
    if (left <= 0) refreshToken();
  }
  function drawQR() {
    const box = $('#qr'); if (!box) return;
    const url = `${siteBase()}student.html?s=${encodeURIComponent(live.sid)}&t=${encodeURIComponent(live.token)}`;
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollStatus(true); if (live.sid) tick(); } });

  // ═════════════ มอบหมายงาน ═════════════
  async function renderAssign() {
    const el = $('#p-assign'), room = ensureRoom();
    el.innerHTML = `
      <div class="card"><h2>มอบหมายงานใหม่</h2>
        <form id="as-form"><div class="grid cols-2">
          <label class="field">ห้อง<select id="as-room">${roomOptions(room)}</select></label>
          <label class="field">ชื่องาน<input id="as-title" type="text" maxlength="80" required placeholder="เช่น ใบงานที่ 1 สมการ"></label>
          <label class="field">คะแนนเต็ม<input id="as-max" type="number" min="1" step="0.5" value="10" required></label>
          <label class="field">กำหนดส่ง (ไม่บังคับ)<input id="as-due" type="datetime-local"><span class="hint">ส่งหลังเวลานี้ระบบจะติดป้าย "ส่งช้า"</span></label>
        </div><button class="btn primary" type="submit">สร้างงาน</button></form></div>
      <div class="card"><h2>งานทั้งหมด</h2><div id="as-list" class="muted">กำลังโหลด…</div></div>`;
    $('#as-room').addEventListener('change', (e) => setRoom(e.target.value));
    $('#as-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const due = $('#as-due').value;
      await busy(ev.submitter, async () => {
        try {
          await T('t_createAssignment', { room: $('#as-room').value, title: $('#as-title').value, maxScore: $('#as-max').value, due: due ? due.replace('T', ' ') + ':00' : '' });
          toast('สร้างงานแล้ว'); $('#as-title').value = ''; loadAssignments();
        } catch (e) { fail(e); }
      });
    });
    loadAssignments();
  }
  async function loadAssignments() {
    try {
      const r = await T('t_assignments', {});
      const box = $('#as-list'); if (!box) return;
      box.innerHTML = r.assignments.length ? r.assignments.map((a) => `<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div class="grow"><b>${esc(a.title)}</b> <span class="muted small">· ${esc(roomLabel(a.room))} · เต็ม ${fmtNum(a.maxScore)}${a.due ? ' · ส่งภายใน ' + esc(thDateTime(a.due)) : ''}</span>
          <div class="small">ส่งแล้ว ${a.submitted}/${a.total} · รอตรวจ ${a.pending} ${a.status === 'closed' ? badge('none', 'ปิดรับแล้ว') : ''}</div></div>
        <button class="btn sm primary" data-review="${esc(a.assignmentId)}" data-room="${esc(a.room)}" type="button">ตรวจงาน</button>
        <button class="btn sm" data-toggle="${esc(a.assignmentId)}" data-to="${a.status === 'open' ? 'closed' : 'open'}" type="button">${a.status === 'open' ? 'ปิดรับ' : 'เปิดรับอีกครั้ง'}</button></div>`).join('') : 'ยังไม่มีงาน';
      $$('[data-review]', box).forEach((b) => b.addEventListener('click', () => { setRoom(b.dataset.room); reviewSel = b.dataset.review; openTab('review'); }));
      $$('[data-toggle]', box).forEach((b) => b.addEventListener('click', async () => { try { await T('t_setAssignmentStatus', { assignmentId: b.dataset.toggle, status: b.dataset.to }); loadAssignments(); } catch (e) { fail(e); } }));
    } catch (e) { fail(e); }
  }

  // ═════════════ ตรวจงาน ═════════════
  let reviewSel = '';
  let rv = { data: null, onlyPending: false, queue: [], i: 0 };

  async function renderReview() {
    const el = $('#p-review'), room = ensureRoom();
    el.innerHTML = `<div class="card"><h2>ตรวจงาน</h2><div class="row">
      <label class="field grow" style="margin:0">ห้อง<select id="rv-room">${roomOptions(room)}</select></label>
      <label class="field grow" style="margin:0">งาน<select id="rv-asg"><option>กำลังโหลด…</option></select></label></div></div>
      <div id="rv-body"></div>`;
    $('#rv-room').addEventListener('change', (e) => { setRoom(e.target.value); reviewSel = ''; renderReview(); });
    try {
      const r = await T('t_assignments', { room: state.room });
      const sel = $('#rv-asg');
      if (!r.assignments.length) { sel.innerHTML = '<option value="">ยังไม่มีงานในห้องนี้</option>'; return; }
      if (!r.assignments.some((a) => a.assignmentId === reviewSel)) reviewSel = r.assignments[0].assignmentId;
      sel.innerHTML = r.assignments.map((a) => `<option value="${esc(a.assignmentId)}" ${a.assignmentId === reviewSel ? 'selected' : ''}>${esc(a.title)} (รอตรวจ ${a.pending})</option>`).join('');
      sel.addEventListener('change', () => { reviewSel = sel.value; loadReview(); });
      loadReview();
    } catch (e) { fail(e); }
  }

  async function loadReview() {
    const body = $('#rv-body'); if (!body) return;
    body.innerHTML = '<div class="card muted">กำลังโหลด…</div>';
    try { rv.data = await T('t_submissions', { assignmentId: reviewSel }); } catch (e) { fail(e); return; }
    drawReview();
  }
  function drawReview() {
    const body = $('#rv-body'); if (!body || !rv.data) return;
    const list = rv.data.students, a = rv.data.assignment;
    const cnt = (s) => list.filter((x) => x.status === s).length;
    const shown = rv.onlyPending ? list.filter((x) => x.status === 'pending') : list;
    body.innerHTML = `<div class="card">
      <div class="row"><div class="grow"><b>${esc(a.title)}</b> <span class="muted small">คะแนนเต็ม ${fmtNum(a.maxScore)}</span></div>
        <label class="row small" style="gap:6px"><input type="checkbox" id="rv-only" ${rv.onlyPending ? 'checked' : ''}> แสดงเฉพาะรอตรวจ</label>
        <button class="btn primary sm" id="rv-start" type="button" ${cnt('pending') ? '' : 'disabled'}>เริ่มตรวจ (${cnt('pending')})</button></div>
      <p class="row">${badge('pending', 'รอตรวจ ' + cnt('pending'))}${badge('done', 'ครบถ้วน ' + cnt('done'))}${badge('revise', 'ต้องแก้ไข ' + cnt('revise'))}${badge('none', 'ไม่ผ่าน ' + cnt('none'))}${badge('missing', 'ยังไม่ส่ง ' + cnt('missing'))}</p>
      <div class="scroll"><table><thead><tr><th>ชื่อ</th><th>สถานะ</th><th class="num">รูป</th><th class="num">คะแนน</th><th></th></tr></thead><tbody>${shown.map((s) => `<tr>
        <td>${esc(s.name)}<div class="small muted">${esc(s.studentId)}${s.submittedAt ? ' · ส่ง ' + esc(thDateTime(s.submittedAt)) : ''}${s.late ? ' · <b style="color:var(--bad)">ส่งช้า</b>' : ''}${s.round > 1 ? ' · รอบ ' + s.round : ''}</div></td>
        <td>${badge(s.status)}</td><td class="num">${s.count || ''}</td><td class="num">${s.score === null || s.status === 'missing' ? '' : fmtNum(s.score)}</td>
        <td>${s.count ? `<button class="btn sm" data-open="${esc(s.studentId)}" type="button">ดูรูป</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#rv-only').addEventListener('change', (e) => { rv.onlyPending = e.target.checked; drawReview(); });
    $('#rv-start').addEventListener('click', () => openViewer(list.find((x) => x.status === 'pending').studentId, true));
    $$('[data-open]', body).forEach((b) => b.addEventListener('click', () => openViewer(b.dataset.open, false)));
  }

  function openViewer(studentId, pendingOnly) {
    const list = rv.data.students.filter((x) => x.count);
    rv.queue = pendingOnly ? list.filter((x) => x.status === 'pending' || x.studentId === studentId) : list;
    rv.i = Math.max(0, rv.queue.findIndex((x) => x.studentId === studentId));
    rv.pendingOnly = pendingOnly;
    drawViewer();
  }
  function closeViewer() { $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', onKey); drawReview(); }
  function onKey(e) {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === '1') grade('done'); else if (e.key === '2') grade('revise'); else if (e.key === '3') grade('none');
  }
  function go(d) { const n = rv.i + d; if (n >= 0 && n < rv.queue.length) { rv.i = n; drawViewer(); } }

  async function loadImg(img, fileId) {
    try {
      let src = imgCache.get(fileId);
      if (!src) { const r = await T('t_image', { fileId }); src = `data:${r.mime};base64,${r.data}`; imgCache.set(fileId, src); }
      img.src = src; img.classList.remove('muted');
    } catch (e) { img.replaceWith(Object.assign(document.createElement('p'), { textContent: 'โหลดรูปไม่สำเร็จ', className: 'muted' })); }
  }

  function drawViewer() {
    const s = rv.queue[rv.i], a = rv.data.assignment;
    $('#modal-root').innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="ตรวจงาน ${esc(s.name)}"><div class="panel viewer">
      <div class="row"><div class="grow"><b>${esc(s.name)}</b> <span class="muted small">${esc(s.studentId)} · ${rv.i + 1}/${rv.queue.length}</span>
        <div class="small muted">ส่ง ${esc(thDateTime(s.submittedAt))}${s.late ? ' · ส่งช้า' : ''} · รอบ ${s.round} · ${s.count} รูป</div></div>
        ${badge(s.status)}<button class="btn sm" id="vw-close" type="button">ปิด (Esc)</button></div>
      <div id="vw-imgs" class="grid">${s.files.map((f, i) => `<div><div class="small muted">รูปที่ ${i + 1}${f.round > 1 ? ' (รอบ ' + f.round + ')' : ''}</div><img class="muted" alt="งานของ ${esc(s.name)} รูปที่ ${i + 1}" data-f="${esc(f.id)}" style="min-height:80px"></div>`).join('')}</div>
      <div class="gradebar"><label class="field" style="margin:0">ข้อความถึงนักเรียน (ไม่บังคับ)<input id="vw-comment" type="text" maxlength="300" value="${esc(s.comment)}" placeholder="เช่น ข้อ 3 ลืมใส่หน่วย"></label>
      <div class="row">
        <button class="btn ok grow" data-g="done" type="button">✔ ครบถ้วน (${fmtNum(a.maxScore)}) [1]</button>
        <button class="btn grow" data-g="revise" type="button">✎ ต้องแก้ไข [2]</button>
        <button class="btn danger grow" data-g="none" type="button">✖ ไม่ผ่าน (0) [3]</button></div>
      <div class="row end"><button class="btn sm" id="vw-prev" type="button" ${rv.i === 0 ? 'disabled' : ''}>← ก่อนหน้า</button><button class="btn sm" id="vw-next" type="button" ${rv.i === rv.queue.length - 1 ? 'disabled' : ''}>ถัดไป →</button></div></div>
    </div></div>`;
    $$('#vw-imgs img').forEach((img) => { loadImg(img, img.dataset.f); img.addEventListener('click', () => img.style.maxHeight = img.style.maxHeight === 'none' ? '' : 'none'); });
    $('#vw-close').addEventListener('click', closeViewer);
    $('#vw-prev').addEventListener('click', () => go(-1)); $('#vw-next').addEventListener('click', () => go(1));
    $$('[data-g]').forEach((b) => b.addEventListener('click', () => grade(b.dataset.g)));
    document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
  }

  async function grade(status) {
    const s = rv.queue[rv.i]; if (!s || grade.busy) return;
    grade.busy = true;
    try {
      const r = await T('t_grade', { submissionId: s.submissionId, status, comment: ($('#vw-comment') || {}).value || '' });
      s.status = status; s.score = r.score; s.comment = ($('#vw-comment') || {}).value || '';
      toast(`บันทึกแล้ว: ${STATUS[status]} ${fmtNum(r.score)} คะแนน`);
      const next = rv.queue.findIndex((x, i) => i > rv.i && x.status === 'pending');
      if (next >= 0) { rv.i = next; drawViewer(); } else if (rv.i < rv.queue.length - 1 && !rv.pendingOnly) { rv.i++; drawViewer(); } else { closeViewer(); toast('ตรวจครบทุกคนที่รอตรวจแล้ว'); }
    } catch (e) { fail(e); } finally { grade.busy = false; }
  }

  // ═════════════ คะแนนและรายงาน ═════════════
  async function renderReport() {
    const el = $('#p-report'), room = ensureRoom();
    el.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">คะแนนและรายงาน</h2>
      <select id="rp-room" style="width:auto">${roomOptions(room)}</select>
      <button class="btn sm" id="rp-csv" type="button">ดาวน์โหลด CSV (Excel)</button><button class="btn sm" id="rp-print" type="button">พิมพ์</button></div></div><div id="rp-body"><div class="card muted">กำลังโหลด…</div></div>`;
    $('#rp-room').addEventListener('change', (e) => { setRoom(e.target.value); renderReport(); });
    $('#rp-print').addEventListener('click', () => window.print());
    let r;
    try { r = await T('t_report', { room: state.room }); } catch (e) { fail(e); return; }
    const s = r.summary, ls = s.latestSession, la = s.latestAssignment;
    $('#rp-body').innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><b>${s.total}</b><span>นักเรียนทั้งหมด</span></div>
        <div class="stat"><b>${ls ? ls.present : '–'}</b><span>เข้าเรียนคาบล่าสุด${ls ? ' (' + esc(thDate(ls.date)) + ')' : ''}</span></div>
        <div class="stat"><b>${la ? la.submitted : '–'}</b><span>ส่งงานล่าสุดแล้ว${la ? ' (' + esc(la.title) + ')' : ''}</span></div>
        <div class="stat"><b>${la ? la.missing : '–'}</b><span>ยังไม่ส่งงานล่าสุด</span></div></div>
      <div class="card"><p class="small muted">นับเฉพาะคาบที่ปิดแล้ว (${s.sessions} คาบ) และงานทั้งหมดที่มอบหมาย (${s.assignments} งาน) · งานที่ยังรอตรวจยังไม่นับคะแนน</p>
        <div class="scroll"><table><thead><tr><th>#</th><th>เลขประจำตัว</th><th>ชื่อ-สกุล</th><th class="num">มา</th><th class="num">สาย</th><th class="num">ลา</th><th class="num">ขาด</th><th class="num">เข้าเรียน</th><th class="num">ส่งงาน</th><th class="num">รวม</th><th class="num">%</th></tr></thead><tbody>
        ${r.students.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.id)}</td><td>${esc(x.name)}</td><td class="num">${x.present}</td><td class="num">${x.late}</td><td class="num">${x.leave}</td><td class="num">${x.absent}</td>
          <td class="num">${fmtNum(x.attScore)}/${fmtNum(x.attMax)}</td><td class="num">${fmtNum(x.subScore)}/${fmtNum(x.subMax)}</td><td class="num"><b>${fmtNum(x.total)}</b></td><td class="num">${x.pct}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#rp-csv').onclick = () => {
      const head = ['เลขประจำตัว', 'ชื่อ-สกุล', 'มา', 'สาย', 'ลา', 'ขาด', 'คะแนนเข้าเรียน', 'เต็มเข้าเรียน', 'คะแนนส่งงาน', 'เต็มส่งงาน', 'รวม', 'เปอร์เซ็นต์'];
      const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
      const rows = r.students.map((x) => [x.id, x.name, x.present, x.late, x.leave, x.absent, x.attScore, x.attMax, x.subScore, x.subMax, x.total, x.pct].map(q).join(','));
      const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `คะแนน_${roomLabel(state.room)}_${todayStr()}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
    };
  }

  // ═════════════ นักเรียนและตั้งค่า ═════════════
  async function renderSettings() {
    const el = $('#p-settings');
    el.innerHTML = `
      <div class="card"><h2>นำเข้ารายชื่อนักเรียน</h2>
        <p class="small muted">คัดลอกจาก Excel (3 คอลัมน์: เลขประจำตัว, ชื่อ-นามสกุล, ห้อง) แล้ววางได้เลย นำเข้าซ้ำได้ ระบบไม่ลบ PIN เดิม</p>
        <textarea id="im-text" placeholder="12345&#9;นายตัวอย่าง ทดสอบ&#9;1"></textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="im-go" type="button">นำเข้า</button></div></div>
      <div class="card"><div class="row"><h2 class="grow" style="margin:0">รายชื่อและ PIN</h2><select id="st-room" style="width:auto">${roomOptions(ensureRoom())}</select></div><div id="st-list" class="muted" style="margin-top:10px">กำลังโหลด…</div></div>
      <div class="card"><h2>เกณฑ์คะแนนและตั้งค่า</h2><div id="cf-form" class="muted">กำลังโหลด…</div></div>
      <div class="card"><h2>เปลี่ยนรหัสผ่านครู</h2><form id="pw-form" class="row"><input id="pw-new" type="password" minlength="6" placeholder="รหัสใหม่ อย่างน้อย 6 ตัว" class="grow" autocomplete="new-password" required><button class="btn primary" type="submit">เปลี่ยนรหัส</button></form></div>`;
    $('#im-go').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try {
        const r = await T('t_importStudents', { text: $('#im-text').value });
        rooms = r.rooms; toast(`นำเข้าแล้ว: เพิ่ม ${r.added} · แก้ไข ${r.updated} · ข้าม ${r.skipped}`); $('#im-text').value = ''; renderSettings();
      } catch (err) { fail(err); }
    }));
    $('#st-room').addEventListener('change', (e) => { setRoom(e.target.value); loadStudents(); });
    $('#pw-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy(ev.submitter, async () => { try { const r = await T('t_setPass', { newPass: $('#pw-new').value }); tt = r.tt; store.set('tt', tt, 'session'); $('#pw-new').value = ''; toast('เปลี่ยนรหัสผ่านแล้ว'); } catch (e) { fail(e); } });
    });
    loadStudents(); loadConfig();
  }
  async function loadStudents() {
    try {
      const r = await T('t_students', { room: state.room });
      const box = $('#st-list'); if (!box) return;
      box.innerHTML = r.students.length ? `<div class="scroll"><table><thead><tr><th>เลขประจำตัว</th><th>ชื่อ-สกุล</th><th>PIN</th><th></th></tr></thead><tbody>${r.students.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td><td>${s.hasPin ? badge('done', 'ตั้งแล้ว') : badge('none', 'ยังไม่ตั้ง')}</td><td>${s.hasPin ? `<button class="btn sm" data-rs="${esc(s.id)}" type="button">รีเซ็ต PIN</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : 'ยังไม่มีรายชื่อ';
      $$('[data-rs]', box).forEach((b) => b.addEventListener('click', async () => { if (!confirm('รีเซ็ต PIN ของ ' + b.dataset.rs + '? นักเรียนต้องตั้ง PIN ใหม่')) return; try { await T('t_resetPin', { id: b.dataset.rs }); toast('รีเซ็ตแล้ว'); loadStudents(); } catch (e) { fail(e); } }));
    } catch (e) { fail(e); }
  }
  async function loadConfig() {
    try {
      const r = await T('t_config', {});
      const box = $('#cf-form'); if (!box) return;
      box.innerHTML = `<form id="cf"><div class="grid cols-2">${r.config.map((c) => `<label class="field">${esc(c.note || c.key)}<input data-k="${esc(c.key)}" type="${typeof c.value === 'number' ? 'number' : 'text'}" step="any" value="${esc(c.value)}"><span class="hint">${esc(c.key)}</span></label>`).join('')}</div><button class="btn primary" type="submit">บันทึกการตั้งค่า</button></form>`;
      $('#cf').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const values = {};
        $$('#cf [data-k]').forEach((i) => { values[i.dataset.k] = i.type === 'number' ? Number(i.value) : i.value; });
        await busy(ev.submitter, async () => { try { await T('t_saveConfig', { values }); toast('บันทึกแล้ว (มีผลกับการเช็กชื่อ/ตรวจงานครั้งต่อไป)'); } catch (e) { fail(e); } });
      });
    } catch (e) { fail(e); }
  }

  // ───── เริ่มต้น ─────
  (async function init() {
    if (!tt) return show('login');
    try { const r = await T('t_students', {}); rooms = r.rooms; ensureRoom(); show('app'); openTab('checkin'); }
    catch (e) { show('login'); }
  })();
})();
