const BASE = 'http://localhost:3000/api/v1';
async function j(method, path, body, token) {
  const opt = { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  if (token) opt.headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, opt);
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
}

async function buildXlsxBase64() {
  const ExcelJS = require('c:/Users/606610/CodeBuddy/QRCode 客戶意見反饋/backend/node_modules/exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('cases');
  ws.addRow(['屋苑', '事項類別', '優先級', '稱謂', '姓名', '電話', '電郵', '座', '樓層', '單位', '事發日期', '事發時間', '意見內容', '問卷同意']);
  ws.addRow(['CWC', 'MAINTENANCE', 'HIGH', '先生', '張三', '91234567', 'zhang@x.com', 'A', '12', '3', '2026-09-25', '10:00', '大堂燈管損壞', '否']);
  ws.addRow(['CWC', 'SECURITY', 'MEDIUM', '女士', '李四', '98765432', '', 'B', '5', '2', '2026-09-24', '', '保安巡邏頻率不足', '是']);
  ws.addRow(['CWC', 'MAINTENANCE', 'HIGH', '先生', '', '91234567', '', 'A', '1', '1', '2026-09-25', '', '缺姓名應失敗', '否']);
  ws.addRow(['不存在苑', 'MAINTENANCE', 'HIGH', '先生', '王五', '', '', '', '', '', '2026-09-25', '', '屋苑無效應失敗', '否']);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString('base64');
}

(async () => {
  const login = await j('POST', '/auth/login', { username: 'admin', password: 'Admin@2026' });
  if (login.json.code !== 0) { console.log('LOGIN FAIL', login); return; }
  const token = login.json.data.accessToken;

  // 1) 範本下載
  const tpl = await fetch(BASE + '/cases/import-template', { headers: { Authorization: `Bearer ${token}` } });
  console.log('template status', tpl.status, 'content-type', tpl.headers.get('content-type'));

  // 2) 匯入
  const b64 = await buildXlsxBase64();
  const imp = await j('POST', '/cases/import', { fileDataBase64: b64 }, token);
  console.log('import status', imp.status, 'code', imp.json.code);
  const d = imp.json.data || imp.json;
  console.log('total=', d.total, 'created=', d.created, 'failed=', d.failed);
  console.log('caseIds=', JSON.stringify(d.caseIds));
  if (d.errors && d.errors.length) {
    console.log('errors:');
    d.errors.forEach((e) => console.log('  第', e.row, '列:', e.error));
  }
  const okRow = d.created === 2 && d.failed === 2;
  console.log(okRow ? '匯入驗證通過（2 成功 / 2 失敗）' : '匯入驗證異常');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
