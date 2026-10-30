/* ใบหลักฐานการส่งงาน A4: วาดด้วย canvas → บันทึกเป็นรูป PNG / PDF / แชร์ */
(function () {
  const W = 1240, H = 1754, M = 64, CW = W - M * 2;           // A4 ที่ 150 dpi
  const FONT = 'Sarabun, "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
  const NAVY = '#0b2a63', BLUE = '#3056d3', INK = '#0f172a', GRAY = '#64748b', LINE = '#e2e8f0', GREEN = '#15803d', AMBER = '#b45309';
  const seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  const imgCache = new Map();

  const classText = (c) => { const m = String(c || '').match(/^(\d+)[./](\d+)$/); return m ? `ม.${m[1]}/${m[2]}` : String(c || ''); };
  const thDateSlash = (s) => { const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? `${m[3]}/${m[2]}/${+m[1] + 543}` : ''; };
  const thDateShort = (s) => (typeof thDate === 'function' ? thDate(s) : s);
  const timeFull = (s) => { const m = String(s || '').match(/(\d\d:\d\d:\d\d)/); return m ? m[1] : ''; };

  function font(g, size, weight) { g.font = `${weight || 400} ${size}px ${FONT}`; }
  function text(g, t, x, y, o) {
    o = o || {}; let size = o.size || 28; font(g, size, o.weight);
    if (o.maxW) while (g.measureText(t).width > o.maxW && size > 14) { size -= 1; font(g, size, o.weight); }
    g.fillStyle = o.color || INK; g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic';
    if (o.spacing && 'letterSpacing' in g) g.letterSpacing = o.spacing + 'px';
    g.fillText(t, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  }
  function wrap(g, t, maxW, maxLines) {
    const words = seg ? Array.from(seg.segment(String(t)), (s) => s.segment) : Array.from(String(t));
    const lines = []; let cur = '';
    for (const w of words) {
      if (w === '\n') { lines.push(cur); cur = ''; continue; }
      if (!cur || g.measureText(cur + w).width <= maxW) cur += w; else { lines.push(cur.trimEnd()); cur = w.trimStart(); }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines.length = maxLines; let l = lines[maxLines - 1];
      while (g.measureText(l + '…').width > maxW && l.length > 1) l = l.slice(0, -1);
      lines[maxLines - 1] = l + '…';
    }
    return lines;
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  function pill(g, label, cx, cy, bg, fg, size) {
    font(g, size, 700); const w = g.measureText(label).width + 44, h = size + 22;
    g.fillStyle = bg; rrect(g, cx - w / 2, cy - h / 2, w, h, h / 2); g.fill();
    text(g, label, cx, cy + size * 0.35, { size, weight: 700, color: fg, align: 'center' });
  }
  function section(g, y, no, title, right) {
    text(g, `${no} | ${title}`, M, y, { size: 30, weight: 700, color: NAVY });
    if (right) text(g, right, W - M, y, { size: 20, color: GRAY, align: 'right', spacing: 1 });
    g.fillStyle = LINE; g.fillRect(M, y + 14, CW, 2);
  }
  function fields(g, y, items, cols, weights) {
    const w = weights || items.map(() => 1), tot = w.reduce((p, q) => p + q, 0);
    let x = M;
    items.forEach((f, i) => {
      const cw = CW * w[i] / tot;
      text(g, f[0], x, y, { size: 20, color: GRAY });
      text(g, f[1] || '–', x, y + 38, { size: 32, weight: 700, maxW: cw - 20 });
      x += cw;
    });
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = src; });
  }

  async function render(data, images) {
    try { await Promise.all([document.fonts.load('700 40px Sarabun'), document.fonts.load('400 28px Sarabun')]); } catch (e) { /* ใช้ฟอนต์สำรอง */ }
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d');
    const { receipt: rc, assignment: a, student: s } = data;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);

    // หัวกระดาษ
    g.fillStyle = NAVY; g.fillRect(0, 0, W, 232);
    try {
      const logo = await loadImage((typeof siteBase === 'function' ? siteBase() : '') + 'img/logo.webp');
      g.save(); g.beginPath(); g.arc(M + 88, 116, 84, 0, Math.PI * 2); g.clip(); g.drawImage(logo, M + 4, 32, 168, 168); g.restore();
    } catch (e) { /* ไม่มีโลโก้ก็ยังใช้ได้ */ }
    const hx = W / 2 + 70;
    text(g, 'NK EduTrack', hx, 82, { size: 62, weight: 700, color: '#ffffff', align: 'center' });
    text(g, 'STUDENT ASSIGNMENT SUBMISSION', hx, 118, { size: 22, color: '#9db8f2', align: 'center', spacing: 4 });
    text(g, 'ใบหลักฐานการส่งงาน', hx, 176, { size: 52, weight: 700, color: '#ffffff', align: 'center' });
    pill(g, rc.late ? 'SUBMITTED • ส่งช้ากว่ากำหนด' : 'SUBMITTED • ส่งงานสำเร็จ', hx, 210, rc.late ? '#b45309' : '#15803d', '#ffffff', 22);

    // 01 ข้อมูลการส่งงาน
    let y = 280;
    section(g, y, '01', 'ข้อมูลการส่งงาน', 'ASSIGNMENT DETAILS');
    y += 62;
    font(g, 44, 700);
    const tl = wrap(g, a.title, CW, 2);
    tl.forEach((l) => { text(g, l, M, y + 30, { size: 44, weight: 700 }); y += 54; });
    if (a.description) {
      y += 8; text(g, 'รายละเอียดใบงาน', M, y + 14, { size: 20, color: GRAY }); y += 22;
      font(g, 27, 400);
      wrap(g, a.description, CW, 3).forEach((l) => { text(g, l, M, y + 26, { size: 27, color: '#1e293b' }); y += 36; });
    }
    y += 36;
    fields(g, y + 10, [['รายวิชา', a.subject], ['ชั้นเรียน', classText(a.classLabel)], ['กำหนดส่ง', a.due ? thDateShort(a.due) : 'ไม่กำหนด'], ['คะแนนเต็ม', `${a.maxScore} คะแนน`]], 4, [1.3, 0.8, 1, 0.9]);
    y += 104;

    // 02 ข้อมูลนักเรียน
    section(g, y + 30, '02', 'ข้อมูลนักเรียน');
    y += 62;
    const sf = [['ชื่อ-นามสกุล', s.name], ['รหัสนักเรียน', s.id], ['ชั้น/ห้อง', classText(a.classLabel)]];
    if (s.no !== '') sf.push(['เลขที่', String(s.no)]);
    fields(g, y + 36, sf, 4, s.no !== '' ? [2.2, 1, 1, 0.6] : [2.2, 1, 1]);
    y += 118;

    // 03 ภาพหลักฐาน
    const footerH = 64, bottomH = 262, bottomY = H - footerH - 22 - bottomH;
    section(g, y + 30, '03', 'ภาพหลักฐานงานที่ส่ง', 'SUBMITTED EVIDENCE');
    const areaTop = y + 56, areaBottom = bottomY - 66, n = images.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.max(1, Math.ceil(n / cols)), gap = 18, cap = 34;
    const cw = (CW - gap * (cols - 1)) / cols, ch = (areaBottom - areaTop - gap * (rows - 1)) / rows;
    images.forEach((im, i) => {
      const x = M + (i % cols) * (cw + gap), yy = areaTop + Math.floor(i / cols) * (ch + gap), ih = ch - cap;
      g.fillStyle = '#f1f5f9'; rrect(g, x, yy, cw, ih, 14); g.fill();
      g.save(); rrect(g, x, yy, cw, ih, 14); g.clip();
      const k = Math.min(cw / im.naturalWidth, ih / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      g.drawImage(im, x + (cw - dw) / 2, yy + (ih - dh) / 2, dw, dh);
      g.restore();
      g.strokeStyle = LINE; g.lineWidth = 2; rrect(g, x, yy, cw, ih, 14); g.stroke();
      text(g, `ภาพที่ ${i + 1}`, x + cw / 2, yy + ih + 26, { size: 21, color: GRAY, align: 'center' });
    });
    text(g, `จำนวนไฟล์ที่ส่ง: ${rc.count} ภาพ${rc.round > 1 ? ' · ส่งครั้งที่ ' + rc.round : ''}`, M, bottomY - 30, { size: 21, color: GRAY });

    // 04 ข้อมูลยืนยันการส่ง (ซ้าย) | 05 การตรวจสอบหลักฐาน (ขวา)
    const lw = 640;
    text(g, '04 | ข้อมูลยืนยันการส่ง', M, bottomY + 26, { size: 30, weight: 700, color: NAVY });
    g.fillStyle = LINE; g.fillRect(M, bottomY + 40, lw, 2);
    text(g, 'วัน/เวลาที่ส่ง (เวลาจากเซิร์ฟเวอร์)', M, bottomY + 78, { size: 20, color: GRAY });
    text(g, thDateSlash(rc.submittedAt), M + lw, bottomY + 78, { size: 28, weight: 700, align: 'right' });
    text(g, `${timeFull(rc.submittedAt)} น.`, M, bottomY + 136, { size: 58, weight: 700, color: rc.late ? AMBER : GREEN });
    text(g, 'Submission ID', M, bottomY + 176, { size: 20, color: GRAY });
    text(g, rc.receiptId, M + lw, bottomY + 176, { size: 32, weight: 700, align: 'right' });
    text(g, 'สถานะ', M, bottomY + 226, { size: 20, color: GRAY });
    let px = M + lw;
    if (rc.round > 1) { font(g, 22, 700); const w = g.measureText(`ครั้งที่ ${rc.round}`).width + 40; pill(g, `ครั้งที่ ${rc.round}`, px - w / 2, bottomY + 220, '#e0e7ff', '#3730a3', 22); px -= w + 12; }
    if (rc.late) { font(g, 22, 700); const w = g.measureText('ส่งช้า').width + 40; pill(g, 'ส่งช้า', px - w / 2, bottomY + 220, '#fef3c7', AMBER, 22); px -= w + 12; }
    font(g, 22, 700); const sw = g.measureText('ระบบรับงานแล้ว').width + 40;
    pill(g, 'ระบบรับงานแล้ว', px - sw / 2, bottomY + 220, '#dcfce7', GREEN, 22);

    const rx = M + lw + 56, rw = CW - lw - 56;
    text(g, '05 | การตรวจสอบหลักฐาน', rx, bottomY + 26, { size: 30, weight: 700, color: NAVY });
    g.fillStyle = LINE; g.fillRect(rx, bottomY + 40, rw, 2);
    const verifyUrl = `${typeof siteBase === 'function' ? siteBase() : ''}verify.html?r=${encodeURIComponent(rc.receiptId)}&k=${encodeURIComponent(rc.key)}`;
    const q = qrcode(0, 'M'); q.addData(verifyUrl); q.make();
    const n2 = q.getModuleCount(), cell = Math.floor(176 / (n2 + 4)), qs = cell * (n2 + 4), qx = rx, qy = bottomY + 62;
    g.fillStyle = '#ffffff'; g.fillRect(qx, qy, qs, qs); g.fillStyle = '#000000';
    for (let r = 0; r < n2; r++) for (let k = 0; k < n2; k++) if (q.isDark(r, k)) g.fillRect(qx + (k + 2) * cell, qy + (r + 2) * cell, cell, cell);
    g.strokeStyle = LINE; g.lineWidth = 2; g.strokeRect(qx, qy, qs, qs);
    const tx = rx + qs + 22, tw = rw - qs - 22;
    text(g, 'QR Verify · NK EduTrack', tx, qy + 30, { size: 26, weight: 700, maxW: tw });
    font(g, 21, 400);
    let ty = qy + 66;
    wrap(g, 'สแกนเพื่อตรวจสอบข้อมูลการส่งงานกับระบบ หลักฐานนี้ยืนยันการรับไฟล์ ไม่ใช่การรับรองคะแนนหรือความถูกต้องของงาน', tw, 6).forEach((l) => { text(g, l, tx, ty, { size: 21, color: GRAY }); ty += 29; });

    // ท้ายกระดาษ
    g.fillStyle = NAVY; g.fillRect(0, H - footerH, W, footerH);
    text(g, 'NK EduTrack • DIGITAL SUBMISSION RECEIPT', W / 2, H - footerH + 28, { size: 22, weight: 700, color: '#ffffff', align: 'center', spacing: 1 });
    text(g, 'ระบบบริหารจัดการการเข้าเรียนและการส่งงานนักเรียน', W / 2, H - footerH + 54, { size: 18, color: '#9db8f2', align: 'center' });
    return c;
  }

  // PDF 1 หน้า A4 ที่ฝังรูป JPEG ของใบหลักฐาน (เขียนเองไม่ต้องใช้ไลบรารี)
  async function toPdf(canvas) {
    const jpg = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92))).arrayBuffer());
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offs[4] = len; push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg); push('\nendstream\nendobj\n');
    const content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xref = len;
    let x = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  function download(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // แสดงหน้าต่างใบหลักฐาน: getImages(data) ต้องคืนอาร์เรย์ของ HTMLImageElement ตามลำดับรูป
  async function show(data, getImages) {
    const root = document.createElement('div');
    root.className = 'modal'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="panel"><p class="center muted" id="rcp-status">กำลังสร้างใบหลักฐาน…</p></div>';
    document.body.appendChild(root);
    const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    const panel = root.firstChild;
    try {
      const images = await getImages(data, (done, total) => { const el = panel.querySelector('#rcp-status'); if (el) el.textContent = `กำลังโหลดรูป ${done}/${total}…`; });
      const canvas = await render(data, images);
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const name = data.receipt.receiptId;
      const file = new File([png], name + '.png', { type: 'image/png' });
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      panel.innerHTML = `
        <div class="row"><div class="grow"><h2 style="margin:0">${icon('file')}ใบหลักฐานการส่งงาน</h2><div class="small muted">${esc(name)} · ครั้งที่ ${data.receipt.round}</div></div><button class="btn sm" id="rcp-x" type="button">ปิด</button></div>
        <img src="${URL.createObjectURL(png)}" alt="ใบหลักฐานการส่งงาน ${esc(name)}" style="width:100%;max-width:520px;display:block;margin:12px auto;border:1px solid var(--line);border-radius:8px;background:#fff">
        <div class="row" style="position:sticky;bottom:-18px;background:var(--card);padding:10px 0">
          <button class="btn primary grow" id="rcp-png" type="button">${icon('download')} บันทึกเป็นรูป</button>
          <button class="btn grow" id="rcp-pdf" type="button">${icon('file')} บันทึกเป็น PDF</button>
          ${canShare ? '<button class="btn grow" id="rcp-share" type="button">' + icon('share') + ' แชร์</button>' : ''}</div>`;
      panel.querySelector('#rcp-x').addEventListener('click', close);
      panel.querySelector('#rcp-png').addEventListener('click', () => { download(png, name + '.png'); toast('บันทึกรูปแล้ว'); });
      panel.querySelector('#rcp-pdf').addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { download(await toPdf(canvas), name + '.pdf'); toast('บันทึก PDF แล้ว'); } finally { e.currentTarget.disabled = false; } });
      if (canShare) panel.querySelector('#rcp-share').addEventListener('click', async () => { try { await navigator.share({ files: [file], title: 'ใบหลักฐานการส่งงาน ' + name }); } catch (e) { /* ยกเลิกแชร์ */ } });
      return { canvas, close };
    } catch (e) {
      panel.innerHTML = `<p class="center">สร้างใบหลักฐานไม่สำเร็จ: ${esc(e.message || 'เกิดข้อผิดพลาด')}</p><div class="row end"><button class="btn" id="rcp-x" type="button">ปิด</button></div>`;
      panel.querySelector('#rcp-x').addEventListener('click', close);
      return null;
    }
  }

  // โหลดรูปจากเซิร์ฟเวอร์เป็น HTMLImageElement (ใช้ fetchFn(fileId) → {mime, data})
  async function imagesFromServer(ids, fetchFn, onProgress) {
    const out = new Array(ids.length); let done = 0, next = 0;
    async function worker() {
      while (next < ids.length) {
        const i = next++;
        let src = imgCache.get(ids[i]);
        if (!src) { const r = await fetchFn(ids[i]); src = `data:${r.mime};base64,${r.data}`; imgCache.set(ids[i], src); }
        out[i] = await loadImage(src); onProgress && onProgress(++done, ids.length);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return out;
  }

  window.Receipt = { render, toPdf, show, loadImage, imagesFromServer };
})();
