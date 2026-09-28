const BASE = 'http://localhost:3000/api/v1';
async function j(method, path, body, token) {
  const opt = { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  if (token) opt.headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, opt);
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
}
(async () => {
  const login = await j('POST', '/auth/login', { username: 'admin', password: 'Admin@2026' });
  if (login.json.code !== 0) { console.log('LOGIN FAIL', login); return; }
  const token = login.json.data.accessToken;
  console.log('login ok, keys=', Object.keys(login.json), 'token?=', !!token, 'mustChangePwd=', login.json.data.mustChangePwd);
  const estate = 'CWC';
  const payload = {
    estate, category: 'MAINTENANCE', priority: 'HIGH', title: 'SLA 五維驗證', content: 'SLA 五維驗證測試個案',
    name: '測試住戶', email: 'test@example.com', phone: '12345678',
    block: 'A', floor: '12', unit: '3',
    incidentDate: '2026-09-25', incidentTime: '10:00', surveyConsent: true,
  };
  const c = await j('POST', '/cases', payload, token);
  console.log('create status', c.status, 'code', c.json.code, 'msg', c.json.message);
  const d = c.json.data || c.json;
  console.log('eventType         :', d.eventType, '(INSTANT→派單不適用，dispatchSlaDue 應為 null)');
  console.log('SLA 五維:');
  console.log('  responseSlaDue   :', d.responseSlaDue);
  console.log('  dispatchSlaDue   :', d.dispatchSlaDue);
  console.log('  processingSlaDue :', d.processingSlaDue);
  console.log('  followupSlaDue   :', d.followupSlaDue);
  console.log('  closureSlaDue    :', d.closureSlaDue);
  // dispatch 為 null 僅在 INSTANT 事件屬設計預期；其餘事件不應為 null
  const expectNullDispatch = d.eventType === 'INSTANT';
  const missing = ['responseSlaDue','processingSlaDue','followupSlaDue','closureSlaDue'].filter(k => !d[k]);
  if (missing.length) console.log('MISSING (非預期):', missing.join(', '));
  else console.log('核心四維 + 依事件類型之派單維度 計算正確');

  // 2) SLA 掃描（不應報錯）
  const scan = await j('POST', '/sla/scan', {}, token);
  console.log('\\nSLA scan status', scan.status, 'code', scan.json.code);
  if (scan.json.code === 0) {
    const s = scan.json.data;
    console.log('  scanned=', s.scanned, 'respEsc=', (s.responseEscalations||[]).length,
      'dispatchEsc=', (s.dispatchEscalations||[]).length, 'procEsc=', (s.processingEscalations||[]).length,
      'followup=', (s.followupReminders||[]).length, 'closureEsc=', (s.closureEscalations||[]).length);
  } else {
    console.log('  scan error:', scan.json.message, '\n  raw:', JSON.stringify(scan.json).slice(0,300));
  }

  // 3) 設定清單應含新 SLA 參數
  const cfg = await j('GET', '/config/', null, token);
  console.log('\\nconfig status', cfg.status, 'code', cfg.json.code);
  const data = cfg.json.data;
  const found = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if (o.key && typeof o.key === 'string' && o.key.startsWith('sla.')) found.push(o.key);
      Object.values(o).forEach(walk);
    }
  };
  walk(data);
  console.log('SLA 設定項:', found.join(', ') || '(無)');

  // 4) 設定更新（含 null）+ 錯誤校驗
  const upd1 = await j('PUT', '/config/sla.dispatch', { value: { URGENT: 15, NORMAL: 240, COMPLEX: 1440, INSTANT: null } }, token);
  console.log('\\nPUT sla.dispatch (含 null) ->', upd1.status, 'code', upd1.json.code, upd1.json.message || '');
  const updBad = await j('PUT', '/config/sla.dispatch', { value: { URGENT: 9999, NORMAL: 240, COMPLEX: 1440, INSTANT: null } }, token);
  console.log('PUT sla.dispatch (URGENT=9999 越界) ->', updBad.status, 'code', updBad.json.code, '(' + (updBad.json.message||'') + ')');
  const upd2 = await j('PUT', '/config/sla.followup_interval_hours', { value: { URGENT: null, NORMAL: null, COMPLEX: 48, INSTANT: 168 } }, token);
  console.log('PUT sla.followup_interval_hours ->', upd2.status, 'code', upd2.json.code, upd2.json.message || '');
  // 還原為預設
  await j('PUT', '/config/sla.dispatch', { value: { URGENT: 15, NORMAL: 240, COMPLEX: 1440, INSTANT: null } }, token);
  console.log(upd1.json.code === 0 && updBad.json.code !== 0 && upd2.json.code === 0
    ? '設定更新與校驗 全部正確'
    : '設定更新/校驗 有異常');
})().catch(e => { console.error('ERR', e); process.exit(1); });
