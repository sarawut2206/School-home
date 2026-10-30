/* หน้าครู: เปิดคาบ/QR หมุนรหัส, มอบหมายงาน, ตรวจงานจากรูป, รายงานคะแนน, จัดการนักเรียน */
(function () {
  let tt = store.get('tt', 'session');
  let rooms = [];
  let loginMode = 'id';
  const state = { room: store.get('room') || '', tab: 'timetable' };
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
        tt = r.tt; rooms = r.rooms; loginMode = r.loginMode || loginMode; store.set('tt', tt, 'session'); $('#pass').value = '';
        ensureRoom(); show('app'); openTab('timetable');
      } catch (e) { fail(e); }
    });
  });

  // ───── แท็บ ─────
  const PANELS = ['timetable', 'checkin', 'assign', 'review', 'report', 'settings'];
  function openTab(name) {
    if (name !== 'checkin') stopLive();
    state.tab = name;
    $$('#tabs .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    PANELS.forEach((p) => $('#p-' + p).classList.toggle('hidden', p !== name));
    ({ timetable: renderTimetable, checkin: renderCheckin, assign: renderAssign, review: renderReview, report: renderReport, settings: renderSettings })[name]();
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) openTab(b.dataset.tab); });

  // ═════════════ เช็กชื่อ ═════════════
  function stopLive() { live.timers.forEach(clearInterval); live.timers = []; live.sid = null; live.lastKey = ''; }

  async function renderCheckin() {
    stopLive();
    const el = $('#p-checkin');
    try {
      tb = tb || await T('t_timetable', {}); rooms = tb.rooms;
      gridSess = (await T('t_sessions', {})).sessions;
    } catch (e) { fail(e); return; }
    const room = ensureRoom();
    el.innerHTML = `
      <div class="card">
        <div class="row"><div class="grow"><h2 style="margin:0">เปิดคาบเช็กชื่อ</h2>
          <div class="small muted">กดที่ช่องวิชาในตาราง แล้วเลือกวันที่ → สร้าง QR ส่งให้นักเรียน (หรือเปิดฉายหน้าจอ)</div></div>
          <button class="btn" id="tt-adhoc" type="button">QR นอกตาราง</button></div>
        <div id="tt-grid">${ttGrid(false)}</div>
      </div>
      <div id="ck-live"></div>
      <div class="card"><div class="row"><h3 class="grow" style="margin:0">คาบที่ผ่านมา</h3>
        <label class="field" style="margin:0">ห้อง<select id="ck-room">${roomOptions(room)}</select></label></div>
        <div id="ck-past" class="muted" style="margin-top:8px">กำลังโหลด…</div></div>`;
    bindGrid(el);
    $('#tt-adhoc').addEventListener('click', () => openQrDialog(null));
    $('#ck-room').addEventListener('change', (e) => { setRoom(e.target.value); renderCheckin(); });
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

  // ═════════════ ตารางสอน + สร้าง QR ═════════════
  const DAYS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
  let tb = null;     // { periods, slots, rooms }
  let cfgVals = null;
  let gridSess = [];  // คาบที่เคยสร้าง (ใช้ติดป้ายบนตาราง)
  let ttEdit = false; // โหมดแก้ไขตารางสอน
  const addDays = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
  const nextDateFor = (day) => addDays(todayStr(), (day - dowOfToday() + 7) % 7);   // วันที่ใกล้ที่สุดที่ตรงกับวันของคาบ (วันนี้ถ้าตรงกัน)
  const appCfg = window.APP_CONFIG || {};
  const classText = (c) => { const m = String(c || '').match(/^(\d+)[./](\d+)$/); return m ? `ม.${m[1]}/${m[2]}` : String(c || ''); };
  const dowOf = (dateStr) => { const d = new Date(dateStr + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
  const dowOfToday = () => dowOf(todayStr());
  const nowHM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  const per = (n) => (tb.periods.find((p) => p.period === n) || {});
  const slotStart = (s) => per(s.startPeriod).start || '08:00';
  const slotEnd = (s) => per(s.endPeriod).end || '09:00';
  const slotLabel = (s) => `คาบ ${s.startPeriod}${s.endPeriod !== s.startPeriod ? '–' + s.endPeriod : ''} · ${slotStart(s)}–${slotEnd(s)} น.`;

  function openModal(inner) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="panel">${inner}</div></div>`;
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc2); };
    const esc2 = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc2);
    root.firstChild.addEventListener('mousedown', (e) => { if (e.target === root.firstChild) close(); });
    return close;
  }

  async function renderTimetable() {
    const el = $('#p-timetable');
    el.innerHTML = '<div class="card muted">กำลังโหลดตารางสอน…</div>';
    try {
      tb = await T('t_timetable', {}); rooms = tb.rooms;
      gridSess = (await T('t_sessions', {})).sessions;
    } catch (e) { fail(e); return; }
    el.innerHTML = `
      <div class="card"><div class="row"><div class="grow"><h2 style="margin:0">ตารางสอน</h2>
        <div class="small muted" id="tt-hint"></div></div>
        <button class="btn" id="tt-adhoc" type="button">QR นอกตาราง</button>
        <button class="btn" id="tt-edit" type="button"></button>
        <button class="btn" id="tt-periods" type="button">ตั้งเวลาคาบ</button></div>
        <div id="tt-grid"></div></div>`;
    $('#tt-adhoc').addEventListener('click', () => openQrDialog(null));
    $('#tt-periods').addEventListener('click', openPeriodsDialog);
    $('#tt-edit').addEventListener('click', () => { ttEdit = !ttEdit; paintTimetable(); });
    paintTimetable();
  }

  function paintTimetable() {
    const dow = dowOf(todayStr());
    $('#tt-edit').textContent = ttEdit ? '✓ เสร็จสิ้นการแก้ไข' : '✎ แก้ไขตาราง';
    $('#tt-edit').classList.toggle('primary', ttEdit);
    $('#tt-hint').innerHTML = ttEdit
      ? 'โหมดแก้ไข: กดช่องวิชาเพื่อแก้/ลบ · กดช่องว่าง (+) เพื่อเพิ่มคาบ'
      : `วันนี้ วัน${DAYS[dow]}ที่ ${esc(thDate(todayStr()))} · กดที่ช่องวิชา แล้วเลือกวันที่เพื่อสร้าง QR`;
    $('#tt-grid').innerHTML = ttGrid(ttEdit);
    bindGrid($('#p-timetable'));
  }

  // ตารางสอนแบบกริด (แถว = วัน, คอลัมน์ = คาบ) เหมือนตารางกระดาษ
  function ttGrid(edit) {
    const dow = dowOf(todayStr()), now = nowHM(), maxP = tb.periods.length;
    const days = [1, 2, 3, 4, 5].concat([6, 7].filter((d) => tb.slots.some((s) => s.day === d)));
    const head = tb.periods.map((p) => `<th class="g-p"><b>${p.period}</b><span>${esc(p.start)}<br>${esc(p.end)}</span></th>`).join('');
    const rows = days.map((d) => {
      let cells = '', p = 1;
      while (p <= maxP) {
        const i = tb.slots.findIndex((s) => s.day === d && s.startPeriod === p);
        if (i < 0) { cells += edit ? `<td class="g-empty edit"><button type="button" class="g-add" data-add="${d}" data-p="${p}" aria-label="เพิ่มคาบ วัน${DAYS[d]} คาบ ${p}">+</button></td>` : '<td class="g-empty"></td>'; p++; continue; }
        const s = tb.slots[i], span = Math.max(1, Math.min(s.endPeriod, maxP) - p + 1);
        const isNow = d === dow && slotStart(s) <= now && now < slotEnd(s);
        const ses = s.room ? gridSess.find((x) => x.room === s.room && x.label === slotLabel(s) && x.date === nextDateFor(d)) : null;
        const inner = `<b>${esc(s.subject)}</b>${s.classLabel ? `<span>${esc(classText(s.classLabel))}</span>` : ''}${s.place ? `<span>${esc(s.place)}</span>` : ''}${ses ? `<em class="${ses.status === 'open' ? 'open' : ''}">${ses.status === 'open' ? 'เปิดอยู่' : 'เช็กแล้ว ' + ses.present}</em>` : ''}`;
        const cls = `g-slot ${s.room ? 'room' : 'plain'} ${isNow ? 'now' : ''} ${edit ? 'edit' : ''}`;
        cells += `<td colspan="${span}" class="${cls}">${s.room || edit ? `<button type="button" class="g-btn" data-i="${i}" aria-label="${esc(s.subject)} วัน${DAYS[d]} คาบ ${s.startPeriod}">${inner}</button>` : `<div class="g-btn">${inner}</div>`}</td>`;
        p += span;
      }
      return `<tr><th class="g-d ${d === dow ? 'today' : ''}">${DAYS[d]}${d === dow ? '<small>วันนี้</small>' : ''}</th>${cells}</tr>`;
    }).join('');
    return `<div class="tt-wrap"><table class="tt"><thead><tr><th class="g-d">วัน / คาบ</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function bindGrid(root) {
    const editing = ttEdit && state.tab === 'timetable';
    $$('[data-i]', root).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (editing) openSlotDialog(i); else openQrDialog(tb.slots[i]);
    }));
    $$('[data-add]', root).forEach((b) => b.addEventListener('click', () => openSlotDialog(null, { day: Number(b.dataset.add), startPeriod: Number(b.dataset.p), endPeriod: Number(b.dataset.p) })));
  }

  // โหลดสถานะคาบใหม่แล้ววาดตารางซ้ำ (หลังสร้าง QR)
  async function refreshGrid() {
    try { gridSess = (await T('t_sessions', {})).sessions; } catch (e) { return; }
    const g = $('#tt-grid'); if (!g) return;
    g.innerHTML = ttGrid(ttEdit && state.tab === 'timetable');
    bindGrid(g);
  }

  async function getCfg() {
    if (cfgVals) return cfgVals;
    try { cfgVals = {}; (await T('t_config', {})).config.forEach((c) => { cfgVals[c.key] = c.value; }); } catch (e) { cfgVals = {}; }
    return cfgVals;
  }

  async function openQrDialog(slot) {
    const cfg = await getCfg();
    const hasRoom = slot && rooms.some((r) => r.room === slot.room);
    const room = hasRoom ? slot.room : ensureRoom();
    const start = slot ? slotStart(slot) : nowHM();
    const date0 = slot ? nextDateFor(slot.day) : todayStr();
    const close = openModal(`
      <h2>${slot ? 'สร้าง QR เช็กชื่อ' : 'สร้าง QR นอกตารางสอน'}</h2>
      ${slot ? `<p class="muted small">${esc(slot.subject)} ${esc(classText(slot.classLabel))} · วัน${DAYS[slot.day]} ${esc(slotLabel(slot))}</p>` : ''}
      <form id="qd">
        <div class="grid cols-2">
          <label class="field" style="grid-column:1/-1">วันที่เช็กชื่อ<input id="qd-date" type="date" min="${todayStr()}" value="${date0}" required><span class="hint" id="qd-dow"></span></label>
          <label class="field">ห้องเรียนในระบบ<select id="qd-room">${roomOptions(room)}</select></label>
          <label class="field">วิชา / รหัสวิชา<input id="qd-subject" type="text" maxlength="60" value="${esc(slot ? slot.subject : store.get('subject') || '')}" required></label>
          <label class="field">เวลาเริ่มคาบ<input id="qd-start" type="time" value="${esc(start)}" required><span class="hint">คนที่เช็กชื่อหลังเวลานี้เกินที่กำหนดจะนับ "สาย"</span></label>
          <label class="field">ตรงเวลาภายใน (นาที)<input id="qd-on" type="number" min="0" max="120" value="${esc(cfg.onTimeMin ?? 10)}"></label>
          <label class="field">รับเช็กชื่อถึง (นาทีหลังเริ่ม)<input id="qd-late" type="number" min="5" max="240" value="${esc(cfg.lateMin ?? 30)}"><span class="hint">หลังจากนี้สแกนไม่ได้ ต้องให้ครูบันทึกให้</span></label>
          <label class="field">รูปแบบ QR<select id="qd-mode">
            <option value="image">รูปภาพ ส่งให้นักเรียนได้</option>
            <option value="rotate">ฉายหน้าจอ รหัสหมุนทุก 45 วินาที</option></select></label>
        </div>
        <p class="small muted" id="qd-hint">รูปภาพส่งต่อได้ จึงเหมาะกับการส่งใน LINE กลุ่มห้อง ${loginMode === 'pin' ? 'ระบบยังป้องกันด้วย PIN ของนักเรียนแต่ละคน และ ' : 'ระบบป้องกันด้วย '}1 เครื่อง = 1 คน (ติดธงถ้าซ้ำ) และหมดอายุตามเวลารับเช็กชื่อ</p>
        <div class="row end"><button class="btn" type="button" id="qd-cancel">ยกเลิก</button><button class="btn primary" type="submit">สร้าง QR</button></div>
      </form>`);
    $('#qd-cancel').addEventListener('click', close);
    const dateHint = () => {
      const v = $('#qd-date').value, h = $('#qd-dow');
      if (!v) { h.textContent = ''; return; }
      const d = dowOf(v);
      h.textContent = `วัน${DAYS[d]}ที่ ${thDate(v)}${v > todayStr() ? ' · สร้างไว้ล่วงหน้าได้ นักเรียนสแกนได้ตั้งแต่วันนั้น' : ''}${slot && d !== slot.day ? ` · ⚠ คาบนี้ในตารางสอนอยู่วัน${DAYS[slot.day]}` : ''}`;
    };
    $('#qd-date').addEventListener('input', dateHint); dateHint();
    $('#qd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const date = $('#qd-date').value;
      const body = {
        room: $('#qd-room').value, subject: $('#qd-subject').value, mode: $('#qd-mode').value,
        label: slot ? slotLabel(slot) : 'นอกตารางสอน ' + $('#qd-start').value + ' น.', classLabel: slot ? slot.classLabel : '',
        start: `${date} ${$('#qd-start').value}`, onTimeMin: Number($('#qd-on').value), lateMin: Number($('#qd-late').value)
      };
      if (!slot) store.set('subject', body.subject);
      await busy(ev.submitter, async () => {
        try {
          let r = await T('t_openSession', body);
          if (r.differs) {
            const o = r.session;
            if (!confirm(`ห้องนี้มีคาบที่เปิดอยู่แล้วในวันเดียวกัน (${o.subject || ''} ${o.label || ''})\nปิดคาบนั้น (บันทึกขาดให้คนที่ยังไม่เช็ก) แล้วสร้างคาบใหม่?`)) return;
            r = await T('t_openSession', { ...body, replace: true });
          }
          if (r.existing) toast('คาบนี้มี QR อยู่แล้ว แสดงอันเดิม');
          close(); refreshGrid();
          if (r.session.mode === 'image') showQrResult(r.session);
          else { setRoom(r.session.room); openTab('checkin'); toast('เปิดคาบแล้ว ฉาย QR ได้เลย'); }
        } catch (e) { fail(e); }
      });
    });
  }

  async function showQrResult(s) {
    let token;
    try { token = (await T('t_token', { sessionId: s.sessionId })).token; } catch (e) { fail(e); return; }
    const url = `${siteBase()}student.html?s=${encodeURIComponent(s.sessionId)}&t=${encodeURIComponent(token)}`;
    const canvas = await makeQrCanvas(s, url);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const fname = `QR-เช็กชื่อ_${(s.subject || 'คาบเรียน').replace(/[\\/:*?"<>|\s]+/g, '')}_${classText(s.classLabel).replace(/[./]/g, '-') || 'ห้อง' + s.room}_${s.date}_${(s.label.match(/คาบ\s*([\d–-]+)/) || [, 'x'])[1]}.png`;
    const file = new File([blob], fname, { type: 'image/png' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    const close = openModal(`
      <div class="row"><h2 class="grow" style="margin:0">QR พร้อมส่งให้นักเรียน</h2><button class="btn sm" id="qr-x" type="button">ปิด</button></div>
      <p class="small muted">บันทึกรูปนี้แล้วส่งใน LINE กลุ่มห้อง ใช้สแกนได้${s.date !== todayStr() ? ` ในวันที่ ${esc(thDate(s.date))}` : ''} ถึง ${esc(thTime(s.closeAt))} น. (ตรงเวลาถึง ${esc(thTime(s.onTimeUntil))} น.)</p>
      <img src="${URL.createObjectURL(blob)}" alt="QR Code เช็กชื่อ ${esc(s.subject)}" style="width:100%;max-width:440px;display:block;margin:0 auto 12px;border:1px solid var(--line);border-radius:12px">
      <div class="row">
        <button class="btn primary grow" id="qr-save" type="button">⬇ บันทึกรูป</button>
        ${canShare ? '<button class="btn grow" id="qr-share" type="button">↗ แชร์รูป (LINE ฯลฯ)</button>' : ''}
        <button class="btn grow" id="qr-copy" type="button">คัดลอกลิงก์</button>
        <button class="btn grow" id="qr-open" type="button">ดูรายชื่อ / ปิดคาบ</button></div>`);
    $('#qr-x').addEventListener('click', close);
    $('#qr-save').addEventListener('click', () => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fname });
      document.body.appendChild(a); a.click(); a.remove(); toast('บันทึกรูปแล้ว');
    });
    if (canShare) $('#qr-share').addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: 'เช็กชื่อเข้าเรียน', text: `สแกนเพื่อเช็กชื่อ ${s.subject} ถึง ${thTime(s.closeAt)} น.` }); } catch (e) { /* ยกเลิกการแชร์ */ }
    });
    $('#qr-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); toast('คัดลอกลิงก์แล้ว'); } catch (e) { prompt('คัดลอกลิงก์นี้', url); } });
    $('#qr-open').addEventListener('click', () => { close(); setRoom(s.room); openTab('checkin'); });
  }

  async function makeQrCanvas(s, url) {
    try { await Promise.all([document.fonts.load('700 60px Sarabun'), document.fonts.load('400 40px Sarabun')]); } catch (e) { /* ใช้ฟอนต์สำรอง */ }
    const W = 1080, H = 1700, FONT = 'Sarabun, "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d');
    const text = (t, y, size, weight, color) => {
      let px = size; g.font = `${weight} ${px}px ${FONT}`;
      while (g.measureText(t).width > W - 100 && px > 24) { px -= 2; g.font = `${weight} ${px}px ${FONT}`; }
      g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(t, W / 2, y);
    };
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3056d3'; g.fillRect(0, 0, W, 210);
    text('เช็กชื่อเข้าเรียน', 105, 84, 700, '#ffffff');
    text([appCfg.SCHOOL, appCfg.TEACHER].filter(Boolean).join(' · '), 170, 38, 400, '#dbe4ff');
    text(`${s.subject}${s.classLabel ? '  ' + classText(s.classLabel) : ''}`, 330, 92, 700, '#1c2434');
    text(`วัน${DAYS[dowOf(s.date)]}ที่ ${thDate(s.date)}`, 405, 46, 400, '#475467');
    text(s.label || '', 470, 46, 600, '#475467');
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), cell = Math.floor(780 / (n + 8)), size = cell * (n + 8), x0 = Math.round((W - size) / 2), y0 = 520;
    g.fillStyle = '#ffffff'; g.strokeStyle = '#d0d5dd'; g.lineWidth = 4;
    g.beginPath(); if (g.roundRect) g.roundRect(x0 - 16, y0 - 16, size + 32, size + 32, 28); else g.rect(x0 - 16, y0 - 16, size + 32, size + 32); g.fill(); g.stroke();
    g.fillStyle = '#000000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) g.fillRect(x0 + (col + 4) * cell, y0 + (r + 4) * cell, cell, cell);
    const yb = y0 + size + 90;
    text(`ตรงเวลาถึง ${thTime(s.onTimeUntil)} น. · รับเช็กชื่อถึง ${thTime(s.closeAt)} น.`, yb, 46, 700, '#12805c');
    text('สแกนด้วยกล้องโทรศัพท์ แล้วเข้าสู่ระบบด้วยเลขประจำตัว' + (loginMode === 'pin' ? ' + PIN' : ''), yb + 62, 36, 400, '#475467');
    text('ห้ามส่งรูปนี้ให้เพื่อนที่ไม่ได้อยู่ในห้องเรียน', yb + 112, 32, 400, '#c62d2d');
    try {
      const logo = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = siteBase() + 'img/logo.webp'; });
      g.save(); g.beginPath(); g.arc(W / 2, H - 100, 80, 0, Math.PI * 2); g.clip(); g.drawImage(logo, W / 2 - 80, H - 180, 160, 160); g.restore();
    } catch (e) { /* ไม่มีโลโก้ก็ยังใช้งานได้ */ }
    return c;
  }

  async function saveTimetable(slots, periods) {
    await T('t_saveTimetable', { periods: periods || tb.periods, slots });
    cfgVals = null; renderTimetable();
  }

  function openSlotDialog(i, preset) {
    const s = i === null ? { day: dowOf(todayStr()) > 5 ? 1 : dowOf(todayStr()), startPeriod: 1, endPeriod: 1, subject: '', classLabel: '', room: '', place: '', note: '', ...preset } : tb.slots[i];
    const pOpts = (sel) => tb.periods.map((p) => `<option value="${p.period}" ${p.period === sel ? 'selected' : ''}>คาบ ${p.period} (${esc(p.start)}–${esc(p.end)})</option>`).join('');
    const roomOpts = ['<option value="">— ไม่ใช่คาบสอนห้องเรียน (ประชุม/กิจกรรม) —</option>']
      .concat(rooms.map((r) => `<option value="${esc(r.room)}" ${r.room === s.room ? 'selected' : ''}>${esc(r.label)} (${r.count} คน)</option>`))
      .concat(s.room && !rooms.some((r) => r.room === s.room) ? [`<option value="${esc(s.room)}" selected>${esc(s.room)} (ยังไม่มีรายชื่อ ต้องนำเข้าก่อนสร้าง QR)</option>`] : []).join('');
    const close = openModal(`<h2>${i === null ? 'เพิ่มคาบสอน' : 'แก้ไขคาบสอน'}</h2>
      <form id="sd"><div class="grid cols-2">
        <label class="field">วัน<select id="sd-day">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${d === s.day ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select></label>
        <label class="field">วิชา / กิจกรรม<input id="sd-subject" type="text" maxlength="60" value="${esc(s.subject)}" required></label>
        <label class="field">คาบเริ่ม<select id="sd-a">${pOpts(s.startPeriod)}</select></label>
        <label class="field">คาบสุดท้าย<select id="sd-b">${pOpts(s.endPeriod)}</select></label>
        <label class="field">ชั้น/ห้อง ตามตารางสอน<input id="sd-class" type="text" maxlength="20" value="${esc(s.classLabel)}" placeholder="เช่น 4.2"></label>
        <label class="field">ใช้รายชื่อห้องไหนในระบบ<select id="sd-room">${roomOpts}</select></label>
        <label class="field">ห้องเรียน/สถานที่<input id="sd-place" type="text" maxlength="30" value="${esc(s.place)}" placeholder="เช่น 316"></label>
        <label class="field">หมายเหตุ<input id="sd-note" type="text" maxlength="60" value="${esc(s.note)}"></label></div>
        <div class="row end">${i !== null ? '<button class="btn danger" type="button" id="sd-del">ลบคาบนี้</button>' : ''}<span class="grow"></span><button class="btn" type="button" id="sd-cancel">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div></form>`);
    $('#sd-cancel').addEventListener('click', close);
    const delBtn = $('#sd-del');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('ลบคาบนี้ออกจากตารางสอน?')) return;
      try { await saveTimetable(tb.slots.filter((_, k) => k !== i)); close(); toast('ลบแล้ว'); } catch (e) { fail(e); }
    });
    $('#sd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const next = { day: Number($('#sd-day').value), startPeriod: Number($('#sd-a').value), endPeriod: Number($('#sd-b').value), subject: $('#sd-subject').value,
        classLabel: $('#sd-class').value, room: $('#sd-room').value, place: $('#sd-place').value, note: $('#sd-note').value };
      if (next.endPeriod < next.startPeriod) return toast('คาบสุดท้ายต้องไม่ก่อนคาบเริ่ม', true);
      const slots = tb.slots.slice();
      if (i === null) slots.push(next); else slots[i] = next;
      await busy(ev.submitter, async () => { try { await saveTimetable(slots); close(); toast('บันทึกตารางสอนแล้ว'); } catch (e) { fail(e); } });
    });
  }

  function openPeriodsDialog() {
    const close = openModal(`<h2>เวลาแต่ละคาบ</h2><p class="muted small">แก้เวลาให้ตรงกับโรงเรียน คาบที่สร้าง QR จะใช้เวลาเหล่านี้</p>
      <form id="pd"><div class="scroll" style="max-height:55vh"><table><thead><tr><th>คาบ</th><th>เริ่ม</th><th>เลิก</th></tr></thead><tbody>
      ${tb.periods.map((p) => `<tr><td>${p.period}</td><td><input type="time" data-p="${p.period}" data-k="start" value="${esc(p.start)}" required></td><td><input type="time" data-p="${p.period}" data-k="end" value="${esc(p.end)}" required></td></tr>`).join('')}
      </tbody></table></div><div class="row end" style="margin-top:12px"><button class="btn" type="button" id="pd-cancel">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div></form>`);
    $('#pd-cancel').addEventListener('click', close);
    $('#pd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const periods = tb.periods.map((p) => ({ period: p.period, start: $(`[data-p="${p.period}"][data-k=start]`).value, end: $(`[data-p="${p.period}"][data-k=end]`).value }));
      await busy(ev.submitter, async () => { try { await saveTimetable(tb.slots, periods); close(); toast('บันทึกเวลาคาบแล้ว'); } catch (e) { fail(e); } });
    });
  }

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
          <label class="field">วิชา<input id="as-subject" type="text" maxlength="60" list="as-subjects" placeholder="เช่น คณิตศาสตร์"><datalist id="as-subjects"></datalist></label>
          <label class="field">ชั้นเรียน (ขึ้นบนใบหลักฐาน)<input id="as-class" type="text" maxlength="20" placeholder="เช่น ม.4/2"></label>
          <label class="field" style="grid-column:1/-1">รายละเอียดใบงาน (นักเรียนเห็น และขึ้นบนใบหลักฐาน)<textarea id="as-desc" maxlength="600" placeholder="เช่น จงแก้สมการเชิงเส้นตัวแปรเดียว พร้อมแสดงวิธีทำอย่างละเอียด จำนวน 10 ข้อ"></textarea></label>
        </div><button class="btn primary" type="submit">สร้างงาน</button></form></div>
      <div class="card"><h2>งานทั้งหมด</h2><div id="as-list" class="muted">กำลังโหลด…</div></div>`;
    const fillDefaults = async () => {
      try { if (!tb) tb = await T('t_timetable', {}); } catch (e) { return; }
      const rm = $('#as-room').value, slots = tb.slots.filter((x) => x.room === rm);
      if (slots.length && !$('#as-class').value) $('#as-class').value = classText(slots[0].classLabel);
      $('#as-subjects').innerHTML = Array.from(new Set(slots.map((x) => x.subject))).map((x) => `<option value="${esc(x)}">`).join('');
      if (!$('#as-subject').value && slots.length === 1) $('#as-subject').value = slots[0].subject;
    };
    $('#as-room').addEventListener('change', (e) => { setRoom(e.target.value); $('#as-class').value = ''; $('#as-subject').value = ''; fillDefaults(); });
    fillDefaults();
    $('#as-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const due = $('#as-due').value;
      await busy(ev.submitter, async () => {
        try {
          await T('t_createAssignment', { room: $('#as-room').value, title: $('#as-title').value, maxScore: $('#as-max').value, due: due ? due.replace('T', ' ') + ':00' : '', description: $('#as-desc').value, subject: $('#as-subject').value, classLabel: $('#as-class').value });
          toast('สร้างงานแล้ว กด "คัดลอกลิงก์ส่งงาน" แล้วส่งให้นักเรียนได้เลย'); $('#as-title').value = ''; $('#as-desc').value = ''; loadAssignments();
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
        <button class="btn sm" data-link="${esc(a.assignmentId)}" type="button">คัดลอกลิงก์ส่งงาน</button>
        <button class="btn sm primary" data-review="${esc(a.assignmentId)}" data-room="${esc(a.room)}" type="button">ตรวจงาน</button>
        <button class="btn sm" data-toggle="${esc(a.assignmentId)}" data-to="${a.status === 'open' ? 'closed' : 'open'}" type="button">${a.status === 'open' ? 'ปิดรับ' : 'เปิดรับอีกครั้ง'}</button></div>`).join('') : 'ยังไม่มีงาน';
      $$('[data-link]', box).forEach((b) => b.addEventListener('click', async () => {
        const url = `${siteBase()}student.html?a=${encodeURIComponent(b.dataset.link)}`;
        try { await navigator.clipboard.writeText(url); toast('คัดลอกลิงก์ส่งงานแล้ว นำไปส่งใน LINE ได้เลย'); } catch (e) { prompt('คัดลอกลิงก์นี้', url); }
      }));
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
      <div class="grid cols-4" style="margin:10px 0">
        <div class="stat"><b>${list.length}</b><span>นักเรียนทั้งหมด</span></div>
        <div class="stat"><b>${list.length - cnt('missing')}</b><span>ส่งแล้ว</span></div>
        <div class="stat"><b>${cnt('missing')}</b><span>ยังไม่ส่ง</span></div>
        <div class="stat"><b>${cnt('pending')}</b><span>รอตรวจ</span></div></div>
      <div class="small muted">ความคืบหน้าการส่งงาน ${list.length ? Math.round((list.length - cnt('missing')) / list.length * 1000) / 10 : 0}%</div>
      <div class="bar" style="margin:4px 0 10px"><i style="width:${list.length ? (list.length - cnt('missing')) / list.length * 100 : 0}%"></i></div>
      <p class="row">${badge('pending', 'รอตรวจ ' + cnt('pending'))}${badge('done', 'ครบถ้วน ' + cnt('done'))}${badge('revise', 'ต้องแก้ไข ' + cnt('revise'))}${badge('none', 'ไม่ผ่าน ' + cnt('none'))}${badge('missing', 'ยังไม่ส่ง ' + cnt('missing'))}</p>
      <div class="scroll"><table><thead><tr><th>ชื่อ</th><th>สถานะ</th><th class="num">รูป</th><th class="num">คะแนน</th><th></th></tr></thead><tbody>${shown.map((s) => `<tr>
        <td>${esc(s.name)}<div class="small muted">${esc(s.studentId)}${s.submittedAt ? ' · ส่ง ' + esc(thDateTime(s.submittedAt)) : ''}${s.late ? ' · <b style="color:var(--bad)">ส่งช้า</b>' : ''}${s.round > 1 ? ' · รอบ ' + s.round : ''}</div></td>
        <td>${badge(s.status)}</td><td class="num">${s.count || ''}</td><td class="num">${s.score === null || s.status === 'missing' ? '' : fmtNum(s.score)}</td>
        <td>${s.count ? `<div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-open="${esc(s.studentId)}" type="button">ดูรูป</button><button class="btn sm" data-rc="${esc(s.studentId)}" type="button">ใบหลักฐาน</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#rv-only').addEventListener('change', (e) => { rv.onlyPending = e.target.checked; drawReview(); });
    $('#rv-start').addEventListener('click', () => openViewer(list.find((x) => x.status === 'pending').studentId, true));
    $$('[data-rc]', body).forEach((b) => b.addEventListener('click', () => openTeacherReceipt(b.dataset.rc)));
    $$('[data-open]', body).forEach((b) => b.addEventListener('click', () => openViewer(b.dataset.open, false)));
  }

  async function openTeacherReceipt(studentId) {
    try {
      const d = await T('t_receipt', { assignmentId: reviewSel, studentId });
      await Receipt.show(d, (dd, prog) => Receipt.imagesFromServer(dd.files, (fid) => T('t_image', { fileId: fid }), prog));
    } catch (e) { fail(e); }
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
      <div class="card"><div class="row"><h2 class="grow" style="margin:0">รายชื่อนักเรียน</h2><select id="st-room" style="width:auto">${roomOptions(ensureRoom())}</select></div><div id="st-list" class="muted" style="margin-top:10px">กำลังโหลด…</div></div>
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
      loginMode = r.loginMode || loginMode;
      const pinCols = loginMode === 'pin';
      box.innerHTML = r.students.length ? `<div class="scroll"><table><thead><tr><th>เลขประจำตัว (ใช้เข้าสู่ระบบ)</th><th>ชื่อ-สกุล</th>${pinCols ? '<th>PIN</th><th></th>' : ''}</tr></thead><tbody>${r.students.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td>${pinCols ? `<td>${s.hasPin ? badge('done', 'ตั้งแล้ว') : badge('none', 'ยังไม่ตั้ง')}</td><td>${s.hasPin ? `<button class="btn sm" data-rs="${esc(s.id)}" type="button">รีเซ็ต PIN</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : 'ยังไม่มีรายชื่อ';
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
    try { const r = await T('t_students', {}); rooms = r.rooms; loginMode = r.loginMode || loginMode; ensureRoom(); show('app'); openTab('timetable'); }
    catch (e) { show('login'); }
  })();
})();
