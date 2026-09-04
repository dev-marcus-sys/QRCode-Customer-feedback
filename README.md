# QRCode 客戶意見反饋系統 — F-001~F-003 可運行技術骨架

本專案依據《QRCode客戶意見反饋系統_功能規格書》V1.0（單管道版）的 F-001（客戶意見提交）、F-002（個案自動建立與編號）、F-003（個案列表、篩選與匯出）三個模組，提供一份**前後端分離、本機可直接運行**的技術骨架。

- **細部設計文件**：`docs/F001-F003_細部設計.md`（資料模型、API 契約、演算法、狀態機、線框、測試用例、與規格書差異對照）
- **規格書原文**：`QRCode客戶意見反饋系統_功能規格書.md`（未修改）

## 目錄結構

```
├── docs/F001-F003_細部設計.md   # 細部設計（繁體中文）
├── backend/                    # Node.js + Express + better-sqlite3
│   ├── src/                    #   app/server、middlewares、routes、services、config、utils
│   ├── db/                     #   schema.sql（SQLite DDL）、seed.js、mysql_schema_alignment.sql
│   └── test/                   #   單元測試（node:test）
├── frontend/                   # React 18 + TypeScript + Vite 5 + MUI v5
│   └── src/                    #   公眾表單 / 成功頁 / 後台登入 / 個案列表 / 個案詳情
└── QRCode客戶意見反饋系統_功能規格書.md  # 唯讀來源（不修改）
```

## 技術棧

| 層 | 選用 | 說明 |
| --- | --- | --- |
| 後端 | Node.js 20 + Express 4 + better-sqlite3 | 本機零設定；投產對齊 `backend/db/mysql_schema_alignment.sql` |
| 認證 | jsonwebtoken + bcryptjs | Demo 級 JWT accessToken（2h），RBAC 權限碼 |
| 前端 | React 18 + TypeScript + Vite 5 + MUI v5 | 手機優先公眾表單；後台列表/詳情 |
| 測試 | node:test（內建） | 23 個單元用例 |

## Windows 本機啟動

環境需求：Node.js 20 LTS（含 npm）。

### 模式 A：開發模式（Vite dev server + proxy，熱更新）

```powershell
# 終端 1：後端 API（http://localhost:3000）
cd backend
npm install
npm start

# 終端 2：前端（http://localhost:5173）
cd frontend
npm install
npm run dev
```

啟動後瀏覽器開啟 http://localhost:5173/?estate=CHNG 即可體驗公眾表單；`/api` 請求會由 Vite proxy 轉發至 3000。後端首次啟動會自動建立 SQLite 資料庫並寫入種子資料（屋苑、角色權限、演示帳號、sys_config、QR 映射）。

### 模式 B：生產模式（後端直接托管前端建置產物）

```powershell
cd frontend
npm run build        # 產出 frontend/dist
cd ..\backend
npm start            # 同時服務 API 與前端靜態檔，含 SPA fallback
```

瀏覽器開啟 http://localhost:3000/?estate=CHNG。

### 環境變數（可選）

複製 `backend/.env.example` 為 `backend/.env` 後調整；不設定亦有安全預設（JWT_SECRET 為開發預設值，投產務必更換）。

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | API 埠號 |
| `JWT_SECRET` | 開發預設值 | 投產必改 |
| `DB_PATH` | `backend/data/qr_feedback.sqlite` | SQLite 檔案位置 |
| `TZ` | `Asia/Hong_Kong` | 輸出時區（DB 內存 UTC） |

### 執行單元測試

```powershell
cd backend
npm test
```

## 演示帳號

| 帳號 | 密碼 | 角色 | 資料範圍 |
| --- | --- | --- | --- |
| `admin` | `Admin@2026` | 系統管理員 | 全部屋苑 |
| `cc_sup` | `CcSup@2026` | 客服中心主管 | 全部屋苑 |
| `cwc_sup` | `CwcSup@2026` | 灣景主管 | 灣景 |
| `ypr_sup` | `YprSup@2026` | 攸壆主管 | 攸壆 |
| `chng_sup` | `ChngSup@2026` | 頌雅主管 | 頌雅 |
| `dahf_sup` | `DahfSup@2026` | 大夫主管 | 大夫 |
| `chng_staff` | `ChngSt@2026` | 前線人員 | 頌雅 |

屋苑代碼對應：`CWC` 灣景、`YPR` 攸壆、`CHNG` 頌雅、`DAHF` 大夫（QR 掃描表單時由 URL 帶入住區代碼）。

## 功能與驗收步驟

### 公眾表單（F-001）

1. 開啟 `http://localhost:5173/?estate=CHNG`（或模式 B 的 3000 埠）。
2. 驗證：頁面顯示「頌雅苑」屋苑名稱、繁中/英文可切換、必填欄位標 `*`。
3. 填寫：稱謂、姓名、電郵或電話、意見種類（可複選最多 3 類）、意見內容，勾選「我已閱讀並同意 私隱政策」。
   - 中途輸入內容於失焦自動暫存；按 F5 重整後內容仍在（輸入暫存）。
   - 格式錯誤（如電郵格式）即時紅字提示，且送出前後端雙重驗證（錯誤碼 1002）。
4. 送出後進入成功頁，顯示：
   - 承諾文案「感謝您的反饋，我們將於三個工作天內聯繫閣下」；
   - **個案編號**（如 `SMS/SR/CHNG/260903001`，格式 `{公司}/{SR}/{屋苑}/{YYMMDD}{3位流水}`，每日由 001 起算）；
   - 內容摘要卡片（分類、內容、屋苑）。

### 防重複與二次投訴（F-002）

5. 於 10 分鐘內以相同電郵與相同內容再次送出：成功頁改為重複提示並回顯原案號（錯誤碼 1001）。
6. 24 小時內同客戶、同意見種類再次提交（不同內容）：成功頁案號旁顯示「二次投訴」，後台可看到標記與原案號關聯。

### 後台個案管理（F-003）

7. 開啟 `http://localhost:5173/admin/login`（或模式 B 的 `/admin/login`），以 `admin / Admin@2026` 登入。
8. 個案列表驗證：
   - 篩選列：屋苑、意見種類、狀態、事件類型、優先級、二次投訴、日期區間、關鍵字；
   - 表格：案號（超連結）、屋苑/種類、狀態色簽、事件類型、處理人、提交時間、SLA 到期與剩餘時間；
   - 逾期個案整行淡紅底並顯示「SLA 逾期」；狀態標籤 hover 有說明；分頁 10/20/50 可選；欄位可排序。
   - 屋苑主管（如 `chng_sup`）登入時，屋苑篩選被鎖定為所屬屋苑。
9. 點擊案號進入詳情頁：案號與狀態橫幅、意見內容、客戶資料、SLA 時限卡（首應期限／7 天關閉期限）、處理時間軸（首筆必為 CREATE）、可執行操作提示（依狀態機，骨架僅提示不實作轉換）。
10. 列表頂部「CSV / Excel」按鈕：以目前篩選條件匯出（CSV 含 UTF-8 BOM，Excel 可直接開啟中文）；動作會寫入審計紀錄（stub）。

### 自動化驗證記錄（本骨架開發期已執行）

- 後端單元測試 `npm test`：23/23 通過（編號流水與唯一性、10 分鐘查重、24 小時二次投訴、SLA 計算、表單驗證、狀態矩陣）。
- API 冒煙（提交→建案→查重回原案號→二次投訴關聯→登入→列表→詳情→CSV/XLSX 匯出）：10 項全數通過。
- Playwright E2E：公眾表單送出得 `SMS/SR/CHNG/260903006` → 後台登入 → 關鍵字篩選見案 → 詳情頁時間軸/允許操作渲染正常。

## 與規格書差異摘要

完整差異對照見 `docs/F001-F003_細部設計.md` §9。要點：

| # | 規格書 | 骨架 | 說明 |
| --- | --- | --- | --- |
| 9.1 | MySQL 8 | SQLite（better-sqlite3） | 型態差異：AUTO_INCREMENT→INTEGER PRIMARY KEY AUTOINCREMENT、DATETIME→TEXT(UTC ISO)、MEDIUMTEXT→TEXT；另附 MySQL 對齊檔 |
| 9.2 | ESTATE_CODE 3 字元 | 實際 3 字元（CWC/YPR/CHNG/DAHF） | 規格書 7.3 前文誤植 4 字元，採樣例 |
| 9.3 | 郵件 SMTP | `email_outbox` 落庫＋logger | 確認電郵機制 stub，SMTP 投產接入 |
| 9.4 | formToken 採 JWT | HMAC-signed 一次性 token（5 分鐘） | 語意一致之輕量替代 |
| 9.5 | 審計 | `audit_log` 落庫（DB 層不強制防刪） | SQLite 限制，投產改 MySQL |
| 9.6 | intent_type 表單未定義採集 | 內容關鍵字＋類別啟發式 | 規則集中 `sla.js`，可 F-009 規則化 |
| 9.7 | `/cases/export` 與 `/cases/{caseId}` | export 路由先註冊 | 避免被參數捕獲 |
| 9.8 | 新增表 | `email_outbox` | 郵件佇列 stub |
| 9.9 | refreshToken | 僅 accessToken（2h） | Demo 精簡 |
| 9.10 | F-004~F-010 | 不實作 | 僅預留介面與資料結構 |

其他：匯出欄位以個案明細為準、多意見種類時事件判定採主要（首選）類別、SLA 分鐘值（URGENT 5m/NORMAL 30m/COMPLEX 2h/INSTANT 4h）存放 `sys_config` 可調、狀態轉換 API 保留為 F-004 起擴展點（骨架不允許直接改狀態）。

## 部署到測試環境

本骨架可打包為「測試環境部署封裝包」後，由目標機現場安裝工具鏈並完成前端建置與啟動（不引入 Docker / CI）。部署後採用上述「模式 B」：單一 Node 進程同時服務 API 與前端 UI，資料庫使用 SQLite 檔案。

1. **產出封裝包**（開發機）：`powershell -ExecutionPolicy Bypass -File tools/package.ps1` → 產出 `deploy/QRCode-Feedback-Test-<yyyyMMdd>.zip`（已排除 `node_modules`/`dist`/`data`/`.git`/`.env`）。
2. **測試機部署步驟**（工具鏈、解壓、`.env` 配置、前端 `npm run build`、啟動與驗證清單、常見問題與回滾）詳見 **[`部署說明_測試環境.md`](部署說明_測試環境.md)**。

> 關鍵：解壓後須保持 `backend/` 與 `frontend/` 為同層目錄，後端據此（`backend/src/app.js` 的 `../../frontend/dist`）托管前端靜態資源。
