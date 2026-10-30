/* Service worker ของ NK EduTrack: ให้ติดตั้งเป็นแอปได้ และเปิดหน้าเว็บได้เร็วขึ้น
   ไม่แตะคำขอไปยัง API (script.google.com) เลย ข้อมูลจึงสดใหม่เสมอ */
const CACHE = 'nk-edutrack-v2';
const SHELL = ['./', 'index.html', 'student.html', 'teacher.html', 'verify.html', 'app.css', 'common.js', 'student.js', 'teacher.js', 'receipt.js', 'config.js',
  'vendor/qrcode.min.js', 'img/logo.webp', 'img/favicon.png', 'img/icon-192.png', 'manifest-student.webmanifest', 'manifest-teacher.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// เก็บแคชด้วยที่อยู่ที่ไม่มี ?query (กันรหัส QR/ลิงก์งานติดไปในแคช)
const keyOf = (url) => new Request(url.origin + url.pathname);

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(rej, 4000))]);
    if (res && res.ok && res.type === 'basic') cache.put(keyOf(url), res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(keyOf(url));
    return hit || fetch(req);
  }
}
async function cacheFirst(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(keyOf(url));
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type === 'basic') cache.put(keyOf(url), res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/\.(png|webp|jpg|jpeg|svg|ico)$/.test(url.pathname)) e.respondWith(cacheFirst(req, url));
  else e.respondWith(networkFirst(req, url));
});
