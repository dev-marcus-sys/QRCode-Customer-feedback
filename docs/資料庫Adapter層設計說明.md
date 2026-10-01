# 資料庫 Adapter 層設計說明

> 對應變更：`backend/src/db/adapter.js`（新增）、`backend/src/db/connection.js`（重構）
> 所屬計畫：SQLite → MSSQL 遷移 — 第一步（抽離 adapter 介面，保持 SQLite 行為不變）
> 對象：開發者 / 維運。本文為設計決策與介面契約記錄，非使用者文檔。

---

## 1. 背景與目的

原本的資料存取層存在以下耦合，使「隨時切換資料庫」不可行：

- **驅動直接寫死**：`better-sqlite3` 在 `connection.js` 被直接 `require` 並 `new Database(...)`，連線建立邏輯沒有抽象。
- **全域同步 API**：35 個 service / route 檔直接使用 `db.prepare(...).get/run/all` 的同步寫法；`schema.sql` 使用 SQLite 專屬方言（`AUTOINCREMENT`、`datetime('now')`、反引號識別字、`journal_mode = WAL`、`pragma foreign_keys`）。
- **缺乏切換機制**：沒有 `DB_TYPE` / adapter 工廠，無法在不改程式碼的前提下替換底層資料庫。

第一步的目標**不是**直接接上 MSSQL，而是：

1. 把「建立哪一套連線」集中到單一工廠 `createAdapter()`；
2. 定義一組與 `better-sqlite3` 相容的 `DbAdapter` 介面，對外方法保持同步；
3. 讓現有 35 個 service / route **完全不用改寫**即可繼續運作，為第二步（真正的 MSSQL 切換）預留 seam。

> **事實更正（重要）**：`numbering.js` **並未**自行開一條 `better-sqlite3` 連線，它只是接收呼叫方傳入的 `db` 參數（先前搜尋命中的 `better-sqlite3` 僅是 JSDoc 型別註解字串）。全程式碼中 `new Database` 只出現在 `connection.js` 一處，因此連線來源本就統一，本步驟無須修改 `numbering.js`。

---

## 2. 設計方案

### 2.1 `DbAdapter` 介面

```js
/**
 * @typedef {Object} DbAdapter
 * @property {(sql: string) => any} prepare      回傳 statement（含 get/run/all/iterate）
 * @property {(sql: string) => void} exec        執行多句 SQL（建表用）
 * @property {(fn: Function) => Function} transaction  回傳可呼叫的交易函式
 * @property {(pragma: string) => any} pragma    設定/讀取 pragma
 * @property {() => void} close                  關閉連線
 */
```

介面刻意只涵蓋現有程式碼實際用到的方法。其中 `prepare` 回傳的是底層 statement 物件，因此 `statement.get/run/all/iterate` 等行為**原樣保留**，呼叫方不需改寫。

### 2.2 `SqliteAdapter`（委派實作）

`SqliteAdapter` 持有 `better-sqlite3` 的 `Database`，並將介面方法**一對一委派**給它，不改變任何語意：

```js
class SqliteAdapter {
  constructor(db) { this._db = db; }
  prepare(sql)     { return this._db.prepare(sql); }
  exec(sql)        { return this._db.exec(sql); }
  transaction(fn)  { return this._db.transaction(fn); }
  pragma(p)        { return this._db.pragma(p); }
  close()          { return this._db.close(); }
}
```

### 2.3 `createAdapter` 工廠（切換開關點）

```js
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
```

- 目前的選擇鍵是 `process.env.DB_TYPE`（預設 `sqlite`）。
- 非 `sqlite` 的型別會**明確拋錯**，不靜默退化成 SQLite，避免日後誤以為已切換。
- 這個 `if` 分支就是未來新增 `MssqlAdapter` 的擴充點。

---

## 3. 架構圖

```mermaid
graph TD
  A[Routes / Services / Scheduler] -->|getDb()| B[connection.js]
  B -->|createAdapter('sqlite',{path})| C[adapter.js: createAdapter]
  C -->|new SqliteAdapter(db)| D[SqliteAdapter]
  D -->|委派 prepare/exec/transaction/pragma/close| E[better-sqlite3 Database]
  C -. DB_TYPE=mssql 未實作，明確拋錯 .-> F[(未來 MssqlAdapter)]
```

呼叫方完全不感知底層引擎；未來要接 MSSQL，只需在 `createAdapter` 增加 `mssql` 分支並實作 `MssqlAdapter`（見第 8 節）。

---

## 4. 介面契約表

| 方法 | 參數 | 回傳 | 說明 |
| --- | --- | --- | --- |
| `prepare(sql)` | `sql: string` | statement 物件 | 委派 `better-sqlite3`；其上 `get/run/all/iterate` 原樣可用 |
| `exec(sql)` | `sql: string` | `void` | 執行多句 SQL，建表（`schema.sql`）時使用 |
| `transaction(fn)` | `fn: Function` | `Function` | 回傳可呼叫的交易函式（同步）；`userService.js` 等處使用 |
| `pragma(p)` | `pragma: string` | `any` | 設定/讀取 pragma（如 `foreign_keys = ON`、`journal_mode = WAL`） |
| `close()` | — | `void` | 關閉連線 |

> 所有方法目前均為**同步**，與 `better-sqlite3` 一致；第二步引入 MSSQL 時，這組方法會轉為非同步（呼叫方需 `await`）。

---

## 5. `connection.js` 重構說明

**重構前**：直接依賴驅動並建立連線。

```js
const Database = require('better-sqlite3');
// ...
_db = new Database(p);
```

**重構後**：移除直接依賴，改由工廠建立。

```js
const { createAdapter } = require('./adapter');
// ...
_db = createAdapter('sqlite', { path: p });
```

`getDb()` 仍回傳 adapter 實例，而 adapter 暴露的 `prepare/exec/transaction/pragma` 與原本的 `Database` 方法相容，因此 `connection.js` 內部的 `applySchema`（用 `exec`）、`isSeeded`（用 `prepare().get()`）以及外部的 `seed` / `ensureDefaults` 全部不受影響。模組匯出項 `getDb / initDatabase / applySchema` 維持不變。

---

## 6. 行為相容性清單

重構後，以下行為**與重構前完全一致**：

- `getDb()` 為 singleton（同進程回傳同一實例）。
- 仍支援 `process.env.DB_PATH=':memory:'`（每個測試檔獨立進程的隔離機制不受影響）。
- 仍開啟 `journal_mode = WAL` 與 `foreign_keys = ON`。
- 仍依 `DB_PATH` 決定檔案位置（預設 `data/qr_feedback.sqlite`）。
- 仍匯出 `getDb / initDatabase / applySchema`，呼叫方無須調整。
- 35 個 service / route 的 `db.prepare(...)` 呼叫**零改動**。

---

## 7. 驗證結果

| 項目 | 結果 |
| --- | --- |
| ESLint（`adapter.js` / `connection.js`） | 0 錯誤 |
| Smoke（委派方法皆為 `function`） | `prepare/exec/transaction/pragma` 均為 function；`getDb()` 為 singleton |
| Smoke（`DB_TYPE=mssql`） | 明確拋錯：「尚不支援的 DB_TYPE="mssql"…」 |
| `node --test test/caseAction.test.js` | 10 / 10 通過（附件上傳/下載、生命週期、範圍保護等行為無回歸） |

---

## 8. 第二步路線圖與風險

第一步只是「收斂驅動選擇與連線來源」，要真正上 MSSQL 仍需以下工作：

1. **引入非同步 adapter**
   - 建議引入 **Knex** 作為統一查詢層（同時支援 `sqlite3` 與 `mssql` dialect，自動處理參數綁定、`returning`、識別字引號、`now()` 等方言差異）；或自寫 `MssqlAdapter`。
   - 在 `createAdapter` 增加 `mssql` 分支，返回對應 adapter。
2. **MSSQL 版 schema**
   - 新增 `mssql_schema.sql`：`IDENTITY(1,1)`（取代 `AUTOINCREMENT`）、`DATETIME2` / `SYSUTCDATETIME()`（取代 `datetime('now')`）、`[ ]` 引號（取代反引號）、`SCOPE_IDENTITY()` / `OUTPUT inserted`（取代 `last_insert_rowid`）。
3. **呼叫方 `await` 化（主要工作量）**
   - 35 個 service / route 的 `db.prepare(...).get/run/all` 必須改為 `await db.xxx(...)` 形式（因 MSSQL 為非同步），含 `scheduler.js`、middleware、現有 `node --test` 測試。
4. **資料搬遷**
   - 上線時將既有 SQLite 資料匯出並匯入 MSSQL，需做型別對映（TEXT↔NVARCHAR、INTEGER↔INT/BIGINT、布林↔BIT 等）。

**風險提示**：同步→非同步的連鎖改動是最大風險點；建議先完成第一步（已完成）並以 `DB_TYPE` 閘門保護，再分批 `await` 化，並為 MSSQL 增加一組 CI 驗證。

> 附註：倉庫內已存在 `db/mysql_schema_alignment.sql`（MySQL 8 對齊 DDL）。若目標僅是「換一個能上線的資料庫」而可接受 MySQL，其方言與現有 schema 更接近、且已有人開頭，成本會低於 MSSQL。
