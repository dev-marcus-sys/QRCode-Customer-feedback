/**
 * 暫時性冒煙腳本：驗證新增之屋苑管理 API（屋苑主檔 GET/POST/PUT、權限、審計、停用影響）。
 * 使用暫存 DB（process.env.DB_PATH），跑完自動清理，不觸碰實際資料。
 * 跑完後請刪除此檔。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const request = require('supertest');

const tmp = path.join(__dirname, `._estates_smoke_${Date.now()}.db`);
process.env.DB_PATH = tmp;
const { initDatabase } = require('./src/db/connection');
const { createApp } = require('./src/app');

let token;

function login(username, password) {
  return request(app).post('/api/v1/auth/login').send({ username, password });
}
function auth(t) {
  return `Bearer ${t}`;
}

let app;
try {
  initDatabase();
  app = createApp();
  (async () => {
    const r = await login('admin', 'Admin@2026');
    if (r.body.code !== 0) throw new Error('admin 登入失敗');
    token = r.body.data.accessToken;

    // 1) 初始 4 屋苑
    const list0 = await request(app).get('/api/v1/estates').set('Authorization', auth(token)).expect(200);
    if (list0.body.data.items.length !== 4) throw new Error(`初始屋苑數應為 4，實際 ${list0.body.data.items.length}`);

    // 2) 新增（代碼自動轉大寫、小寫輸入驗證）
    await request(app).post('/api/v1/estates').set('Authorization', auth(token))
      .send({ estateCode: 'hhd', estateNameZh: '海濱花園', estateNameEn: 'Riviera Garden', companyCode: 'crmp' })
      .expect(201);

    // 3) 重複代碼 → 409
    await request(app).post('/api/v1/estates').set('Authorization', auth(token))
      .send({ estateCode: 'HHD', estateNameZh: '重複', estateNameEn: 'Dup', companyCode: 'CRPM' })
      .expect(409);

    // 4) 非法代碼 → 400
    await request(app).post('/api/v1/estates').set('Authorization', auth(token))
      .send({ estateCode: '123', estateNameZh: 'x', estateNameEn: 'y', companyCode: 'CRPM' })
      .expect(400);

    // 5) 修改名稱/公司
    await request(app).put('/api/v1/estates/HHD').set('Authorization', auth(token))
      .send({ estateNameZh: '海濱花園二期', companyCode: 'PML' }).expect(200);

    // 6) 停用 → 公眾表單 meta 404；重新啟用
    await request(app).put('/api/v1/estates/HHD').set('Authorization', auth(token))
      .send({ isActive: false }).expect(200);
    await request(app).get('/api/v1/form/meta?estate=HHD').expect(404);
    await request(app).put('/api/v1/estates/HHD').set('Authorization', auth(token))
      .send({ isActive: true }).expect(200);
    const list1 = await request(app).get('/api/v1/estates').set('Authorization', auth(token)).expect(200);
    const hhd = list1.body.data.items.find((x) => x.estateCode === 'HHD');
    if (!hhd || hhd.estateNameZh !== '海濱花園二期' || hhd.companyCode !== 'PML' || hhd.isActive !== 1) {
      throw new Error('更新/啟用後資料不符');
    }

    // 7) 權限：ESTATE_STAFF 查不了列表（僅需登入→200）？列表僅需登入，故 staff 可 GET；manage 需 estate:manage → 403
    const staff = await login('chng_staff', 'ChngSt@2026');
    await request(app).get('/api/v1/estates').set('Authorization', auth(staff.body.data.accessToken)).expect(200);
    await request(app).post('/api/v1/estates').set('Authorization', auth(staff.body.data.accessToken))
      .send({ estateCode: 'XXX', estateNameZh: 'x', estateNameEn: 'y', companyCode: 'CRPM' }).expect(403);
    const sup = await login('chng_sup', 'ChngSup@2026');
    await request(app).get('/api/v1/estates').set('Authorization', auth(sup.body.data.accessToken)).expect(200);
    await request(app).post('/api/v1/estates').set('Authorization', auth(sup.body.data.accessToken))
      .send({ estateCode: 'YYY', estateNameZh: 'x', estateNameEn: 'y', companyCode: 'CRPM' }).expect(403);

    // 8) 未登入 401
    await request(app).get('/api/v1/estates').expect(401);

    // 9) 審計有 ESTATE_MANAGE 記錄
    const aud = await request(app).get('/api/v1/audit?page=1&pageSize=20&action=ESTATE_MANAGE')
      .set('Authorization', auth(token)).expect(200);
    if (!aud.body.data.items.length) throw new Error('審計無 ESTATE_MANAGE 記錄');

    console.log('ESTATE SMOKE OK');
  })().catch((e) => {
    console.error('ESTATE SMOKE FAIL:', e.message);
    process.exitCode = 1;
  }).finally(() => {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  });
} catch (e) {
  console.error('ESTATE SMOKE SETUP FAIL:', e.message);
  process.exitCode = 1;
}
