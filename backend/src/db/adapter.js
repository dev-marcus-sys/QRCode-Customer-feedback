/**
 * 資料庫 Adapter 層（遷移計畫第一步）。
 *
 * 目的：把「建立哪一套資料庫連線」這件事集中到單一工廠 createAdapter()，
 * 對外暴露一組與 better-sqlite3 相容的方法（prepare / exec / transaction /
 * pragma / close），讓現有 service / route 不用改寫即可繼續運作。
 *
 * 未來切換 MSSQL（第二步）：
 *   1. 新增 MssqlAdapter 實作同一組方法（MSSQL 為非同步，屆時需把呼叫方
 *      改為 await，並在此檔加入 'mssql' 分支）。
 *   2. 以 process.env.DB_TYPE 決定建立哪個 adapter。
 * 目前僅實作 sqlite，其餘 DB_TYPE 會明確拋錯，避免靜默退化。
 */

'use strict';
const Database = require('better-sqlite3');

/**
 * @typedef {Object} DbAdapter
 * @property {(sql: string) => any} prepare      回傳 statement（含 get/run/all/iterate）
 * @property {(sql: string) => void} exec        執行多句 SQL（建表用）
 * @property {(fn: Function) => Function} transaction  回傳可呼叫的交易函式
 * @property {(pragma: string) => any} pragma    設定/讀取 pragma
 * @property {() => void} close                  關閉連線
 */

/** SQLite 實作：委派給 better-sqlite3，對外方法保持同步相容。 */
class SqliteAdapter {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    /** @private */
    this._db = db;
  }

  prepare(sql) {
    return this._db.prepare(sql);
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  transaction(fn) {
    return this._db.transaction(fn);
  }

  pragma(p) {
    return this._db.pragma(p);
  }

  close() {
    return this._db.close();
  }
}

/**
 * 依 DB_TYPE 建立對應 adapter。
 * @param {string} [type] 覆寫 process.env.DB_TYPE（預設 'sqlite'）
 * @param {{ path?: string }} [opts] 連線選項；sqlite 時為檔案路徑（可為 ':memory:'）
 * @returns {DbAdapter}
 */
function createAdapter(type, opts = {}) {
  const dbType = (type || process.env.DB_TYPE || 'sqlite').toLowerCase();
  if (dbType !== 'sqlite') {
    throw new Error(
      `尚不支援的 DB_TYPE="${dbType}"；目前僅實作 sqlite（MSSQL 請見遷移計畫第二步）。`
    );
  }
  const db = new Database(opts.path);
  return new SqliteAdapter(db);
}

module.exports = { SqliteAdapter, createAdapter };
