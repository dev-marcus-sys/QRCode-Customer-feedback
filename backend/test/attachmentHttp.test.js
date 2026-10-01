/**
 * 附件管理（HTTP 層測試，supertest，不含 AI）。
 * 聚焦路由層難以在 service 層覆蓋的點：
 *  - 鑑權（401）、權限（case:update 缺失 → 403）
 *  - 跨屋苑下載（DATA_SCOPE → 403）
 *  - 本次修正核心回歸：caseId 含「/」時以 %2F 編碼的 DELETE 附件請求可正常匹配（修復 404）
 *  - 下載回檔（Content-Disposition / 200）
 */
'use strict';
const path = require('path');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');

const tmp = path.join(__dirname, `._att_${Date.now()}_${Math.floor(Math.random() * 1e6)}.db`);
process.env.DB_PATH = tmp;
const upTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'att-upload-'));
process.env.UPLOAD_DIR = upTmp;

let app;
let db;
let staffToken; // chng_staff：CHNG 屋苑，擁有 case:update / case:view
let ccSupToken;  // cc_sup：有 case:view/assign/review 但【無】case:update → 用於 403
let yprSupToken; // ypr_sup：YPR 屋苑 → 用於跨屋苑 403

function login(username, password) {
  return request(app).post('/api/v1/auth/login').send({ username, password }).expect(200);
}

let slashSeq = 0;
/** 直接插入一筆「可操作」(CHNG / ASSIGNED) 且編號含斜線的個案，回傳其 caseId */
function insertSlashCase() {
  slashSeq += 1;
  const caseId = `SMS/SR/CHNG/260928${String(slashSeq).padStart(3, '0')}`;
  db.prepare(
    `INSERT INTO \`case\` (case_id, case_status, event_type, priority, intent_type, category_code,
       estate_code, customer_title, customer_name, customer_email, incident_date, comment_content,
       satisfaction_consent, assigned_to, response_sla_due, closure_sla_due, created_at, updated_at)
     VALUES (?, 'ASSIGNED', 'NORMAL', 'HIGH', 'COMPLAINT', 'SECURITY', 'CHNG', '陳', '小明', 'cust@example.com',
       '2026-09-01', '測試意見內容', 1, (SELECT user_id FROM sys_user WHERE username='chng_staff'),
       NULL, '2026-09-08 00:00:00', datetime('now'), datetime('now'))`
  ).run(caseId);
  return caseId;
}

/** 以 chng_staff 上傳一筆附件，回傳 { caseId, attachmentId } */
async function uploadViaApi(caseId) {
  const up = await request(app)
    .post(`/api/v1/cases/${encodeURIComponent(caseId)}/attachments`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ fileName: 'proof.png', fileDataBase64: Buffer.from([7, 7, 7]).toString('base64') })
    .expect(201);
  return { caseId, attachmentId: up.body.data.attachmentId };
}

test.before(async () => {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  db = initDatabase();
  app = createApp();
  const tokens = await Promise.all([
    login('chng_staff', 'ChngSt@2026').then((r) => r.body.data.accessToken),
    login('cc_sup', 'CcSup@2026').then((r) => r.body.data.accessToken),
    login('ypr_sup', 'YprSup@2026').then((r) => r.body.data.accessToken),
  ]);
  staffToken = tokens[0];
  ccSupToken = tokens[1];
  yprSupToken = tokens[2];
});

test.after(() => {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  fs.rmSync(upTmp, { recursive: true, force: true });
});

test('鑑權：未帶 token 取詳情 / 刪附件 → 401', async () => {
  const id = insertSlashCase();
  await request(app).get(`/api/v1/cases/${encodeURIComponent(id)}`).expect(401);
  await request(app).delete(`/api/v1/cases/${encodeURIComponent(id)}/attachments/1`).expect(401);
});

test('權限：cc_sup 缺 case:update，上傳 / 刪附件 → 403', async () => {
  const id = insertSlashCase();
  await request(app)
    .post(`/api/v1/cases/${encodeURIComponent(id)}/attachments`)
    .set('Authorization', `Bearer ${ccSupToken}`)
    .send({ fileName: 'a.png', fileDataBase64: Buffer.from([1, 2, 3]).toString('base64') })
    .expect(403);
  await request(app)
    .delete(`/api/v1/cases/${encodeURIComponent(id)}/attachments/1`)
    .set('Authorization', `Bearer ${ccSupToken}`)
    .expect(403);
});

test('回歸：含斜線 caseId 的 DELETE 附件（%2F 編碼）可正常匹配（修復 404）', async () => {
  const { caseId, attachmentId } = await uploadViaApi(insertSlashCase());
  // 含 %2F 的 DELETE 請求必須命中路由（本次修正核心）
  const del = await request(app)
    .delete(`/api/v1/cases/${encodeURIComponent(caseId)}/attachments/${attachmentId}`)
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(200);
  assert.equal(del.body.code, 0);
  // 詳情時間軸不再掛載該附件
  const det = await request(app)
    .get(`/api/v1/cases/${encodeURIComponent(caseId)}`)
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(200);
  assert.ok(!det.body.data.timeline.some((t) => t.attachmentId === attachmentId));
});

test('下載：上傳者(chng_staff)可下載；跨屋苑(ypr_sup) → 403', async () => {
  const { caseId, attachmentId } = await uploadViaApi(insertSlashCase());
  const dl = await request(app)
    .get(`/api/v1/cases/${encodeURIComponent(caseId)}/attachments/${attachmentId}/download`)
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(200);
  assert.ok(dl.headers['content-disposition'].includes(encodeURIComponent('proof.png')));
  assert.deepEqual([...dl.body], [7, 7, 7]);
  // 跨屋苑下載被拒
  await request(app)
    .get(`/api/v1/cases/${encodeURIComponent(caseId)}/attachments/${attachmentId}/download`)
    .set('Authorization', `Bearer ${yprSupToken}`)
    .expect(403);
});

test('刪除：不存在附件 → 404', async () => {
  const id = insertSlashCase();
  const res = await request(app)
    .delete(`/api/v1/cases/${encodeURIComponent(id)}/attachments/99999`)
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(404);
  assert.equal(res.body.code, 3001);
});
