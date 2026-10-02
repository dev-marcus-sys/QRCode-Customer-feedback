/**
 * 資料庫瀏覽 / SQL 控制台服務（db:query 權限專用）。
 *
 * 安全策略（白名單優於黑名單）：
 *  - 僅允許開頭為 SELECT / WITH / INSERT / UPDATE / DELETE / REPLACE / EXPLAIN 的單一語句；
 *    EXPLAIN 只准搭配 SELECT。
 *  - 其餘（含 DDL：CREATE/ALTER/DROP、PRAGMA、交易控制、多語句等）一律拒絕。
 *  - better-sqlite3 的 prepare() 原生會對多語句拋錯，作為天然防線。
 *  - 識別字（資料表名）先查 sqlite_master 確認存在，再以反引號包裹並跳脫反引號，避免注入。
 *  - SELECT 回傳列數上限 MAX_READ_ROWS；超過則截斷並標記 truncated。
 *  - 寫入型 SQL（INSERT/UPDATE/DELETE/REPLACE）成功後寫入 audit_log 以利追蹤。
 */
'use strict';
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { writeAudit } = require('../utils/audit');

const MAX_READ_ROWS = 5000;
const PREVIEW_MIN = 1;
const PREVIEW_MAX = 1000;
const PREVIEW_DEFAULT = 100;

// 允許的開頭關鍵字（白名單）
const ALLOWED_LEAD = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'EXPLAIN']);

/** 反引號跳脫識別字（防識別字注入） */
function quoteIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

/** 取出 SQL 開頭第一個關鍵字（忽略前導空白；不處理前置註解，控制台由使用者保證） */
function leadingKeyword(sql) {
  const m = String(sql).trim().match(/^([A-Za-z_]+)/);
  return m ? m[1].toUpperCase() : '';
}

/** 從 statement 擷取欄位名；不同 better-sqlite3 版本 stmt.columns 可能不存在，回落至首列鍵值 */
function readColumns(stmt, rows) {
  if (Array.isArray(stmt.columns)) return stmt.columns.map((c) => c.name);
  return rows && rows.length ? Object.keys(rows[0]) : [];
}

/** 驗證 SQL 允許執行；合法回傳 { kind:'read'|'write', explain:boolean }，否則拋 ApiError */
function classifySql(sql) {
  const kw = leadingKeyword(sql);
  if (!kw) throw new ApiError(ERR.VALIDATION, 'SQL 空白或無法辨識');
  if (!ALLOWED_LEAD.has(kw)) {
    throw new ApiError(ERR.VALIDATION, `不允許的 SQL 類型「${kw}」；僅允許 SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE/EXPLAIN`);
  }
  if (kw === 'EXPLAIN') {
    // EXPLAIN [QUERY PLAN] SELECT ... 才合法（僅搭配 SELECT）
    const rest = String(sql).trim().replace(/^EXPLAIN/i, '').trim().replace(/^QUERY\s+PLAN/i, '').trim();
    if (leadingKeyword(rest) !== 'SELECT') {
      throw new ApiError(ERR.VALIDATION, 'EXPLAIN 僅允許搭配 SELECT');
    }
    return { kind: 'read', explain: true };
  }
  const isWrite = kw === 'INSERT' || kw === 'UPDATE' || kw === 'DELETE' || kw === 'REPLACE';
  return { kind: isWrite ? 'write' : 'read', explain: false };
}

/** 確認資料表/視圖存在，回傳 sqlite_master 的 sql（建表語句） */
function assertTableExists(db, tableName) {
  const row = db.prepare(
    "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?"
  ).get(tableName);
  if (!row) throw new ApiError(ERR.VALIDATION, `資料表不存在：${tableName}`);
  return row;
}

/** 列出資料表與視圖；includeSystem=true 時一併包含 sqlite_ 系統表 */
function listTables(db, { includeSystem = false } = {}) {
  const rows = db.prepare(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name"
  ).all();
  const items = rows.map((r) => ({ name: r.name, type: r.type, system: r.name.startsWith('sqlite_') }));
  return { tables: includeSystem ? items : items.filter((i) => !i.system) };
}

/** 取得資料表結構：欄位（名稱/型別/主鍵/非空/預設值）＋ 建表語句 */
function getTableSchema(db, tableName) {
  assertTableExists(db, tableName);
  const cols = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all();
  const master = db.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = ?"
  ).get(tableName);
  return {
    table: tableName,
    type: master.type,
    columns: cols.map((c) => ({
      name: c.name,
      type: c.type,
      notnull: !!c.notnull,
      pk: !!c.pk,
      default: c.dflt_value,
    })),
    createSql: master.sql,
  };
}

/** 預覽資料表前 N 筆（limit 收束至 [PREVIEW_MIN, PREVIEW_MAX]，預設 PREVIEW_DEFAULT） */
function previewTable(db, tableName, limit) {
  assertTableExists(db, tableName);
  let n = Number(limit);
  if (!Number.isFinite(n)) n = PREVIEW_DEFAULT;
  n = Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, Math.floor(n)));
  const stmt = db.prepare(`SELECT * FROM ${quoteIdent(tableName)} LIMIT ?`);
  const rows = stmt.all(n);
  const columns = readColumns(stmt, rows);
  return { table: tableName, columns, rows, limit: n };
}

/**
 * 執行一條 SQL（白名單 + 單語句檢查）。
 * @param {object} db adapter
 * @param {string} sql 使用者輸入的 SQL
 * @param {object} [actor] 執行者資訊 { userId, username, ip, userAgent }（寫入型 SQL 審計用）
 * @returns {Promise<object>} { kind:'read'|'write', columns?, rows?, rowCount?, changes?, lastInsertRowid?, truncated? }
 */
function runSql(db, sql, actor = {}) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new ApiError(ERR.VALIDATION, 'SQL 為必填字串');
  }
  const { kind } = classifySql(sql);
  try {
    const stmt = db.prepare(sql);
    if (kind === 'write') {
      const info = stmt.run();
      const result = { kind: 'write', changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      // 審計：寫入型 SQL 記錄原始語句與執行者
      try {
        writeAudit(db, {
          userId: actor.userId,
          username: actor.username,
          action: 'DB_WRITE',
          targetType: 'sql',
          targetId: null,
          detail: { sql: sql.trim(), changes: info.changes, lastInsertRowid: info.lastInsertRowid, ip: actor.ip, userAgent: actor.userAgent },
        });
      } catch (aErr) {
        // 審計失敗不影響 SQL 結果，僅記錄（console.error：遵循不吞錯原則）
        console.error('[dbConsole] audit write failed:', aErr && aErr.message);
      }
      return result;
    }
    // 讀取型（SELECT/WITH/EXPLAIN）
    const rows = stmt.all();
    const columns = readColumns(stmt, rows);
    let truncated = false;
    if (rows.length > MAX_READ_ROWS) {
      rows.length = MAX_READ_ROWS;
      truncated = true;
    }
    return { kind: 'read', columns, rows, rowCount: rows.length, truncated };
  } catch (e) {
    // better-sqlite3 多語句會拋 "Cannot prepare multiple statements"
    const msg = e && e.message ? e.message : String(e);
    if (/multiple statements/i.test(msg)) {
      throw new ApiError(ERR.VALIDATION, '不允許多語句；請單次執行一條 SQL');
    }
    throw new ApiError(ERR.VALIDATION, `SQL 執行失敗：${msg}`);
  }
}

module.exports = {
  MAX_READ_ROWS,
  PREVIEW_MIN,
  PREVIEW_MAX,
  PREVIEW_DEFAULT,
  ALLOWED_LEAD,
  listTables,
  getTableSchema,
  previewTable,
  runSql,
  classifySql,
  quoteIdent,
};
