/* หน้านักเรียน: เข้าสู่ระบบ → เช็กชื่อ (สแกน QR หรือกดปุ่มในแอป) → ส่งงานด้วยรูปถ่าย → ดูผลของตัวเอง */
(function () {
  const params = new URLSearchParams(location.search);
  let pending = params.get('s') && params.get('t') ? { s: params.get('s'), t: params.get('t') } : null;
  let pendingAsg = params.get('a') || null;   // ลิงก์ส่งงานที่ครูส่งให้ (?a=รหัสงาน)
  if (pending || pendingAsg) history.replaceState(null, '', location.pathname); // กัน QR/ลิงก์ค้างอยู่ใน URL/ประวัติเบราว์เซอร์

  let session = null;          // { token, student, exp }
  let me = null;               // ข้อมูลจาก action "me"
  let checkinResult = null;    // ผลเช็กชื่อล่าสุด
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
    $('#login-note').textContent = pending ? 'เข้าสู่ระบบเพื่อเช็กชื่อ (จะเช็กชื่อให้ทันทีหลังเข้าสู่ระบบ)' : (loginMode === 'pin' ? 'ใช้เลขประจำตัวนักเรียนและ PIN 4 หลักของคุณ' : 'ใส่เลขประจำตัวนักเรียนของคุณ');
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
    if (pending) {
      const p = pending; pending = null;
      try {
        checkinResult = { ok: true, ...(await api('checkin', { token: session.token, sessionId: p.s, t: p.t, deviceId: deviceId() })) };
      } catch (e) {
        if (authLost(e)) { pending = p; return; }
        checkinResult = { ok: false, code: e.code, message: e.message };
      }
    }
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
    const list = me ? (me.openSessions || []) : [];
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
        ${m ? `<p class="small" style="margin-top:8px">ส่งแล้ว ${m.count} รูป · รอบที่ ${m.round}${score}${m.late ? ' · ส่งช้า' : ''}</p>` : ''}
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
        </div>
        <input id="cam" type="file" accept="image/*" capture="environment" class="hidden">
        <input id="pick" type="file" accept="image/*" multiple class="hidden">
        <p class="small muted" style="margin-top:8px">ถ่ายให้เห็นตัวหนังสือชัด แสงพอ เห็นทั้งหน้า ส่งได้หลายรูป (เรียงตามหน้า)</p>
        <div class="thumbs" id="thumbs" aria-live="polite"></div>
        <div id="progress" class="hidden"><div class="bar"><i style="width:0"></i></div><p class="small center" id="progress-text"></p></div>
        <button class="btn ok block" id="sub-send" type="button" disabled>${icon('send')}ส่งงาน</button>
      </div>`;
    $('#sub-back').addEventListener('click', () => { if (photos.length && !confirm('ยกเลิกรูปที่เลือกไว้?')) return; activeAsg = null; photos = []; renderSubmit(); });
    $('#cam').addEventListener('change', (e) => addFiles(e.target.files));
    $('#pick').addEventListener('change', (e) => addFiles(e.target.files));
    $('#sub-send').addEventListener('click', send);
    drawThumbs();
  }

  async function addFiles(files) {
    const max = 8;
    for (const f of Array.from(files)) {
      if (photos.length >= max) { toast(`ส่งได้ไม่เกิน ${max} รูปต่อครั้ง`, true); break; }
      try { photos.push(await compress(f)); }
      catch (e) { toast('เปิดรูปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกไฟล์ JPG/PNG', true); }
    }
    $('#cam').value = ''; $('#pick').value = '';
    drawThumbs();
  }

  function drawThumbs() {
    const box = $('#thumbs'); if (!box) return;
    box.innerHTML = photos.map((p, i) => `<div class="thumb"><img src="${p.url}" alt="รูปที่ ${i + 1}"><button type="button" data-rm="${i}" aria-label="ลบรูปที่ ${i + 1}">${icon('x')}</button></div>`).join('');
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { URL.revokeObjectURL(photos[b.dataset.rm].url); photos.splice(b.dataset.rm, 1); batchId = null; drawThumbs(); }));
    const send = $('#sub-send');
    send.disabled = !photos.length;
    send.innerHTML = icon('send') + (photos.length ? `ส่งงาน (${photos.length} รูป)` : 'ส่งงาน');
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

  async function send() {
    const btn = $('#sub-send'), total = photos.length;
    batchId = batchId || uuid();
    const bar = $('#progress'), fill = $('#progress i'), txt = $('#progress-text');
    btn.disabled = true; bar.classList.remove('hidden');
    $('#cam').disabled = true; $('#pick').disabled = true;
    try {
      for (let i = 0; i < total; i++) {
        txt.textContent = `กำลังส่งรูปที่ ${i + 1} จาก ${total} … อย่าปิดหน้านี้`;
        fill.style.width = (i / total * 100) + '%';
        await api('submitImage', { token: session.token, assignmentId: activeAsg.assignmentId, batchId, idx: i, data: photos[i].b64 }, { tries: 4 });
      }
      fill.style.width = '100%'; txt.textContent = 'กำลังออกใบหลักฐาน…';
      const receipt = await api('submitFinish', { token: session.token, assignmentId: activeAsg.assignmentId, batchId, count: total }, { tries: 4 });
      const title = activeAsg.title, urls = photos.map((p) => p.url);
      photos = []; activeAsg = null; batchId = null;
      await refresh();
      switchTab('submit');
      $('#tab-submit').insertAdjacentHTML('afterbegin', `<div class="result ok" role="status" style="margin-top:14px"><div class="big" aria-hidden="true">${icon('checkCircle')}</div><h2>ส่งงานเรียบร้อย</h2><p>${esc(title)} · ${total} รูป · เลขที่ ${esc(receipt.receipt.receiptId)}</p></div>`);
      window.scrollTo({ top: 0 });
      await Receipt.show(receipt, () => Promise.all(urls.map(Receipt.loadImage)));
      urls.forEach((u) => URL.revokeObjectURL(u));
    } catch (e) {
      if (authLost(e)) return;
      toast((e.message || 'ส่งไม่สำเร็จ') + ' (รูปที่เลือกยังอยู่ กดส่งอีกครั้งได้)', true);
      $('#cam').disabled = false; $('#pick').disabled = false; btn.disabled = false; bar.classList.add('hidden');
    }
  }

  async function openReceipt(id) {
    try {
      const data = await api('myReceipt', { token: session.token, receiptId: id });
      await Receipt.show(data, (d, prog) => Receipt.imagesFromServer(d.files, (fid) => api('myImage', { token: session.token, fileId: fid }), prog));
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
  (async function init() {
    $('#login-id').value = store.get('lastId') || '';
    api('ping', {}, { tries: 1 }).then((r) => setMode(r.loginMode)).catch(() => {});
    const s = loadSession();
    if (s) { session = s; await enter(); return; }
    setMode(loginMode);
    show('view-login');
  })();
})();
