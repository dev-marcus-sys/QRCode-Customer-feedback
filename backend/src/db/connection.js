/**
 * SQLite 連線管理：啟動時自動建表；空資料庫自動 seed。
 * 測試可設 process.env.DB_PATH=':memory:'（每個測試檔獨立進程）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let _db = null;

function dbPath() {
  if (process.env.DB_PATH === ':memory:') return ':memory:';
  const p = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'qr_feedback.sqlite');
  return p;
}

function getDb() {
  if (!_db) {
    const p = dbPath();
    if (p !== ':memory:') fs.mkdirSync(path.dirname(p), { recursive: true });
    _db = new Database(p);
    _db.pragma('foreign_keys = ON');
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

function applySchema(db) {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  db.exec(sql);
}

function isSeeded(db) {
  const tbl = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='case'").get();
  if (!tbl.c) return false;
  const r = db.prepare('SELECT COUNT(*) AS c FROM sys_estate').get();
  return r.c > 0;
}

/** 初始化：連線 → 建表 → （空庫時）種子資料 → 冪等補正（相容既有 DB）。回傳 db。 */
function initDatabase() {
  const db = getDb();
  applySchema(db);
  if (!isSeeded(db)) {
    // eslint-disable-next-line global-require
    const { seed } = require('../../db/seed');
    seed(db);
  }
  // eslint-disable-next-line global-require
  const { ensureDefaults } = require('./ensureDefaults');
  ensureDefaults(db);
  return db;
}

module.exports = { getDb, initDatabase, applySchema };
