'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const svc = require('../src/services/dbConsoleService');
const { ApiError } = require('../src/middlewares/error');
const { ERR } = require('../src/config/constants');

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

const ACTOR = { userId: 1, username: 'admin', ip: '127.0.0.1', userAgent: 'test' };

test('listTables：預設隱藏 sqlite_ 系統表，可含系統表', () => {
  const db = freshDb();
  const def = svc.listTables(db, { includeSystem: false });
  assert.ok(def.tables.length > 0);
  assert.ok(!def.tables.some((t) => t.system), '預設不應含 sqlite_ 系統表');
  const withSys = svc.listTables(db, { includeSystem: true });
  assert.ok(withSys.tables.some((t) => t.system), 'includeSystem=true 應含系統表');
});

test('getTableSchema：回傳欄位與建表語句', () => {
  const db = freshDb();
  const s = svc.getTableSchema(db, 'sys_estate');
  assert.equal(s.table, 'sys_estate');
  assert.ok(Array.isArray(s.columns) && s.columns.length > 0);
  assert.ok(s.columns.some((c) => c.pk));
  assert.ok(typeof s.createSql === 'string' && s.createSql.includes('CREATE TABLE'));
  // 不存在的表拋錯
  assert.throws(() => svc.getTableSchema(db, 'no_such_table'), (e) => e instanceof ApiError && e.code === ERR.VALIDATION);
});

test('previewTable：回傳前 N 筆，limit 收束至 [1,1000]', () => {
  const db = freshDb();
  const p = svc.previewTable(db, 'sys_estate', 99999);
  assert.equal(p.limit, 1000, '過大 limit 應收束到 1000');
  const small = svc.previewTable(db, 'sys_estate', 0);
  assert.equal(small.limit, 1, '過小 limit 應收束到 1');
  assert.ok(Array.isArray(small.rows));
});

test('classifySql：白名單允許 SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE/EXPLAIN，拒絕 DDL', () => {
  for (const sql of ['SELECT 1', 'WITH t AS (SELECT 1) SELECT * FROM t', 'INSERT INTO sys_estate VALUES (1)', 'UPDATE sys_estate SET x=1', 'DELETE FROM sys_estate', 'REPLACE INTO sys_estate VALUES (1)', 'EXPLAIN SELECT 1']) {
    assert.doesNotThrow(() => svc.classifySql(sql), `應允許：${sql}`);
  }
  for (const ddl of ['CREATE TABLE t(x)', 'DROP TABLE sys_estate', 'ALTER TABLE sys_estate ADD c', 'PRAGMA table_info', 'ATTACH DATABASE x']) {
    assert.throws(() => svc.classifySql(ddl), (e) => e instanceof ApiError && e.code === ERR.VALIDATION, `應拒絕：${ddl}`);
  }
  // EXPLAIN 僅限搭配 SELECT
  assert.throws(() => svc.classifySql('EXPLAIN INSERT INTO sys_estate VALUES (1)'), (e) => e instanceof ApiError);
  assert.throws(() => svc.classifySql('EXPLAIN'), (e) => e instanceof ApiError);
});

test('runSql：多語句被拒絕', () => {
  const db = freshDb();
  assert.throws(() => svc.runSql(db, 'SELECT 1; SELECT 2;'), (e) => e instanceof ApiError && e.code === ERR.VALIDATION);
});

test('runSql：SELECT 回傳 columns/rows', () => {
  const db = freshDb();
  const r = svc.runSql(db, 'SELECT estate_code, estate_name_zh FROM sys_estate');
  assert.equal(r.kind, 'read');
  assert.ok(Array.isArray(r.columns) && r.columns.length === 2);
  assert.ok(Array.isArray(r.rows) && r.rows.length > 0);
});

test('runSql：INSERT 回傳 changes 並寫入 audit_log', () => {
  const db = freshDb();
  const before = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  const r = svc.runSql(db, "INSERT INTO sys_estate (estate_code, estate_name_zh, estate_name_en, company_code) VALUES ('ZZZ','測試','Test','T')", ACTOR);
  assert.equal(r.kind, 'write');
  assert.equal(r.changes, 1);
  const after = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  assert.equal(after, before + 1, '寫入型 SQL 應記一筆 audit_log');
  const last = db.prepare('SELECT action, detail FROM audit_log ORDER BY audit_id DESC LIMIT 1').get();
  assert.equal(last.action, 'DB_WRITE');
  assert.ok(last.detail.includes('INSERT INTO sys_estate'));
});

test('runSql：UPDATE 影響正確筆數', () => {
  const db = freshDb();
  const r = svc.runSql(db, "UPDATE sys_estate SET estate_name_zh = '已改' WHERE estate_code = 'CWC'", ACTOR);
  assert.equal(r.kind, 'write');
  assert.equal(r.changes, 1);
  const row = db.prepare("SELECT estate_name_zh FROM sys_estate WHERE estate_code = 'CWC'").get();
  assert.equal(row.estate_name_zh, '已改');
});

test('runSql：DELETE 影響正確筆數', () => {
  const db = freshDb();
  const r = svc.runSql(db, "DELETE FROM sys_estate WHERE estate_code = 'CWC'", ACTOR);
  assert.equal(r.changes, 1);
  const cnt = db.prepare("SELECT COUNT(*) AS c FROM sys_estate WHERE estate_code = 'CWC'").get().c;
  assert.equal(cnt, 0);
});
