/* หน้านักเรียน: เข้าสู่ระบบ → เช็กชื่อ (สแกน QR หรือกดปุ่มในแอป) → ส่งงานด้วยรูปถ่าย → ดูผลของตัวเอง */
(function () {
  const params = new URLSearchParams(location.search);
  let pending = params.get('s') && params.get('t') ? { s: params.get('s'), t: params.get('t') } : null;
  let pendingAsg = params.get('a') || null;   // ลิงก์ส่งงานที่ครูส่งให้ (?a=รหัสงาน)
  if (pending || pendingAsg) history.replaceState(null, '', location.pathname); // กัน QR/ลิงก์ค้างอยู่ใน URL/ประวัติเบราว์เซอร์

  let session = null;          // { token, student, exp }
  let me = null;               // ข้อมูลจาก action "me"
  let checkinResult = null;    // ผลเช็กชื่อล่าสุด
  let confirmLink = null;      // เปิดจากลิงก์/QR แล้วล็อกอินแล้ว: รอให้นักเรียนตรวจชื่อและกดยืนยัน { s, t, info }
  let linkInfo = null;         // ข้อมูลคาบจากลิงก์ (ได้ก่อนล็อกอิน)
  let activeAsg = null;        // งานที่กำลังส่ง
  let photos = [];             // รูปที่เลือกไว้ (ย่อแล้ว)
  let setupId = '';
  let loginMode = 'id';        // id = เลขประจำตัวอย่างเดียว · pin = เลขประจำตัว + PIN (ตามที่ครูตั้งในระบบ)
  let batchId = null;          // รหัสรอบการส่ง คงเดิมเมื่อกดส่งซ้ำหลังเน็ตหลุด เพื่อไม่ให้รูปซ้ำ

  // เวลาที่ใช้ตัดสินเช็กชื่อคือเวลาประเทศไทยของเซิร์ฟเวอร์ ไม่ใช่นาฬิกาเครื่องนักเรียน
  // จึงเก็บส่วนต่างระหว่างเวลาเซิร์ฟเวอร์กับนาฬิกาเครื่องไว้ เพื่อโชว์เวลาไทยที่ถูกต้องและเตือนเมื่อเครื่องตั้งเวลาเพี้ยน
  let clockSkew = 0;           // ms: เวลาเซิร์ฟเวอร์ − นาฬิกาเครื่อง
  const thMs = (s) => { const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):?(\d\d)?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +(m[6] || 0)) : NaN; };
  const gotMe = (m) => { const t = m && thMs(m.serverTime); if (Number.isFinite(t)) clockSkew = t - Date.now(); return m; };
  function clockNote() {
    const now = new Date(Date.now() + clockSkew).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
    const tz = -new Date().getTimezoneOffset(), off = Math.abs(clockSkew) > 120000;
    const warn = [];
    if (tz !== 420) warn.push(`เครื่องของคุณตั้งเขตเวลาเป็น UTC${tz >= 0 ? '+' : '−'}${Math.abs(tz) / 60} ไม่ใช่เวลาประเทศไทย (UTC+7)`);
    if (off) warn.push(`นาฬิกาเครื่องคลาดเคลื่อนจากเวลาจริงประมาณ ${Math.round(Math.abs(clockSkew) / 60000)} นาที`);
    return `<div class="card" style="padding:.7rem 1rem"><div class="row"><span class="grow small">${icon('clock')} เวลาประเทศไทยตอนนี้ <b>${now} น.</b> <span class="muted">(ระบบนับเวลาไทยเสมอ)</span></span></div>${warn.length ? `<p class="small" style="margin:.4rem 0 0;color:var(--warn,#b45309)">${icon('alert')} ${warn.join(' · ')}<br><span class="muted">ไม่ทำให้เช็กชื่อผิด แต่ควรตั้งวันที่/เวลาของเครื่องเป็น "อัตโนมัติ" และเขตเวลา "กรุงเทพ"</span></p>` : ''}</div>`;
  }

  function setMode(m) {
    loginMode = m === 'pin' ? 'pin' : 'id';
    $('#pin-wrap').classList.toggle('hidden', loginMode !== 'pin');
    $('#login-note').textContent = pending ? 'ใส่เลขประจำตัว ระบบจะแสดงชื่อให้ตรวจก่อน แล้วกดยืนยันเช็กชื่อ' : (loginMode === 'pin' ? 'ใช้เลขประจำตัวนักเรียนและ PIN 4 หลักของคุณ' : 'ใส่เลขประจำตัวนักเรียนของคุณ');
  }
  const show = (id) => ['view-login', 'view-setup', 'view-app'].forEach((v) => $('#' + v).classList.toggle('hidden', v !== id));
  const showNav = (on) => $('#nav').classList.toggle('hidden', !on);

  function saveSession(res) {
    session = { token: res.token, student: res.student };
    store.set('session', JSON.stringify({ ...session, at: Date.now() }));
    store.set('lastId', res.student.id);
  }
  function loadSession() {
    try {
      const s = JSON.parse(store.get('session') || 'null');
      if (s && Date.now() - s.at < 9.5 * 3600e3) return s;
    } catch (e) { /* ไม่มี */ }
    return null;
  }
  function logout() {
    store.del('session');
    session = null; me = null; checkinResult = null;
    if (confirmLink) { pending = { s: confirmLink.s, t: confirmLink.t }; confirmLink = null; setMode(loginMode); }   // กด "ไม่ใช่ฉัน" แล้วให้เพื่อนใช้ลิงก์เดิมต่อได้
    $('#who').classList.add('hidden'); $('#logout').classList.add('hidden'); showNav(false);
    $('#login-pin').value = '';
    $('#login-id').value = store.get('lastId') || '';
    show('view-login');
  }
  const authLost = (e) => {
    if (e && e.code === 'AUTH') { logout(); toast('หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง', true); return true; }
    return false;
  };

  // ───── เข้าสู่ระบบ ─────
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('#login-form button');
    const id = $('#login-id').value.trim(), pin = $('#login-pin').value;
    await busy(btn, async () => {
      try {
        btn.innerHTML = '<span class="spin"></span>กำลังเข้าสู่ระบบ… (รอสักครู่)';
        const res = await api('login', { id, pin });
        if (res.needSetup) {
          setMode('pin');
          setupId = id;
          $('#setup-name').textContent = res.name;
          $('#setup-pin').value = ''; $('#setup-pin2').value = '';
          show('view-setup');
          return;
        }
        saveSession(res);
        await enter(res.me);
      } catch (e) { if (e.code === 'BAD_PIN') setMode('pin'); toast(e.message || 'เข้าสู่ระบบไม่สำเร็จ', true); }
    });
  });

  $('#setup-cancel').addEventListener('click', () => { show('view-login'); });
  $('#setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pin = $('#setup-pin').value;
    if (!/^\d{4}$/.test(pin)) return toast('PIN ต้องเป็นตัวเลข 4 หลัก', true);
    if (pin !== $('#setup-pin2').value) return toast('PIN สองช่องไม่ตรงกัน', true);
    await busy(ev.submitter, async () => {
      try {
        const res = await api('setPin', { id: setupId, pin, deviceId: deviceId() });
        saveSession(res);
        toast('ตั้ง PIN เรียบร้อย');
        await enter(res.me);
      } catch (e) { toast(e.message, true); }
    });
  });
  $('#logout').addEventListener('click', logout);

  // ───── เข้าแอป ─────
  async function enter(first) {   // first = ข้อมูลหน้าแรกที่ได้มากับการเข้าสู่ระบบ (ไม่ต้องเรียก me ซ้ำ)
    $('#who').textContent = session.student.name + ' · ห้อง ' + session.student.room;
    $('#who').classList.remove('hidden'); $('#logout').classList.remove('hidden');
    show('view-app'); showNav(true);
    $('#tab-checkin').innerHTML = '<div class="card center muted">กำลังโหลด…</div>';
    const hadPending = !!pending;
    if (pending) { confirmLink = { ...pending, info: linkInfo }; pending = null; }   // ไม่เช็กให้อัตโนมัติ: แสดงชื่อให้นักเรียนตรวจแล้วกดยืนยันเอง (กันกรอกเลขผิดคน)
    if (first && !hadPending) { me = gotMe(first); renderCheckin(); renderSubmit(); renderMe(); } else await refresh();
    if (!me) return;   // เข้าสู่ระบบหมดอายุ: รอให้ล็อกอินใหม่ แล้วค่อยเปิดลิงก์งานต่อ
    if (pendingAsg) {
      const a = me && me.assignments.find((x) => x.assignmentId === pendingAsg);
      pendingAsg = null;
      if (a && a.status === 'open' && !(a.mine && a.mine.status === 'done')) { activeAsg = a; photos = []; batchId = null; renderSubmit(); switchTab('submit'); return; }
      if (a) { switchTab('submit'); toast(a.status === 'open' ? 'งานนี้ครูตรวจแล้ว' : 'งานนี้ปิดรับแล้ว', true); return; }
      toast('ไม่พบงานนี้ในห้องของคุณ', true);
    }
    switchTab('checkin');
  }

  async function refresh() {
    try { me = gotMe(await api('me', { token: session.token })); }
    catch (e) { if (!authLost(e)) toast(e.message, true); return; }
    renderCheckin(); renderSubmit(); renderMe();
  }

  function switchTab(name) {
    $$('#nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['checkin', 'submit', 'me'].forEach((t) => $('#tab-' + t).classList.toggle('hidden', t !== name));
    window.scrollTo({ top: 0 });
  }
  $$('#nav button').forEach((b) => b.addEventListener('click', async () => { switchTab(b.dataset.tab); if (b.dataset.tab !== 'submit' || !activeAsg) await refresh(); }));

  // ───── แท็บเช็กชื่อ ─────
  function renderCheckin() {
    const el = $('#tab-checkin');
    let top = '';
    if (checkinResult) {
      const r = checkinResult;
      if (r.ok) {
        const late = r.status === 'late';
        top = `<div class="result ${late ? 'warn' : 'ok'}" role="status">
          <div class="big" aria-hidden="true">${icon(late ? 'clock' : 'checkCircle')}</div>
          <h2>${r.already ? 'เช็กชื่อไว้แล้ว' : 'เช็กชื่อสำเร็จ'}</h2>
          <p>${late ? 'มาสาย' : 'มาเรียนตรงเวลา'} · ${esc(thTime(r.time))} น.${r.subject ? '<br>' + esc(r.subject) : ''}</p></div>`;
      } else {
        top = `<div class="result bad" role="alert"><div class="big" aria-hidden="true">${icon('alert')}</div><h2>เช็กชื่อไม่สำเร็จ</h2><p>${esc(r.message)}</p></div>`;
      }
    }
    if (confirmLink) top = confirmCard() + top;
    const list = (me ? (me.openSessions || []) : []).filter((x) => !confirmLink || x.sessionId !== confirmLink.s);   // คาบเดียวกับการ์ดยืนยัน ไม่ต้องโชว์ซ้ำ
    const todayRows = (me ? me.attendance : []).filter((a) => a.status !== 'pending').slice(0, 1);
    const sessCards = list.map((x) => {
      const what = `${x.subject ? esc(x.subject) : 'คาบเรียน'}${x.classLabel ? ' · ' + esc(x.classLabel) : ''}`;
      const until = `รับเช็กชื่อถึง ${esc(thTime(x.closeAt))} น. · ตรงเวลาถึง ${esc(thTime(x.onTimeUntil))} น.`;
      if (x.checked) return `<div class="card"><div class="row"><div class="grow"><h3>${what}</h3><div class="small muted">${esc(x.label)}</div></div>${badge(x.checked)}</div><p class="small muted" style="margin:8px 0 0">เช็กชื่อเรียบร้อยแล้ว</p></div>`;
      if (x.app) return `<div class="card"><h2>${icon('userCheck')}เช็กชื่อเข้าเรียน</h2><p style="margin-bottom:4px"><b>${what}</b></p><p class="small muted">${until}</p>
        <button class="btn primary block" data-ci="${esc(x.sessionId)}" type="button" style="font-size:1.15rem;min-height:56px">${icon('userCheck')} เช็กชื่อ</button></div>`;
      return `<div class="card"><h3>${what}</h3><p class="small">คาบนี้ให้เช็กชื่อด้วยการ <b>สแกน QR</b> ที่ครูส่งให้หรือที่หน้าห้อง</p><p class="small muted">${until}</p></div>`;
    }).join('');
    el.innerHTML = `
      ${top}
      ${me ? clockNote() : ''}
      ${sessCards || `<div class="card"><h2>${icon('userCheck')}เช็กชื่อ</h2><p class="muted">ขณะนี้ยังไม่มีคาบที่เปิดเช็กชื่อ รอครูเปิดคาบ แล้วจะมีปุ่มเช็กชื่อขึ้นที่นี่ (หรือสแกน QR ที่ครูส่งให้)</p></div>`}
      <div class="card">
        <h3>${icon('info')}วิธีเช็กชื่อ</h3>
        <ol class="small" style="margin:0;padding-left:20px">
          <li>กดปุ่ม <b>เช็กชื่อ</b> ด้านบน (เมื่อครูเปิดคาบ)</li>
          <li>หรือสแกน QR ที่ครูส่งให้ / ที่หน้าห้อง แล้วเข้าสู่ระบบ ระบบจะเช็กชื่อให้อัตโนมัติ</li>
        </ol>
        ${todayRows.length ? `<p class="small muted" style="margin-top:10px">คาบล่าสุด: ${esc(thDate(todayRows[0].date))} ${badge(todayRows[0].status)}</p>` : ''}
        <p class="small muted">เครื่องหนึ่งเครื่องเช็กชื่อได้คนเดียว ถ้าใช้เครื่องเดียวกันเช็กแทนเพื่อน ระบบจะแจ้งครู</p>
      </div>`;
    const cb = $('#ci-confirm', el);
    if (cb) cb.addEventListener('click', () => busy(cb, async () => {
      const l = confirmLink;
      try {
        checkinResult = { ok: true, ...(await api('checkin', { token: session.token, sessionId: l.s, t: l.t, deviceId: deviceId() })) };
        confirmLink = null;
      } catch (e) {
        if (authLost(e)) return;
        checkinResult = { ok: false, code: e.code, message: e.message };
        confirmLink = null;
      }
      await refresh();
      window.scrollTo({ top: 0 });
    }));
    const cn = $('#ci-notme', el);
    if (cn) cn.addEventListener('click', logout);
    $$('[data-ci]', el).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      try {
        checkinResult = { ok: true, ...(await api('checkin', { token: session.token, sessionId: b.dataset.ci, app: true, deviceId: deviceId() })) };
      } catch (e) {
        if (authLost(e)) return;
        checkinResult = { ok: false, code: e.code, message: e.message };
      }
      await refresh();
      window.scrollTo({ top: 0 });
    })));
  }

  // การ์ดยืนยันเช็กชื่อหลังเปิดจากลิงก์/QR: โชว์ชื่อกับคาบ แล้วให้กดยืนยัน
  const stateText = (i) => ({
    notyet: `ยังไม่ถึงวันเช็กชื่อ เช็กได้ในวันที่ ${thDate(i.date)}`,
    late: 'เลยเวลารับเช็กชื่อของคาบนี้แล้ว ให้แจ้งครู',
    closed: 'คาบนี้ปิดแล้ว ถ้าอยู่ในห้องให้แจ้งครู'
  }[i.state] || '');
  function confirmCard() {
    const i = confirmLink.info, st = session.student, bad = i && i.state !== 'open';
    return `<div class="card"><h2>${icon('userCheck')}ยืนยันการเช็กชื่อ</h2>
      <p style="font-size:1.2em;margin:.2rem 0"><b>${esc(st.name)}</b></p>
      <p class="small muted" style="margin:0 0 .6rem">เลขประจำตัว ${esc(st.id)} · ห้อง ${esc(st.room)}</p>
      ${i ? `<p class="small" style="margin:0 0 .6rem">${icon('calendar')} <b>${esc(i.subject || 'คาบเรียน')}${i.classLabel ? ' · ' + esc(i.classLabel) : ''}</b> · ${esc(thDate(i.date))}${i.label ? ' · ' + esc(i.label) : ''}<br>รับเช็กชื่อถึง ${esc(thTime(i.closeAt))} น. · ตรงเวลาถึง ${esc(thTime(i.onTimeUntil))} น.</p>` : ''}
      ${bad ? `<p class="result warn small" style="margin:0 0 .6rem">${icon('alert')} ${esc(stateText(i))}</p>` : ''}
      <button class="btn primary block" id="ci-confirm" type="button" style="font-size:1.15rem;min-height:56px" ${bad ? 'disabled' : ''}>${icon('userCheck')} ใช่ ยืนยันเช็กชื่อ</button>
      <button class="btn block" id="ci-notme" type="button" style="margin-top:8px">ไม่ใช่ฉัน (เปลี่ยนคน)</button></div>`;
  }

  // ถามสถานะคาบเป็นระยะ: ครูเปิดคาบแล้วปุ่มเช็กชื่อขึ้นเอง
  async function pollOpen() {
    if (!session || !me || document.hidden || $('#tab-checkin').classList.contains('hidden')) return;
    try { me = gotMe(await api('me', { token: session.token }, { tries: 1 })); renderCheckin(); } catch (e) { authLost(e); }
  }
  setInterval(pollOpen, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollOpen(); });

  // ───── แท็บส่งงาน ─────
  function renderSubmit() {
    const el = $('#tab-submit');
    if (activeAsg) return renderSubmitForm(el);
    const list = me ? me.assignments : [];
    if (!list.length) { el.innerHTML = `<div class="card center muted">${icon('book')} ยังไม่มีงานที่ครูมอบหมาย</div>`; return; }
    el.innerHTML = `<h2 style="margin-top:16px">${icon('book')}งานของฉัน</h2>` + list.map((a) => {
      const m = a.mine, st = m ? m.status : (a.status === 'open' ? 'missing' : 'missing');
      const score = m && m.score !== null ? ` · ${fmtNum(m.score)}/${fmtNum(a.maxScore)}` : '';
      return `<div class="card"><div class="row"><div class="grow"><h3>${esc(a.title)}</h3>
        <div class="small muted">คะแนนเต็ม ${fmtNum(a.maxScore)}${a.due ? ' · กำหนดส่ง ' + esc(thDateTime(a.due)) : ''}${a.status === 'closed' ? ' · ปิดรับแล้ว' : ''}</div></div>
        ${badge(st)}</div>
        ${m ? `<p class="small" style="margin-top:8px">ส่งแล้ว ${m.count} ไฟล์ · รอบที่ ${m.round}${score}${m.late ? ' · ส่งช้า' : ''}</p>` : ''}
        ${a.description ? `<p class="small" style="white-space:pre-wrap;margin-top:8px">${esc(a.description)}</p>` : ''}
        ${m && m.comment ? `<p class="small"><b>ครูเขียนว่า:</b> ${esc(m.comment)}</p>` : ''}
        ${a.receipts && a.receipts.length ? `<div class="row" style="margin:8px 0">${a.receipts.map((r) => `<button class="btn sm" data-rc="${esc(r.receiptId)}" type="button">${icon('file')} ใบหลักฐาน ครั้งที่ ${r.round}</button>`).join('')}</div>` : ''}
        ${a.status === 'open' && !(m && m.status === 'done')
          ? `<button class="btn primary block" data-asg="${esc(a.assignmentId)}" type="button">${m ? (m.status === 'revise' ? 'ส่งงานที่แก้ไขแล้ว' : 'ส่งเพิ่ม/ส่งใหม่') : 'ส่งงานนี้'}</button>` : ''}
      </div>`;
    }).join('');
    $$('[data-rc]', el).forEach((b) => b.addEventListener('click', () => openReceipt(b.dataset.rc)));
    $$('[data-asg]', el).forEach((b) => b.addEventListener('click', () => { activeAsg = me.assignments.find((a) => a.assignmentId === b.dataset.asg); photos = []; renderSubmit(); window.scrollTo({ top: 0 }); }));
  }

  function renderSubmitForm(el) {
    const a = activeAsg;
    el.innerHTML = `
      <div class="card">
        <button class="btn sm" type="button" id="sub-back">${icon('back')} กลับ</button>
        <h2 style="margin-top:12px">${esc(a.title)}</h2>
        ${a.subject ? `<div class="small muted">${esc(a.subject)}${a.classLabel ? ' · ' + esc(a.classLabel) : ''}</div>` : ''}
        ${a.description ? `<p style="white-space:pre-wrap;margin-top:8px">${esc(a.description)}</p>` : ''}
        <p class="small muted">คะแนนเต็ม ${fmtNum(a.maxScore)}${a.due ? ' · กำหนดส่ง ' + esc(thDateTime(a.due)) : ''}</p>
        ${a.mine && a.mine.status === 'revise' ? `<p class="result warn small">ครูให้แก้ไข${a.mine.comment ? ': ' + esc(a.mine.comment) : ''}</p>` : ''}
        <div class="row">
          <label class="btn primary grow" for="cam">${icon('camera')} ถ่ายรูป</label>
          <label class="btn grow" for="pick">${icon('image')} เลือกรูป</label>
          <label class="btn grow" for="pdf">${icon('file')} แนบ PDF</label>
        </div>
        <input id="cam" type="file" accept="image/*" capture="environment" class="hidden">
        <input id="pick" type="file" accept="image/*" multiple class="hidden">
        <input id="pdf" type="file" accept="application/pdf,.pdf" multiple class="hidden">
        <p class="small muted" style="margin-top:8px">ถ่ายให้เห็นตัวหนังสือชัด แสงพอ เห็นทั้งหน้า ส่งได้หลายรูป (เรียงตามหน้า) หรือแนบไฟล์ <b>PDF</b> (ไม่เกิน 500 MB ต่อไฟล์) รวมกันไม่เกิน 8 ไฟล์ต่อครั้ง</p>
        <div class="thumbs" id="thumbs" aria-live="polite"></div>
        <div id="progress" class="hidden"><div class="bar"><i style="width:0"></i></div><p class="small center" id="progress-text"></p></div>
        <button class="btn ok block" id="sub-send" type="button" disabled>${icon('send')}ส่งงาน</button>
      </div>`;
    $('#sub-back').addEventListener('click', () => { if (photos.length && !confirm('ยกเลิกรูปที่เลือกไว้?')) return; activeAsg = null; photos = []; renderSubmit(); });
    $('#cam').addEventListener('change', (e) => addFiles(e.target.files));
    $('#pick').addEventListener('change', (e) => addFiles(e.target.files));
    $('#pdf').addEventListener('change', (e) => addFiles(e.target.files));
    $('#sub-send').addEventListener('click', send);
    drawThumbs();
  }

  async function addFiles(files) {
    const max = 8;
    for (const f of Array.from(files)) {
      if (photos.length >= max) { toast(`ส่งได้ไม่เกิน ${max} ไฟล์ต่อครั้ง`, true); break; }
      try { photos.push(isPdf(f) ? await readPdf(f) : await compress(f)); }
      catch (e) { toast(e.pdfMsg || 'เปิดรูปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกไฟล์ JPG/PNG', true); }
    }
    $('#cam').value = ''; $('#pick').value = ''; $('#pdf').value = '';
    drawThumbs();
  }

  const MAX_FILE = 500 * 1024 * 1024;   // PDF ขนาดสูงสุด
  const SMALL_PDF = 5 * 1024 * 1024;    // ไม่เกินนี้ส่งผ่านสคริปต์ตามปกติ ใหญ่กว่านี้อัปโหลดเป็นก้อนเข้า Drive โดยตรง
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  // PDF ส่งทั้งไฟล์ตามเดิม (ไม่ย่อ) จึงจำกัดขนาด และเช็กหัวไฟล์ %PDF- กันไฟล์เสียหรือเปลี่ยนนามสกุล
  async function readPdf(file) {
    const bad = (m) => Object.assign(new Error('pdf'), { pdfMsg: m });
    if (file.size > MAX_FILE) throw bad(`${file.name} ใหญ่เกิน 500 MB (${(file.size / 1048576).toFixed(1)} MB) ลองลดขนาดไฟล์`);
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== '%PDF-') throw bad(`${file.name} ไม่ใช่ไฟล์ PDF ที่ถูกต้อง`);
    if (file.size > SMALL_PDF) return { pdf: true, big: true, file, name: file.name, url: '', size: file.size };   // ไม่อ่านเข้าหน่วยความจำ ส่งเป็นก้อนทีหลัง
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
    return { pdf: true, name: file.name, b64, url: URL.createObjectURL(file), size: file.size };
  }

  function drawThumbs() {
    const box = $('#thumbs'); if (!box) return;
    box.innerHTML = photos.map((p, i) => `<div class="thumb${p.pdf ? ' pdf' : ''}">${p.pdf ? `<div class="pdftile"><b>PDF</b><span>${esc(p.name)}</span><small>${p.size >= 1048576 ? (p.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(p.size / 1024)) + ' KB'}</small></div>` : `<img src="${p.url}" alt="รูปที่ ${i + 1}">`}<button type="button" data-rm="${i}" aria-label="ลบไฟล์ที่ ${i + 1}">${icon('x')}</button></div>`).join('');
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { URL.revokeObjectURL(photos[b.dataset.rm].url); photos.splice(b.dataset.rm, 1); batchId = null; drawThumbs(); }));
    const send = $('#sub-send');
    send.disabled = !photos.length;
    send.innerHTML = icon('send') + (photos.length ? `ส่งงาน (${photos.length} ไฟล์)` : 'ส่งงาน');
  }

  async function compress(file) {
    const MAX = 1600;
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    }
    const w = bmp.width, h = bmp.height, k = Math.min(1, MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.78));
    if (!blob) throw new Error('compress');
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
    return { b64, url: URL.createObjectURL(blob), size: blob.size };
  }

  // PDF ใหญ่: ขอลิงก์อัปโหลดจากสคริปต์ แล้วส่งเข้า Drive โดยตรงทีละก้อน (ก้อนไหนล้มลองซ้ำเอง) แล้วแจ้งสคริปต์ให้บันทึกลงรายการส่งงาน
  async function uploadBig(p, idx, onProgress) {
    const base = { token: session.token, assignmentId: activeAsg.assignmentId, batchId, idx };
    const start = await api('fileStart', { ...base, size: p.size, name: p.name, origin: location.origin }, { tries: 4 });
    let fileId = start.fileId || '';
    if (!start.done) {
      let offset = 0;
      const total = p.size, CH = start.chunk || 8 * 1024 * 1024;
      const parseRange = (res) => { const m = /bytes=0-(\d+)/.exec(res.headers.get('Range') || ''); return m ? Number(m[1]) + 1 : null; };
      while (offset < total) {
        const end = Math.min(offset + CH, total);
        let sent = false, last = null;
        for (let t = 0; t < 6 && !sent; t++) {
          try {
            const res = await fetch(start.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` }, body: p.file.slice(offset, end) });
            if (res.status === 308) { offset = Math.min(end, parseRange(res) || end); sent = true; }
            else if (res.ok) { try { fileId = (await res.json()).id || ''; } catch (e) { /* อ่านผลไม่ได้ ให้สคริปต์หาไฟล์จากชื่อแทน */ } offset = total; sent = true; }
            else last = new Error('HTTP ' + res.status);
          } catch (e) { last = e; }
          if (!sent) {
            await wait(1500 * (t + 1));
            try {   // ถามสถานะ: ถ้า Drive ได้ไฟล์ครบแล้วหรือรับก้อนนี้แล้ว จะได้ไม่ส่งซ้ำ
              const q = await fetch(start.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } });
              if (q.ok) { try { fileId = (await q.json()).id || ''; } catch (e) { /* ใช้ชื่อไฟล์แทน */ } offset = total; sent = true; }
              else if (q.status === 308) { const o = parseRange(q); if (o !== null && o >= end) { offset = o; sent = true; } }
            } catch (e) { /* ยังต่อเน็ตไม่ได้ วนลองใหม่ */ }
          }
        }
        if (!sent) throw new Error('อัปโหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วกดส่งอีกครั้ง (ไฟล์ที่ส่งไปแล้วไม่ต้องส่งใหม่ทั้งหมด)');
        onProgress(offset / total);
      }
    }
    await api('fileDone', { ...base, fileId, fileName: start.name, size: p.size, name: p.name }, { tries: 4 });
  }

  async function send() {
    const btn = $('#sub-send'), total = photos.length;
    batchId = batchId || uuid();
    const bar = $('#progress'), fill = $('#progress i'), txt = $('#progress-text');
    btn.disabled = true; bar.classList.remove('hidden');
    $('#cam').disabled = true; $('#pick').disabled = true; $('#pdf').disabled = true;
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);   // กันปิดหน้าระหว่างอัปโหลดไฟล์ใหญ่
    try {
      for (let i = 0; i < total; i++) {
        txt.textContent = `กำลังส่งไฟล์ที่ ${i + 1} จาก ${total} … อย่าปิดหน้านี้`;
        fill.style.width = (i / total * 100) + '%';
        if (photos[i].big) {
          const mb = photos[i].size / 1048576;
          await uploadBig(photos[i], i, (f) => { fill.style.width = ((i + f) / total * 100) + '%'; txt.textContent = `กำลังส่งไฟล์ที่ ${i + 1} จาก ${total} · ${Math.round(f * 100)}% (${(mb * f).toFixed(1)}/${mb.toFixed(1)} MB) … อย่าปิดหน้านี้`; });
          continue;
        }
        await api('submitImage', { token: session.token, assignmentId: activeAsg.assignmentId, batchId, idx: i, data: photos[i].b64, ...(photos[i].pdf ? { mime: 'application/pdf', name: photos[i].name } : {}) }, { tries: 4 });
      }
      fill.style.width = '100%'; txt.textContent = 'กำลังออกใบหลักฐาน…';
      const receipt = await api('submitFinish', { token: session.token, assignmentId: activeAsg.assignmentId, batchId, count: total }, { tries: 4 });
      const title = activeAsg.title, urls = photos.map((p) => p.url), pdfs = photos.map((p) => p.pdf ? { pdf: true, name: p.name } : null);
      photos = []; activeAsg = null; batchId = null;
      window.removeEventListener('beforeunload', guard);
      await refresh();
      switchTab('submit');
      $('#tab-submit').insertAdjacentHTML('afterbegin', `<div class="result ok" role="status" style="margin-top:14px"><div class="big" aria-hidden="true">${icon('checkCircle')}</div><h2>ส่งงานเรียบร้อย</h2><p>${esc(title)} · ${total} ไฟล์ · เลขที่ ${esc(receipt.receipt.receiptId)}</p></div>`);
      window.scrollTo({ top: 0 });
      await Receipt.show(receipt, () => Promise.all(urls.map((u, i) => pdfs[i] || Receipt.loadImage(u))));
      urls.forEach((u) => URL.revokeObjectURL(u));
    } catch (e) {
      window.removeEventListener('beforeunload', guard);
      if (authLost(e)) return;
      toast((e.message || 'ส่งไม่สำเร็จ') + ' (ไฟล์ที่เลือกยังอยู่ กดส่งอีกครั้งได้)', true);
      $('#cam').disabled = false; $('#pick').disabled = false; $('#pdf').disabled = false; btn.disabled = false; bar.classList.add('hidden');
    }
  }

  async function openReceipt(id) {
    try {
      const data = await api('myReceipt', { token: session.token, receiptId: id });
      await Receipt.show(data, (d, prog) => Receipt.imagesFromServer(d.files, (fid) => api('myImage', { token: session.token, fileId: fid }), prog, d.fileMeta));
    } catch (e) { if (!authLost(e)) toast(e.message, true); }
  }

  // ───── แท็บผลของฉัน ─────
  function renderMe() {
    const el = $('#tab-me');
    const t = me.attTotals, pct = t.max ? Math.round(t.score / t.max * 100) : 0;
    const done = me.assignments.filter((a) => a.mine && a.mine.score !== null);
    const got = done.reduce((n, a) => n + a.mine.score, 0), full = me.assignments.reduce((n, a) => n + a.maxScore, 0);
    el.innerHTML = `
      <h2 style="margin-top:16px">${icon('chart')}ผลของฉัน</h2>
      <div class="grid cols-2">
        <div class="card"><h3>${icon('userCheck')}คะแนนเข้าเรียน</h3>
          <div class="stat"><b>${fmtNum(t.score)} / ${fmtNum(t.max)}</b><span>${pct}% จาก ${t.sessions} คาบ</span></div>
          <p class="small muted" style="margin-top:10px">มา ${t.present} · สาย ${t.late} · ลา ${t.leave} · ขาด ${t.absent}</p></div>
        <div class="card"><h3>${icon('book')}คะแนนส่งงาน</h3>
          <div class="stat"><b>${fmtNum(got)} / ${fmtNum(full)}</b><span>${me.assignments.length} งาน · ตรวจแล้ว ${done.length}</span></div></div>
      </div>
      <div class="card"><h3>${icon('calendar')}การเข้าเรียนล่าสุด</h3>
        ${me.attendance.length ? `<table><tbody>${me.attendance.map((a) => `<tr><td>${esc(thDate(a.date))}${a.subject ? ' <span class="muted small">' + esc(a.subject) + '</span>' : ''}</td><td>${a.time ? esc(thTime(a.time)) : ''}</td><td class="num">${badge(a.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีข้อมูล</p>'}
      </div>`;
  }

  // ───── เริ่มต้น ─────
  // เปิดจากลิงก์/QR: ถามข้อมูลคาบมาโชว์บนหน้าล็อกอินทันที (ก่อนล็อกอิน) จะได้รู้ว่าคาบอะไร เช็กได้เมื่อไร
  async function loadLinkInfo() {
    const box = $('#link-info'); if (!pending || !box) return;
    try {
      linkInfo = await api('sessionInfo', { s: pending.s, t: pending.t }, { tries: 2 });
      const bad = linkInfo.state !== 'open';
      box.className = 'result ' + (bad ? 'warn' : 'ok');
      box.innerHTML = `<b>${icon('calendar')} ${esc(linkInfo.subject || 'คาบเรียน')}${linkInfo.classLabel ? ' · ' + esc(linkInfo.classLabel) : ''}</b><br><span class="small">${esc(thDate(linkInfo.date))}${linkInfo.label ? ' · ' + esc(linkInfo.label) : ''} · รับเช็กชื่อถึง ${esc(thTime(linkInfo.closeAt))} น.${bad ? '<br><b>' + esc(stateText(linkInfo)) + '</b>' : ''}</span>`;
    } catch (e) {
      box.className = 'result bad'; box.innerHTML = `${icon('alert')} ${esc(e.message || 'ลิงก์ไม่ถูกต้อง')}`;
    }
  }

  (async function init() {
    loadLinkInfo();
    $('#login-id').value = store.get('lastId') || '';
    api('ping', {}, { tries: 1 }).then((r) => setMode(r.loginMode)).catch(() => {});
    const s = loadSession();
    if (s) { session = s; await enter(); return; }
    setMode(loginMode);
    show('view-login');
  })();
})();
