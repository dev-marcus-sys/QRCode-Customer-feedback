# QRCode 客戶意見反饋系統 — 測試環境部署說明（Windows 版）

本說明適用於將系統**手動部署到一台 Windows 測試機**（Windows 10 / 11，x64）。
依據需求，本次只產出部署封裝包與本手冊，由測試機現場安裝工具鏈並完成前端建置與啟動；
不引入 Docker / CI/CD，亦不實際執行部署動作。

部署後採用 README 的「模式 B」：**單一 Node 進程同時服務 API 與前端 UI**，資料庫使用 SQLite 檔案（零外部依賴）。

> 若目標機為 Linux，請改參考 **[`部署說明_測試環境_Linux.md`](部署說明_測試環境_Linux.md)**。

---

## 1. 取得部署封裝包

在開發機（本機）執行封裝腳本，產出乾淨壓縮包：

```powershell
cd <專案根目錄>
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```

產出檔案：`deploy/QRCode-Feedback-Test-<yyyyMMdd>.zip`

封裝包內容（已排除 `node_modules`、`frontend/dist`、`backend/data`、`.git`、真實 `.env`、`*.log`）：

```
QRCode-Feedback-Test-<date>/
├── backend/                     # Node.js + Express + better-sqlite3（含 .env.example、package-lock.json、db/schema.sql、db/seed.js）
├── frontend/                    # React + TypeScript + Vite（含 package-lock.json、src/）
├── docs/                        # 細部設計與規格差異文件
├── README.md
├── package.json                 # 根層（僅 qrcode 依賴，非 workspace；部署時可忽略）
├── package-lock.json
├── QRCode客戶意見反饋系統_功能規格書.md
└── 部署說明_測試環境_Windows.md  # 本檔
```

> ⚠️ **關鍵**：解壓後請保持 `backend/` 與 `frontend/` 為**同層目錄**。
> 後端依 `backend/src/app.js` 解析 `../../frontend/dist` 來托管前端，目錄結構錯位會導致 UI 無法載入。

---

## 2. 目標機前置需求

### 2.1 執行環境（最底要求 vs 建議）

下表為測試機的**最底要求**（Baseline）；若同機兼任建置與運行，或預期較多併發，請採「建議」值。

| 項目 | 最底要求 | 建議 |
| --- | --- | --- |
| CPU | 1 vCPU（x64） | 2 vCPU 以上 |
| 記憶體 | 1 GB RAM | 2 GB 以上 |
| 磁碟空間 | 2 GB 可用 | 4 GB 以上（含 node_modules 與前端建置產物） |
| Node.js | 20 LTS（含 npm），`node -v` ≥ 20 | 20 LTS 最新補丁版 |
| 作業系統 | Windows 10 / 11（x64） | Windows 11 22H2 以上 |
| 對外埠號 | 3000（可由 `.env` 的 `PORT` 調整） | 反向代理時用 80 / 443 |
| 網路 / 防火牆 | 放行服務埠 | 僅開放必要埠 |

### 2.2 better-sqlite3 原生編譯環境（重要）

`backend` 依賴 `better-sqlite3`（原生 addon），`npm install` 時會在目標機**現場編譯**，
因此目標機必須具備 C/C++ 編譯工具鏈：

- 安裝 **Visual Studio Build Tools 2022**（勾選「使用 C++ 的桌面開發」）＋ **Python 3.10+**（安裝時勾選「Add to PATH」）。
- 或於 PowerShell（**管理員**）執行：`npm install -g windows-build_tools` 後重開終端。

> 若編譯失敗，常見原因：缺少 Python、VS Build Tools 未裝、或 `node` 版本與 better-sqlite3 預編譯不符。見 §7。

---

## 3. 解壓與配置

1. 將 `QRCode-Feedback-Test-<date>.zip` 複製到目標機，解壓至部署目錄（例如 `C:\qr-feedback\`）。
2. 確認解壓後 `backend/` 與 `frontend/` 同層。

3. 配置後端環境變數：

   ```powershell
   cd backend
   copy .env.example .env
   notepad .env
   ```

   建議調整項目：

   | 變數 | 測試環境建議值 | 說明 |
   | --- | --- | --- |
   | `PORT` | `3000` | 對外埠號 |
   | `JWT_SECRET` | **請改為隨機長字串** | 預設為開發值，測試環境亦應更換 |
   | `DB_PATH` | `./data/qr_feedback.sqlite` | SQLite 檔位置（相對 backend 啟動目錄）；目錄會自動建立。**建議顯式寫入此值（本機開發同理），避免與舊版遺留的 `app.db` 混淆** |
   | `JWT_EXPIRES_MINUTES` | `120` | accessToken 時長 |
   | `DEFAULT_LANG` | `zh-Hant` | 預設語系 |
   | `APP_TZ` | `Asia/Hong_Kong` | 輸出時區（DB 內存 UTC） |
   | `APP_ENV` | 不設=`local` / `test` / `production` | 執行環境標籤：頁面底部顯示「本機開發 / 測試環境 / 正式環境」，health 亦回傳 `environment`。**測試機請設 `test`**；不設則依 `NODE_ENV` 推斷（預設本機） |
   | `SMTP_HOST` | （內部 relay，如 `11.0.1.130`）| SMTP 中繼主機；**留空則信件只入庫不寄出** |
   | `SMTP_PORT` | `25` | SMTP 埠（明文，無 TLS） |
   | `SMTP_USER` / `SMTP_PASS` | 留空 | 內部 relay 通常免驗證；有需要再填 |
   | `MAIL_FROM` | `sysalert@synergis.com.hk` | 預設寄件者 |
   | `EMAIL_SCAN_INTERVAL_MS` | `15000` | 郵件佇列掃描間隔（毫秒）；設 `0` 停用寄送 |
   | `APP_ENV` | `local` | 執行環境標籤：`local` / `test` / `production`；前端每頁底部會顯示此標籤與資料庫位置，省略依 `NODE_ENV` 推斷。 |

> **電子郵件寄送（SMTP）**：Windows 同樣支援，機制與設定見 [Linux 版 §3.1](部署說明_測試環境_Linux.md)。於 `.env` 設 `SMTP_HOST` / `SMTP_PORT` / `MAIL_FROM` 等即可；並請確保該 Windows 機網路可連到 relay（注意：家用 ISP 常封鎖 outbound 25，需在公司內網 / VPN 內執行）。

---

## 4. 安裝依賴與建置

依需求，前端與 better-sqlite3 均在**目標機現場**編譯。

### 4.1 後端（含原生編譯）

```powershell
cd backend
npm ci          # 依 package-lock.json 可復現安裝；會編譯 better-sqlite3
```

> 首次 `npm ci` 較慢（需編譯原生模組）。若改用 `npm install` 亦可，但 `npm ci` 更可復現。

### 4.2 前端（建置靜態產物）

```powershell
cd ../frontend
npm ci
npm run build   # 執行 tsc -b && vite build，產出 frontend/dist
```

建置成功後，`frontend/dist/index.html` 存在，後端啟動時即會以 Mode B 托管 UI。

---

## 5. 啟動

```powershell
cd ../backend
npm start       # node src/server.js
```

啟動日誌應出現：

- `QRCode 客戶意見反饋骨架已啟動 http://localhost:3000/api/v1`
- （若 frontend/dist 存在）`serving frontend dist at <...>/frontend/dist`

**首次啟動會自動**：建立 SQLite 資料庫、執行 `db/schema.sql`、寫入種子資料
（屋苑、角色權限、演示帳號、sys_config、QR 映射），並 `ensureDefaults()` 冪等補正。

### 背景執行（選用）

Windows：於專用 PowerShell 視窗執行 `npm start` 即可；或以 `Start-Process npm -ArgumentList start` 背景化。

---

## 6. 驗證清單

依序確認：

1. **健康檢查（API）**
   ```powershell
   curl http://localhost:3000/api/v1/health
   ```
   預期：`{"status":"ok","db":true}`

2. **公眾表單（UI）**
   瀏覽器開啟 `http://<主機IP或localhost>:3000/?estate=CHNG`
   - 應顯示「頌雅苑」屋苑名稱、繁中/英文可切換；
   - 填寫並送出後出現個案編號（如 `SMS/SR/CHNG/YYMMDD001`）。

3. **後台登入（UI）**
   瀏覽器開啟 `http://<主機IP或localhost>:3000/admin/login`
   - 以 `admin / Admin@2026` 登入，應見個案列表。

   演示帳號（詳見 README）：`admin`、`cc_sup`、`cwc_sup`、`ypr_sup`、`chng_sup`、`dahf_sup`、`chng_staff`。

4. **SLA 逾期篩選**
   於桌面與手機版個案清單確認「SLA 逾期」篩選（全部 / 逾期 / 未逾期）可正常過濾；
   手機版「狀態 / 屋苑 / SLA 逾期」三下拉已併入同一行。

5. **郵件寄送（SMTP）**
   - 後台開 `http://<主機IP或localhost>:3000/admin/emails`（需 `dashboard:view` 權限，admin 具備）→ 應見「郵件發送管理」畫面，顯示「滿意度調查已發出 / 待發送 / 已送達 / 失敗」統計，可按狀態 / 範本篩選並重發。
   - 觸發滿意度調查：建案時勾選「滿意度調查同意」並填客戶 email → 審核關閉個案，約 15 秒後該列由「待發送」轉「已送達」。
   - 亦可查庫：`node dbquery.js "SELECT status, COUNT(*) c FROM email_outbox GROUP BY status"`（或用 DB Browser for SQLite 開啟 `backend/data/qr_feedback.sqlite`）。

---

## 7. 常見問題（Troubleshooting）

| 現象 | 原因 / 解法 |
| --- | --- |
| `npm ci` 卡在 better-sqlite3 編譯或報 `gyp ERR` | 缺少編譯工具鏈。Windows 裝 VS Build Tools + Python（見 §2.2）。 |
| 啟動後開首頁是空白 / 404，但 `/api/v1/health` 正常 | 前端未建置或 `frontend/dist` 與 `backend` 不同層。請回到 §4.2 `npm run build`，並確認解壓結構為同層。 |
| `EADDRINUSE` / 埠被佔用 | 修改 `backend/.env` 的 `PORT` 或更換占用程式。 |
| 時區顯示不符 | 確認 `APP_TZ=Asia/Hong_Kong`；DB 內存 UTC，對外輸出依此轉換。 |
| SPA 深鏈（如 `/admin/login`）重新整理變 404 | 後端已內建 SPA fallback（見 `app.js`），僅在 `frontend/dist` 存在時生效；請先完成 §4.2 建置。 |
| 跨域呼叫被擋 | `app.js` 已設 `Access-Control-Allow-Origin: *`（開發友好）；正式環境建議改為具體網域。 |
| 信件一直停在「待發送 (PENDING)」 | `SMTP_HOST` 未設或 relay 不可達；先確認 `.env` 與 `Test-NetConnection 11.0.1.130 -Port 25`。worker 每 15 秒掃描一次，設 `0` 會停用寄送。 |
| 信件變「失敗 (FAILED)」 | relay 拒絕（如收件網域不允許轉寄、寄件者被擋）。在 `/admin/emails` 點該列錯誤圖示看 `error`，修正後用「重發」或「重發全部失敗」補發。 |
| `npm ci` 報鎖檔不符（ERESOLVE / lockfile） | 依賴異動後須同步 `package-lock.json`；請在開發機對 `backend/`、`frontend/` 各執行一次 `npm install` 後重新封裝。 |

---

## 8. 停止、重啟與回滾

- **停止**：關閉 `npm start` 所在終端 / 結束 Node 進程（`Get-Process node | Stop-Process`）。
- **重啟**：再次 `cd backend && npm start`。
- **回滾 / 重建種子庫**：停止進程後，刪除 `backend/data/qr_feedback.sqlite*`（含 `-wal`/`-shm`），
  重新 `npm start` 即自動重建資料表並寫入種子資料（原資料會遺失，測試環境可接受）。

---

## 9. 目錄結構（部署後）

```
<部署根>/
├── backend/
│   ├── src/            # server / app / routes / services / db / scheduler / utils
│   ├── db/             # schema.sql、seed.js、mysql_schema_alignment.sql
│   ├── data/           # [執行期產生] qr_feedback.sqlite（SQLite，測試環境資料庫）
│   ├── .env            # [測試機自創] 由 .env.example 複製
│   ├── .env.example
│   ├── package.json / package-lock.json
│   └── node_modules/   # [npm ci 產生]
└── frontend/
    ├── src/
    ├── dist/           # [npm run build 產生] 後端於 Mode B 托管此目錄
    ├── package.json / package-lock.json
    └── node_modules/   # [npm ci 產生]
```

> 部署包**不含** `backend/data/`、`frontend/dist/`、`node_modules/`、`.env`；
> 上述皆由測試機依本手冊步驟於執行期產生。
