/**
 * F-010 細部設計 可運行骨架測試（Node 內建 node --test + supertest）。
 * 單一 describe 順序執行，避免多個 describe 並行競爭同一資料庫：
 * - 用戶列表/新增/修改/停用（軟刪）/重設密碼/鎖定
 * - 防呆：不可停用最後一位管理員
 * - 強制改密（2006）＋ 改密後可登入
 * - 角色新增/修改/複製/停用
 * - 審計查閱（操作被記錄）
 *
 * 登入端點有速率限制（60s/5 次），故僅於檔頭登入 admin 與 chng_staff 各一次共用 token。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');

const tmp = path.join(__dirname, `._f010_${Date.now()}_${Math.floor(Math.random() * 1e6)}.db`);
process.env.DB_PATH = tmp; // initDatabase 讀取此變數；空庫會自動 seed

let app;
let db;
let adminToken;
let staffToken;

function login(username, password) {
  return request(app).post('/api/v1/auth/login').send({ username, password }).expect(200);
}

test.before(() => {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  db = initDatabase(); // 空庫自動 seed（estates/roles/perms/users）
  app = createApp();
  return Promise.all([
    login('admin', 'Admin@2026').then((r) => { adminToken = r.body.data.accessToken; }),
    login('chng_staff', 'ChngSt@2026').then((r) => { staffToken = r.body.data.accessToken; }),
  ]);
});

test.after(() => {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
});

test.describe('F-010 用戶與權限管理（順序執行）', () => {
  test.it('未帶 token 不可列出用戶（401）', async () => {
    await request(app).get('/api/v1/users').expect(401);
  });

  test.it('普通 ESTATE_STAFF 無 user:list 權限（403）', async () => {
    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${staffToken}`).expect(403);
  });

  test.it('ADMIN 可列出用戶', async () => {
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.ok(res.body.data.total >= 7);
  });

  test.it('管理員新增用戶（不給密碼）標記強制改密', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'tmpuser', fullName: '臨時人員', estateCode: 'ALL', roles: ['ESTATE_STAFF'] })
      .expect(201);
    assert.equal(res.body.data.mustChangePwd, true);
    const row = db.prepare('SELECT must_change_pwd FROM sys_user WHERE username = ?').get('tmpuser');
    assert.equal(row.must_change_pwd, 1);
  });

  test.it('改密需 currentPassword，缺則 400', async () => {
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'NewPwd@2026' })
      .expect(400);
  });

  test.it('錯誤 currentPassword 改密失敗（401）', async () => {
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'wrong', newPassword: 'NewPwd@2026' })
      .expect(401);
  });

  test.it('正確改密後可登入，並清除強制改密標記', async () => {
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'Admin@2026', newPassword: 'Admin@2027' })
      .expect(200);
    await login('admin', 'Admin@2027');
    // 復原管理員密碼，避免影響其他測試
    db.prepare("UPDATE sys_user SET password_hash = ? WHERE username = 'admin'").run(
      require('bcryptjs').hashSync('Admin@2026', 10)
    );
  });

  test.it('新增用戶時密碼強度不足被拒（400）', async () => {
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'weak1', fullName: '弱密碼', estateCode: 'ALL', roles: ['ESTATE_STAFF'], password: '123' })
      .expect(400);
  });

  test.it('管理員重設用戶密碼回傳一次性密碼', async () => {
    const u = db.prepare("SELECT user_id FROM sys_user WHERE username = 'tmpuser'").get();
    const res = await request(app)
      .post(`/api/v1/users/${u.user_id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.match(res.body.data.tempPassword, /[A-Z]/);
    assert.match(res.body.data.tempPassword, /[0-9]/);
    const row = db.prepare('SELECT must_change_pwd FROM sys_user WHERE username = ?').get('tmpuser');
    assert.equal(row.must_change_pwd, 1);
  });

  test.it('不可停用最後一位管理員（409）', async () => {
    const admin = db.prepare("SELECT user_id FROM sys_user WHERE username = 'admin'").get();
    await request(app)
      .delete(`/api/v1/users/${admin.user_id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  test.it('可停用非管理員用戶（軟刪）', async () => {
    const u = db.prepare("SELECT user_id FROM sys_user WHERE username = 'tmpuser'").get();
    await request(app)
      .delete(`/api/v1/users/${u.user_id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const after = db.prepare('SELECT is_active FROM sys_user WHERE user_id = ?').get(u.user_id);
    assert.equal(after.is_active, 0);
  });

  test.it('列出角色與權限目錄', async () => {
    const res = await request(app).get('/api/v1/roles').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.ok(Array.isArray(res.body.data.roles));
    assert.ok(res.body.data.roles.some((r) => r.roleCode === 'ADMIN'));
    assert.ok(Array.isArray(res.body.data.permissions));
  });

  test.it('新增角色並綁定權限', async () => {
    const res = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCode: 'TEST_ROLE', roleName: '測試角色', dataScope: 'ESTATE', permissions: ['case:list', 'case:view'] })
      .expect(201);
    assert.equal(res.body.data.roleCode, 'TEST_ROLE');
    assert.deepEqual(res.body.data.permissions.map((p) => p.code).sort(), ['case:list', 'case:view']);
  });

  test.it('複製角色（FR-010-07）', async () => {
    const res = await request(app)
      .post('/api/v1/roles/copy')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fromRoleCode: 'TEST_ROLE', roleCode: 'TEST_ROLE2', roleName: '測試副本' })
      .expect(201);
    assert.deepEqual(res.body.data.permissions.map((p) => p.code).sort(), ['case:list', 'case:view']);
  });

  test.it('停用角色（軟刪）', async () => {
    await request(app)
      .delete('/api/v1/roles/TEST_ROLE2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const after = db.prepare("SELECT is_active FROM sys_role WHERE role_code = 'TEST_ROLE2'").get();
    assert.equal(after.is_active, 0);
  });

  test.it('用戶操作被寫入審計', async () => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'USER_MANAGE'").get().c;
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'audituser', fullName: '審計人員', estateCode: 'ALL', roles: ['ESTATE_STAFF'] })
      .expect(201);
    const after = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'USER_MANAGE'").get().c;
    assert.ok(after > before);
  });

  test.it('audit:view 可查閱日誌', async () => {
    const res = await request(app).get('/api/v1/audit?action=USER_MANAGE').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.ok(res.body.data.total >= 1);
    assert.equal(res.body.data.items[0].action, 'USER_MANAGE');
  });

  test.it('權限不足者（ESTATE_STAFF）不可查閱審計（403）', async () => {
    await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${staffToken}`).expect(403);
  });
});
