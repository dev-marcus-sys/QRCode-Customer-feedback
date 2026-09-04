'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const qrService = require('../src/services/qrService');

/** 每測試獨立記憶體庫：schema + seed + ensureDefaults，避免測試間互相污染。 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  // eslint-disable-next-line global-require
  const { seed } = require('../db/seed');
  seed(db);
  ensureDefaults(db);
  return db;
}

function adminId(db) {
  return db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get('admin').user_id;
}

test('新庫總覽：四屋苑皆未生成，site_base_url 為空', () => {
  const db = freshDb();
  const data = qrService.overview(db);
  assert.equal(data.siteBaseUrl, '');
  assert.equal(data.items.length, 4);
  for (const it of data.items) {
    assert.equal(it.qrId, null);
    assert.equal(it.active, null);
  }
});

test('生成：內容依 fallback 主機構成，僅帶 estate 參數', () => {
  const db = freshDb();
  const base = qrService.resolveBaseUrl(db, 'http://demo.test:3000/');
  assert.equal(base, 'http://demo.test:3000');
  const qr = qrService.generate(db, { estateCode: 'CHNG', base }, adminId(db));
  assert.equal(qr.active, 1);
  assert.equal(qr.qrContent, 'http://demo.test:3000/?estate=CHNG');
  const data = qrService.overview(db);
  const chng = data.items.find((i) => i.estateCode === 'CHNG');
  assert.equal(chng.qrId, qr.qrId);
  assert.equal(chng.active, true);
  // 其他屋苑不受影響
  assert.equal(data.items.find((i) => i.estateCode === 'CWC').qrId, null);
});

test('重新生成自動停用同苑舊碼（單一啟用不變式）', () => {
  const db = freshDb();
  const base = qrService.resolveBaseUrl(db, 'http://demo.test');
  const first = qrService.generate(db, { estateCode: 'CHNG', base }, adminId(db));
  const second = qrService.generate(db, { estateCode: 'CHNG', base }, adminId(db));
  assert.equal(qrService.getQr(db, first.qrId).active, 0);
  assert.ok(qrService.getQr(db, first.qrId).invalidatedAt);
  assert.equal(second.active, 1);
  const activeCount = db.prepare('SELECT COUNT(*) AS c FROM qr_code WHERE estate_code = ? AND is_active = 1').get('CHNG').c;
  assert.equal(activeCount, 1);
});

test('site_base_url 設定優先於 fallback，且可清除退回自動偵測', () => {
  const db = freshDb();
  const saved = qrService.saveSiteBaseUrl(db, 'https://qr.example.com/');
  assert.equal(saved, 'https://qr.example.com');
  const base = qrService.resolveBaseUrl(db, 'http://demo.test');
  assert.equal(base, 'https://qr.example.com');
  const qr = qrService.generate(db, { estateCode: 'YPR', base }, adminId(db));
  assert.equal(qr.qrContent, 'https://qr.example.com/?estate=YPR');
  assert.equal(qrService.overview(db).siteBaseUrl, 'https://qr.example.com');

  // 清除設定 → 退回 fallback
  qrService.saveSiteBaseUrl(db, '');
  assert.equal(qrService.resolveBaseUrl(db, 'http://auto.test'), 'http://auto.test');
});

test('非法 site_base_url 一律拒絕', () => {
  const db = freshDb();
  for (const bad of ['ftp://x.com', 'javascript:alert(1)', 'example.com', 'http://', 'https://a b']) {
    assert.throws(() => qrService.saveSiteBaseUrl(db, bad), (e) => e.code === 1002, `should reject: ${bad}`);
  }
  // 空字串與正規網址允許
  assert.doesNotThrow(() => qrService.saveSiteBaseUrl(db, ''));
  assert.doesNotThrow(() => qrService.saveSiteBaseUrl(db, 'http://localhost:3000'));
});

test('停用/啟用切換：啟用舊碼時自動停用同苑現行碼', () => {
  const db = freshDb();
  const base = qrService.resolveBaseUrl(db, 'http://demo.test');
  const a = qrService.generate(db, { estateCode: 'DAHF', base }, adminId(db));
  const b = qrService.generate(db, { estateCode: 'DAHF', base }, adminId(db));

  // 停用現行碼 b
  const stopped = qrService.setActive(db, b.qrId, false);
  assert.equal(stopped.active, 0);
  // 啟用被停用嘅 a → b 同時被停用，維持單一啟用
  const revived = qrService.setActive(db, a.qrId, true);
  assert.equal(revived.active, 1);
  assert.equal(qrService.getQr(db, b.qrId).active, 0);
  const activeCount = db.prepare('SELECT COUNT(*) AS c FROM qr_code WHERE estate_code = ? AND is_active = 1').get('DAHF').c;
  assert.equal(activeCount, 1);
});

test('QR_NOT_FOUND：操作不存在之 qrId 拋 1005', () => {
  const db = freshDb();
  assert.throws(() => qrService.setActive(db, 99999, true), (e) => e.code === 1005);
  assert.throws(() => qrService.assertQr(db, 'abc'), (e) => e.code === 1005);
});

test('ensureDefaults 冪等：權限/綁定/設定不重複，並作廢 localhost 舊碼', () => {
  const db = freshDb();
  // 模擬早期 seed 死碼
  const uid = adminId(db);
  db.prepare("INSERT INTO qr_code (estate_code, qr_type, qr_content, file_url, generated_by) VALUES ('CHNG','FORM','http://localhost:5173/?estate=CHNG','',?)")
    .run(uid);

  ensureDefaults(db); // 第一次：作廢 localhost 碼
  const dead = db.prepare('SELECT is_active FROM qr_code WHERE qr_content LIKE ?').get('http://localhost%');
  assert.equal(dead.is_active, 0);

  const permCount = (code) => db.prepare('SELECT COUNT(*) AS c FROM sys_permission WHERE perm_code = ?').get(code).c;
  ensureDefaults(db); // 第二次：無副作用
  assert.equal(permCount('qr:generate'), 1);
  const linkCount = db.prepare('SELECT COUNT(*) AS c FROM sys_role_permission').get().c;

  // 權限綁定正確
  const rolePerm = (roleCode, permCode) => db.prepare(
    `SELECT COUNT(*) AS c
       FROM sys_role_permission rp
       JOIN sys_role r ON r.role_id = rp.role_id
       JOIN sys_permission p ON p.permission_id = rp.permission_id
      WHERE r.role_code = ? AND p.perm_code = ?`
  ).get(roleCode, permCode).c;
  assert.equal(rolePerm('ADMIN', 'qr:generate'), 1);
  assert.equal(rolePerm('ADMIN', 'qr:view'), 1);
  assert.equal(rolePerm('CC_SUPERVISOR', 'qr:view'), 1);
  assert.equal(rolePerm('CC_SUPERVISOR', 'qr:generate'), 0);

  const cfgCount = db.prepare('SELECT COUNT(*) AS c FROM sys_config WHERE config_key = ?').get('form.site_base_url').c;
  assert.equal(cfgCount, 1);
  assert.equal(linkCount, db.prepare('SELECT COUNT(*) AS c FROM sys_role_permission').get().c);
});

test('renderQr：PNG 回傳有效 PNG buffer，SVG 回傳含 <svg 字串', async () => {
  const db = freshDb();
  const base = qrService.resolveBaseUrl(db, 'http://demo.test');
  const qr = qrService.generate(db, { estateCode: 'CHNG', base }, adminId(db));
  const png = await qrService.renderQr(qr.qrContent, 'png', 256);
  assert.ok(Buffer.isBuffer(png));
  assert.equal(png.readUInt32BE(0), 0x89504e47); // PNG magic
  const svg = await qrService.renderQr(qr.qrContent, 'svg', 256);
  assert.equal(typeof svg, 'string');
  assert.ok(svg.includes('<svg'));
});
