/* ตัวช่วยกลาง: เรียก API (Google Apps Script), เก็บค่าในเครื่อง, จัดรูปแบบวันที่ไทย */
(function () {
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

  const STATUS = {
    present: 'มาเรียน', late: 'มาสาย', absent: 'ขาด', leave: 'ลา', none: 'ยังไม่เช็ก', pending: 'รอตรวจ',
    done: 'ครบถ้วน', revise: 'ต้องแก้ไข', missing: 'ยังไม่ส่ง'
  };
  const badge = (s, text) => `<span class="badge ${esc(s)}">${esc(text || STATUS[s] || s)}</span>`;

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
    const label = btn.textContent;
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  };

  const fmtNum = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const siteBase = () => location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');

  // ───── แอปติดตั้งได้ (PWA) ─────
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* ใช้เว็บปกติต่อได้ */ }); });
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

  Object.assign(window, { $, $$, esc, store, uuid, deviceId, api, wait, thDate, thTime, thDateTime, todayStr, STATUS, badge, toast, busy, fmtNum, siteBase });
})();
