const { chromium } = require('playwright');
const crypto = require('crypto');
const OUT = 'c:/Users/606610/CodeBuddy/QRCode 客戶意見反饋/docs/assets';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000/api/v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, token) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function get(path, token) {
  const res = await fetch(API + path, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  return res.json();
}
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch();

  // ---------- Desktop context ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  // 1) Login page (before login)
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await wait(800);
  await page.screenshot({ path: `${OUT}/shot-01-login.png` });
  console.log('shot-01-login');

  // login
  await page.getByLabel('帳號').fill('admin');
  await page.getByLabel('密碼').fill('Admin@2026');
  await page.getByRole('button', { name: '登入' }).click();

  // handle possible forced password change
  await page.waitForURL('**/admin/cases', { timeout: 6000 }).catch(() => {});
  if (!page.url().includes('/admin/cases')) {
    const pwdCount = await page.locator('input[type=password]').count();
    if (pwdCount > 1) {
      console.log('forced password change detected, filling...');
      const pwds = page.locator('input[type=password]');
      const n = await pwds.count();
      for (let i = 0; i < n; i++) await pwds.nth(i).fill('Admin@2026');
      await page.getByRole('button', { name: /密碼|確認|更新|提交/ }).click();
      await page.waitForURL('**/admin/cases', { timeout: 8000 }).catch(() => {});
    }
  }
  await wait(1000);

  const token = await page.evaluate(() => localStorage.getItem('qr_admin_token'));
  if (!token) throw new Error('login failed: no token');

  // 2) ensure a QR link token (t) for CHNG, then create demo cases
  let t = null;
  try {
    const gen = await post('/qr/generate', { estateCode: 'CHNG' }, token);
    const content = gen?.data?.qrContent || '';
    const u = new URL(content.replace(/^https?:\/\/[^/]+/, 'http://x'));
    t = u.searchParams.get('t');
  } catch (e) { console.log('qr gen err', e.message); }
  if (!t) {
    const ov = await get('/qr/overview', token);
    const item = (ov?.data?.items || []).find((i) => i.estateCode === 'CHNG');
    if (item?.qrContent) { const u = new URL(item.qrContent.replace(/^https?:\/\/[^/]+/, 'http://x')); t = u.searchParams.get('t'); }
  }
  console.log('t =', t);

  // fetch form meta to get valid category codes / titles
  let meta = null;
  if (t) meta = (await get(`/form/meta?estate=CHNG&lang=zh-Hant&t=${t}`, null))?.data;
  const cats = (meta?.categories || []).map((c) => c.code);
  const titles = meta?.titles || ['先生', '女士', '小姐'];
  const samples = [
    { title: titles[0], name: '陳大文', email: 'chan.t.man@example.com', phone: '', categories: [cats[0] || 'FACILITY'], content: '大堂冷氣滴水導致地面濕滑，已有住戶險些跌倒，請盡快安排維修。' },
    { title: titles[1] || titles[0], name: '李美玲', email: 'lee.may@example.com', phone: '', categories: [cats[1] || cats[0] || 'CLEAN'], content: '垃圾房附近持續有異味，希望管理處加強清潔頻率並檢查渠管。' },
    { title: titles[2] || titles[0], name: '黃詠琪', email: '', phone: '+85291234567', categories: [cats[2] || cats[0] || 'SECURITY'], content: '夜間停車場照明不足，部分燈具損壞，存在安全隱患，盼盡快跟進。' },
  ];
  const caseIds = [];
  if (t) {
    for (const s of samples) {
      try {
        const ft = await post('/form/token', { estate: 'CHNG', t }, null);
        const formToken = ft?.data?.token;
        const payload = {
          estate: 'CHNG', title: s.title, name: s.name, email: s.email, phone: s.phone,
          incidentDate: today, incidentTime: '14:30',
          address: { block: 'A', floor: '12', unit: '3' },
          categories: s.categories, otherText: '', content: s.content,
          surveyConsent: true, formToken, lang: 'zh-Hant', t,
        };
        const r = await post('/feedback', payload, null);
        if (r?.data?.caseId) caseIds.push(r.data.caseId);
      } catch (e) { console.log('feedback err', e.message); }
    }
  }
  console.log('created cases', caseIds);

  // seed survey data so 問卷統計 page is not empty (CHNG cases already exist)
  try {
    const conn = require('c:/Users/606610/CodeBuddy/QRCode 客戶意見反饋/backend/src/db/connection');
    const sdb = conn.getDb();
    const hk = (d) => { const x = new Date(d.getTime() + 8 * 3600000); return x.toISOString().slice(0, 19).replace('T', ' '); };
    sdb.prepare("DELETE FROM satisfaction_survey WHERE case_id IN (SELECT case_id FROM `case` WHERE estate_code='CHNG')").run();
    const chng = sdb.prepare("SELECT case_id FROM `case` WHERE estate_code='CHNG' ORDER BY case_id DESC").all().map((r) => r.case_id);
    if (chng.length) {
      const samples = [
        { status: 'SUBMITTED', r: [5, 5, 5, 5], fb: '非常滿意，處理迅速專業。' },
        { status: 'SUBMITTED', r: [4, 4, 4, 3], fb: '整體滿意，尚算滿意。' },
        { status: 'SUBMITTED', r: [2, 1, 2, 2], fb: '回應太慢，問題仍未解決，失望。' },
        { status: 'SENT', r: [null, null, null, null], fb: null },
        { status: 'EXPIRED', r: [null, null, null, null], fb: null },
      ];
      const ins = sdb.prepare(
        "INSERT INTO satisfaction_survey (case_id, survey_token, lang, sent_at, expires_at, status, submitted_at, rating_overall, rating_response, rating_attitude, rating_resolution, feedback, is_low_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
      );
      sdb.prepare('BEGIN').run();
      samples.forEach((s, i) => {
        const at = hk(new Date(Date.now() - (i + 1) * 86400000));
        const exp = hk(new Date(Date.now() + 7 * 86400000));
        const low = s.status === 'SUBMITTED' && s.r.some((v) => v <= 2) ? 1 : 0;
        ins.run(chng[i % chng.length], crypto.randomBytes(24).toString('hex'), 'zh-Hant', at, exp, s.status, s.status === 'SUBMITTED' ? at : null, s.r[0], s.r[1], s.r[2], s.r[3], s.fb, low);
      });
      sdb.prepare('COMMIT').run();
      console.log('seeded surveys for CHNG:', chng.length, 'cases');
    }
  } catch (e) { console.log('survey seed err', e.message); }

  // 3) Dashboard
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' });
  await wait(2500);
  await page.screenshot({ path: `${OUT}/shot-02-dashboard.png` });
  console.log('shot-02-dashboard');

  // 4) Case list
  await page.goto(`${BASE}/admin/cases`, { waitUntil: 'networkidle' });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/shot-03-cases.png` });
  console.log('shot-03-cases');

  // 5) Case detail (first case link)
  try {
    if (caseIds.length) {
      await page.goto(`${BASE}/admin/cases/${encodeURIComponent(caseIds[0])}`, { waitUntil: 'networkidle' });
    } else {
      await page.locator('a[href^="/admin/cases/"]').first().click();
    }
    await wait(1500);
    await page.screenshot({ path: `${OUT}/shot-04-case-detail.png` });
    console.log('shot-04-case-detail');
  } catch (e) { console.log('detail err', e.message); }

  // 6) QR page
  await page.goto(`${BASE}/admin/qr`, { waitUntil: 'networkidle' });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/shot-05-qr.png` });
  console.log('shot-05-qr');

  // 6.5) Survey stats
  await page.goto(`${BASE}/admin/surveys`, { waitUntil: 'networkidle' });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/shot-08-survey-stats.png` });
  console.log('shot-08-survey-stats');

  await ctx.close();

  // ---------- Mobile context: resident form ----------
  if (t) {
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true,
    });
    const m = await mctx.newPage();
    await m.goto(`${BASE}/?estate=CHNG&t=${t}`, { waitUntil: 'networkidle' });
    await wait(1200);
    // fill fields (best-effort)
    try { const tl = m.getByLabel('稱謂'); await tl.click({ timeout: 3000 }); await m.getByRole('option').first().click({ timeout: 3000 }); } catch (e) { console.log('title fill err', e.message); }
    try { await m.getByLabel('姓名').fill('陳大文'); } catch (e) { console.log('name fill err', e.message); }
    try { await m.locator('input[type=email]').first().fill('success.demo@example.com'); } catch (e) { console.log('email fill err', e.message); }
    try { await m.locator('.MuiChip-clickable').first().click(); } catch (e) { console.log('chip err', e.message); }
    try { await m.locator('textarea').first().fill('大堂冷氣滴水導致地面濕滑，請盡快安排維修，謝謝。'); } catch (e) { console.log('content err', e.message); }
    try { await m.locator('input[type=date]').first().fill(today); } catch (e) { console.log('date err', e.message); }
    // toggle privacy consent via the underlying checkbox input
    try {
      const toggled = await m.evaluate(() => {
        const lbls = Array.from(document.querySelectorAll('.MuiFormControlLabel-root'));
        const priv = lbls.find((l) => l.textContent.includes('私隱'));
        if (!priv) return false;
        const inp = priv.querySelector('input');
        if (!inp) return false;
        inp.click();
        return true;
      });
      console.log('privacy toggled', toggled);
    } catch (e) { console.log('privacy err', e.message); }
    await wait(600);
    await m.screenshot({ path: `${OUT}/shot-06-mobile-form.png` });
    console.log('shot-06-mobile-form');
    // submit -> success page
    try {
      await m.locator('button[type=submit]').click();
      await m.waitForFunction(() => location.pathname === '/success', { timeout: 12000 });
      await wait(900);
      await m.screenshot({ path: `${OUT}/shot-07-mobile-success.png` });
      console.log('shot-07-mobile-success');
    } catch (e) {
      console.log('submit err', e.message);
      try {
        const errs = await m.evaluate(() => Array.from(document.querySelectorAll('.MuiFormHelperText-root, .MuiAlert-message')).map((x) => x.textContent).filter(Boolean));
        console.log('FORM ERRORS', JSON.stringify(errs));
      } catch (_) {}
      try { await m.screenshot({ path: `${OUT}/shot-07-debug-form.png` }); } catch (_) {}
    }
    await mctx.close();
  }

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
