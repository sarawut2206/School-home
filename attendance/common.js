/* ตัวช่วยกลาง: เรียก API (Google Apps Script), เก็บค่าในเครื่อง, จัดรูปแบบวันที่ไทย */
(function () {
  const VERSION = '20261101e';
  // ถ้าสคริปต์พัง ให้ขึ้นแถบแดงบอกสาเหตุ (ไม่เงียบ) นักเรียนถ่ายภาพหน้าจอส่งครูได้
  const showFatal = (msg) => {
    if (document.getElementById('fatal-bar')) return;
    const d = document.createElement('div');
    d.id = 'fatal-bar'; d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:300;background:#b42318;color:#fff;padding:.6rem 1rem;font-size:.9rem;text-align:center';
    d.textContent = 'หน้าเว็บทำงานผิดพลาด: ' + String(msg).slice(0, 160) + ' · ลองรีเฟรช (Ctrl+F5) · เวอร์ชัน ' + VERSION;
    document.body && document.body.appendChild(d);
  };
  window.addEventListener('error', (e) => showFatal(e.message || 'error'));
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; if (r && r.code) return; showFatal((r && r.message) || r || 'promise'); });
  const cfg = window.APP_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, area = 'local') { try { return window[area + 'Storage'].getItem(k); } catch (e) { return null; } },
    set(k, v, area = 'local') { try { window[area + 'Storage'].setItem(k, v); } catch (e) { /* โหมดส่วนตัว */ } },
    del(k, area = 'local') { try { window[area + 'Storage'].removeItem(k); } catch (e) { /* ไม่เป็นไร */ } }
  };

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const deviceId = () => { let d = store.get('deviceId'); if (!d) { d = uuid(); store.set('deviceId', d); } return d; };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETRY = new Set(['BUSY', 'SERVER', 'NETWORK']);

  async function api(action, body = {}, opt = {}) {
    if (!cfg.API || /PASTE|วาง/.test(cfg.API)) {
      throw { code: 'NOT_CONFIGURED', message: 'ยังไม่ได้ตั้งค่าที่อยู่ระบบหลังบ้าน (attendance/config.js)' };
    }
    const tries = opt.tries ?? 3;
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(cfg.API, { method: 'POST', body: JSON.stringify({ action, ...body }), redirect: 'follow' });
        const data = await res.json();
        if (data.ok) return data;
        last = { code: data.error, message: data.message };
      } catch (e) {
        last = { code: 'NETWORK', message: 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' };
      }
      if (!RETRY.has(last.code) || i === tries - 1) break;
      await wait(1200 * (i + 1));
    }
    throw last;
  }

  const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const thDate = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)/);
    return m ? `${+m[3]} ${TH_MONTH[+m[2] - 1]} ${+m[1] + 543}` : '';
  };
  const thTime = (s) => { const m = String(s || '').match(/(\d\d:\d\d)/); return m ? m[1] : ''; };
  const thDateTime = (s) => (s ? `${thDate(s)} ${thTime(s)}` : '');
  const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  // ───── ไอคอน (เส้นบาง 24px สไตล์เดียวกันทั้งระบบ) ─────
  const IC = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="m17 11 2 2 4-4"/>',
    assign: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/>',
    review: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    circle: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    next: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    school: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5M22 10v6"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'
  };
  const icon = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${IC[name] || ''}</svg>`;
  // ใส่ไอคอนให้ <i data-ic="ชื่อ"></i> ที่เขียนไว้ใน HTML
  const hydrate = (root) => (root || document).querySelectorAll('i[data-ic]').forEach((el) => { el.outerHTML = icon(el.dataset.ic, el.className); });
  hydrate();

  const STATUS = {
    present: 'มาเรียน', late: 'มาสาย', absent: 'ขาด', leave: 'ลา', none: 'ยังไม่เช็ก', pending: 'รอตรวจ',
    done: 'ครบถ้วน', revise: 'ต้องแก้ไข', missing: 'ยังไม่ส่ง'
  };
  const BADGE_IC = { present: 'checkCircle', done: 'checkCircle', late: 'clock', pending: 'clock', absent: 'xCircle', missing: 'xCircle', none: 'circle', leave: 'info', revise: 'edit' };
  const badge = (s, text) => `<span class="badge ${esc(s)}">${BADGE_IC[s] ? icon(BADGE_IC[s]) : ''}${esc(text || STATUS[s] || s)}</span>`;

  let toastTimer;
  function toast(msg, bad) {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), bad ? 6000 : 3200);
  }

  const busy = async (btn, fn) => {
    if (!btn) return fn();
    const label = btn.innerHTML;
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
  };

  const fmtNum = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const siteBase = () => location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');

  // ───── ปรับขนาดตัวอักษรเอง (Aa): ปกติ → ใหญ่ → ใหญ่มาก จำค่าไว้ในเครื่อง ─────
  (function fontSize() {
    const LV = [1, 1.15, 1.3], root = document.documentElement;
    const apply = (i) => { root.style.setProperty('--fs', LV[i]); };
    let i = Math.min(LV.length - 1, Math.max(0, Number(store.get('fs')) || 0));
    apply(i);
    const bar = document.querySelector('.top .wrap');
    if (!bar) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm fsbtn';
    const label = () => { b.innerHTML = 'A<small>a</small>' + ['', '+', '++'][i]; b.setAttribute('aria-label', 'ขนาดตัวอักษร ' + ['ปกติ', 'ใหญ่', 'ใหญ่มาก'][i] + ' (กดเพื่อเปลี่ยน)'); b.title = 'ขนาดตัวอักษร'; };
    label();
    b.addEventListener('click', () => { i = (i + 1) % LV.length; store.set('fs', String(i)); apply(i); label(); });
    bar.insertBefore(b, bar.querySelector('#install-app') || bar.querySelector('#logout'));   // ไม่มีทั้งสองปุ่ม → วางท้ายแถบ
  })();

  // ───── แอปติดตั้งได้ (PWA) ─────
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { /* ใช้เว็บปกติต่อได้ */ }); });
  }
  (function installButton() {
    const btn = document.getElementById('install-app');
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!btn || standalone) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.classList.remove('hidden'); });
    window.addEventListener('appinstalled', () => { deferred = null; btn.classList.add('hidden'); });
    if (ios) btn.classList.remove('hidden');
    btn.addEventListener('click', async () => {
      if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* ปิดหน้าต่างเฉยๆ */ } deferred = null; btn.classList.add('hidden'); }
      else alert(ios ? 'ติดตั้งบน iPhone/iPad:\n1) แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ที่แถบล่างของ Safari\n2) เลือก "เพิ่มไปยังหน้าจอโฮม"\n3) กด "เพิ่ม"' : 'เปิดเมนูของเบราว์เซอร์ (⋮) แล้วเลือก "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"');
    });
  })();

  const ver = document.createElement('p');
  ver.className = 'small muted center'; ver.style.cssText = 'margin:1.5rem 0 5.5rem;opacity:.7'; ver.textContent = 'NK EduTrack · เวอร์ชัน ' + VERSION;
  (document.querySelector('main') || document.body).appendChild(ver);

  Object.assign(window, { $, $$, esc, store, uuid, deviceId, api, wait, thDate, thTime, thDateTime, todayStr, STATUS, badge, toast, busy, fmtNum, siteBase, icon, hydrate });
})();
