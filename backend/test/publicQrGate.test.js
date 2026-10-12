/**
 * 公眾表單 QR 有效性閘門（FR-009-03）：
 * 表單僅能經有效 QR 連結進入；當屋苑無「啟用中且未逾有效日期」的 QR 時，
 * 載入表單（/form/meta）與取用表單 token（/form/token）皆應被阻擋（1006 / HTTP 403）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');
const qrService = require('../src/services/qrService');

const tmp = path.join(__dirname, `._qrgate_${Date.now()}_${Math.floor(Math.random() * 1e6)}.db`);
process.env.DB_PATH = tmp;

let app;
let db;
const adminId = () => db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get('admin').user_id;
const meta = (estate, t) => {
  const q = { estate };
  if (t) q.t = t;
  return request(app).get('/api/v1/form/meta').query(q);
};
const token = (estate, t) => {
  const b = { estate };
  if (t) b.t = t;
  return request(app).post('/api/v1/form/token').send(b);
};
/** 由 QR 內容（base/?estate=X&t=TOKEN）取出 link token */
function tokenOf(content) {
  const m = /[?&]t=([^&]+)/.exec(content || '');
  return m ? decodeURIComponent(m[1]) : null;
}

test.before(() => {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  db = initDatabase();
  app = createApp();
});

test.after(() => {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
});

test('未生成 QR：缺 token／偽造 token 連結皆阻擋（1007 / 403）', async () => {
  const m = await meta('CHNG').expect(403);
  assert.equal(m.body.code, 1007);
  const t = await token('CHNG').expect(403);
  assert.equal(t.body.code, 1007);
  const f = await meta('CHNG', 'deadbeefdeadbeef').expect(403);
  assert.equal(f.body.code, 1007);
});

test('生成 QR 後：持有效 t 可正常載入表單與取 token', async () => {
  const qr = qrService.generate(db, { estateCode: 'CHNG', base: 'http://demo.test' }, adminId());
  const tk = tokenOf(qr.qrContent);
  assert.ok(tk, 'QR 內容應含 link token');
  const m = await meta('CHNG', tk).expect(200);
  assert.equal(m.body.code, 0);
  assert.equal(m.body.data.estateCode, 'CHNG');
  const t = await token('CHNG', tk).expect(200);
  assert.equal(t.body.code, 0);
  assert.ok(t.body.data.token);
});

test('停用 QR 後：持該 t 再次阻擋（1006）', async () => {
  const qr = qrService.generate(db, { estateCode: 'CHNG', base: 'http://demo.test' }, adminId());
  const tk = tokenOf(qr.qrContent);
  qrService.setActive(db, qr.qrId, false);
  assert.equal((await meta('CHNG', tk).expect(403)).body.code, 1006);
});

test('有效日期已過：持該 t 阻擋（1006）；設回永遠有效：恢復', async () => {
  const qr = qrService.generate(db, { estateCode: 'CHNG', base: 'http://demo.test' }, adminId());
  const tk = tokenOf(qr.qrContent);
  qrService.setValidUntil(db, qr.qrId, '2000-01-01');
  qrService.applyExpiry(db); // 模擬排程掃描
  assert.equal((await meta('CHNG', tk).expect(403)).body.code, 1006);

  // 清空有效日期 = 永遠有效 → 應同時重新啟用並恢復可存取
  qrService.setValidUntil(db, qr.qrId, '');
  assert.equal(qrService.getQr(db, qr.qrId).active, 1);
  assert.equal((await meta('CHNG', tk).expect(200)).body.code, 0);
});

test('getUsableQr：無碼 / 停用 / 過期皆回 null', () => {
  const uid = adminId();
  const qr = qrService.generate(db, { estateCode: 'DAHF', base: 'http://demo.test' }, uid);
  assert.ok(qrService.getUsableQr(db, 'DAHF'));
  qrService.setActive(db, qr.qrId, false);
  assert.equal(qrService.getUsableQr(db, 'DAHF'), null);
  qrService.setValidUntil(db, qr.qrId, '2000-01-01');
  qrService.setActive(db, qr.qrId, true); // 手動啟用（未掃描前仍為過期）
  assert.equal(qrService.getUsableQr(db, 'DAHF'), null);
  assert.equal(qrService.getUsableQr(db, 'NOPE'), null);
});
