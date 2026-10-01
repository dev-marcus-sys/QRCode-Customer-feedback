# QRCode 客戶意見反饋系統 — 測試環境部署說明（Linux 版）

本說明適用於將系統**手動部署到一台 Linux 測試機**（Debian / Ubuntu / RHEL / CentOS，x64）。
依據需求，本次只產出部署封裝包與本手冊，由測試機現場安裝工具鏈並完成前端建置與啟動；
不引入 Docker / CI/CD，亦不實際執行部署動作。

部署後採用 README 的「模式 B」：**單一 Node 進程同時服務 API 與前端 UI**，資料庫使用 SQLite 檔案（零外部依賴）。

> 若目標機為 Windows，請改參考 **[`部署說明_測試環境_Windows.md`](部署說明_測試環境_Windows.md)**。
> 另有完整規劃文件 **[`QRCode客戶意見反饋系統_Linux部署計劃書.docx`](QRCode客戶意見反饋系統_Linux部署計劃書.docx)**。

---

## 1. 取得部署封裝包

在開發機（本機，通常為 Windows）執行封裝腳本，產出乾淨壓縮包：

```powershell
cd <專案根目錄>
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```

產出檔案：`deploy/QRCode-Feedback-Test-<yyyyMMdd>.zip`

> 若開發機為 Linux，亦可手動將 `backend/` 與 `frontend/`（同層）打包為 `tar.gz`，結構須與上列一致。

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
└── 部署說明_測試環境_Linux.md   # 本檔
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
| 作業系統 | Linux（x64）：Debian / Ubuntu / RHEL / CentOS | Ubuntu 22.04 LTS / Debian 12 |
| 對外埠號 | 3000（可由 `.env` 的 `PORT` 調整） | 反向代理時用 80 / 443 |
| 網路 / 防火牆 | 放行服務埠（若用反向代理則放行 80 / 443） | 僅開放必要埠 |

### 2.2 better-sqlite3 原生編譯環境（重要）

`backend` 依賴 `better-sqlite3`（原生 addon），`npm install` 時會在目標機**現場編譯**，
因此目標機必須具備 C/C++ 編譯工具鏈：

- **Debian / Ubuntu**：`sudo apt-get update && sudo apt-get install -y build-essential python3`
- **RHEL / CentOS**：`sudo yum groupinstall -y "Development Tools" && sudo yum install -y python3`

> 若編譯失敗，常見原因：缺少 Python、編譯工具鏈未裝、或 `node` 版本與 better-sqlite3 預編譯不符。見 §7。

---

## 3. 解壓與配置

1. 將 `QRCode-Feedback-Test-<date>.zip` 上傳至目標機，解壓至部署目錄（例如 `/opt/qr-feedback/`）。
2. 確認解壓後 `backend/` 與 `frontend/` 同層。

3. 配置後端環境變數：

   ```bash
   cd /opt/qr-feedback/backend
   cp .env.example .env
   vi .env
   ```

   建議調整項目：

   | 變數 | 測試環境建議值 | 說明 |
   | --- | --- | --- |
   | `PORT` | `3000` | 對外埠號（反向代理時可改為內網埠） |
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
   | `APP_ENV` | `local` | 執行環境標籤：`local`（本機開發 / localhost）｜ `test`（測試環境）｜ `production`（正式環境 / 真實環境）。前端每頁底部會顯示此標籤與資料庫位置；省略時依 `NODE_ENV` 推斷（非 production 視為本機）。 |

   > 建議將部署目錄擁有者設為專用低權限帳號（如 `qrapp`），避免以 root 運行服務。

   > 實際測試機（11.0.11.211）將 `PORT` 設為 **`3100`**（非預設 3000）；本機存取須經 §5.1 的 SSH 隧道。

### 3.1 電子郵件寄送（SMTP）

系統所有通知 / 滿意度調查問卷 / 週報，皆經由 SMTP relay **實際寄出**（不再只是寫入佇列）：

- `backend/src/services/mailer.js`：使用 `nodemailer` 連線 SMTP，`secure:false` + `ignoreTLS:true`，適用明文、無驗證的內網 relay。
- `backend/src/services/emailWorker.js`：定時掃描 `email_outbox` 中 `status='PENDING'` 的信並送出；成功寫回 `status='SENT'`（`sent_at` 記錄時間），失敗寫回 `status='FAILED'`（`error` 記錄原因）。
- `backend/src/scheduler.js` 的 `startEmailScheduler()` 在 `server.js` 啟動時一併啟動，預設每 15 秒掃描一次（由 `EMAIL_SCAN_INTERVAL_MS` 控制）。
- `nodemailer` 已納入 `backend/package.json` 依賴，`npm ci`（§4.1）會自動安裝，無須手動 `npm install nodemailer`。

> 實際測試機（11.0.11.211）的 `.env` 已設 `SMTP_HOST=11.0.1.130`、`SMTP_PORT=25`、`MAIL_FROM=sysalert@synergis.com.hk`、`EMAIL_SCAN_INTERVAL_MS=15000`。
> 若 relay 需要帳密，填寫 `SMTP_USER` / `SMTP_PASS` 並取消 `mailer.js` 中 `auth` 的註解即可。

---

## 4. 安裝依賴與建置

依需求，前端與 better-sqlite3 均在**目標機現場**編譯。

### 4.1 後端（含原生編譯）

```bash
cd /opt/qr-feedback/backend
npm ci          # 依 package-lock.json 可復現安裝；會編譯 better-sqlite3
```

> 首次 `npm ci` 較慢（需編譯原生模組）。若改用 `npm install` 亦可，但 `npm ci` 更可復現。

### 4.2 前端（建置靜態產物）

```bash
cd /opt/qr-feedback/frontend
npm ci
npm run build   # 執行 tsc -b && vite build，產出 frontend/dist
```

建置成功後，`frontend/dist/index.html` 存在，後端啟動時即會以 Mode B 托管 UI。

---

## 5. 啟動

```bash
cd /opt/qr-feedback/backend
npm start       # node src/server.js
```

啟動日誌應出現：

- `QRCode 客戶意見反饋骨架已啟動 http://localhost:3000/api/v1`
- （若 frontend/dist 存在）`serving frontend dist at <...>/frontend/dist`

**首次啟動會自動**：建立 SQLite 資料庫、執行 `db/schema.sql`、寫入種子資料
（屋苑、角色權限、演示帳號、sys_config、QR 映射），並 `ensureDefaults()` 冪等補正。

### 背景執行（推薦以 systemd / PM2 守護）

- **臨時背景**：`nohup npm start > backend.out.log 2>&1 &`
- **PM2**：`npm install -g pm2 && pm2 start "npm start" --name qr-feedback`
- **systemd（推薦，開機自啟＋崩潰重啟）**：參考下列 unit 範例

  ```ini
  # /etc/systemd/system/qr-feedback.service
  [Unit]
  Description=QRCode Feedback Service
  After=network.target

  [Service]
  Type=simple
  User=qrapp
  WorkingDirectory=/opt/qr-feedback/backend
  ExecStart=/usr/bin/npm start
  Restart=on-failure
  RestartSec=5
  Environment=NODE_ENV=production

  [Install]
  WantedBy=multi-user.target
  ```

  ```bash
  sudo systemctl daemon-reload
  sudo systemctl enable --now qr-feedback
  sudo journalctl -u qr-feedback -f      # 查看日誌
  ```

### 無 sudo 的開機自啟（cron @reboot ＋ 看門狗）

若部署帳號**無 sudo**（如共用測試機的 `devusr`），無法建立 systemd unit，也無法 `enable-linger` 讓 user service 開機自啟。
此時改用 **cron `@reboot`** 啟動，並以**每分鐘看門狗**達成崩潰自愈（皆不需 root）：

```bash
# 1) 啟動腳本（設定 PATH 後背景啟動 node）
cat > /home/devusr/qr-feedback/start.sh <<'SH'
#!/bin/sh
export PATH=/home/devusr/node20/bin:$PATH
cd /home/devusr/qr-feedback/backend
sleep 5
nohup /home/devusr/node20/bin/node src/server.js >> /home/devusr/qrfb_server.log 2>&1 &
echo $! > /home/devusr/qr-feedback/qr.pid
SH
chmod +x /home/devusr/qr-feedback/start.sh

# 2) 看門狗（服務不存在才重啟，避免重複啟動）
cat > /home/devusr/qr-feedback/watchdog.sh <<'SH'
#!/bin/sh
pgrep -f "node src/server.js" >/dev/null 2>&1 || /home/devusr/qr-feedback/start.sh
SH
chmod +x /home/devusr/qr-feedback/watchdog.sh

# 3) 註冊 crontab（開機自啟 + 每分鐘自愈）
( crontab -l 2>/dev/null | grep -v qr-feedback ; cat <<'EOF'
@reboot /home/devusr/qr-feedback/start.sh >> /home/devusr/qrfb_reboot.log 2>&1
* * * * * /home/devusr/qr-feedback/watchdog.sh >> /home/devusr/qrfb_watchdog.log 2>&1
EOF
) | crontab -
```

> 說明：本機（11.0.11.211）當前即採此方式；`cron` 須處於 `active/enabled`（Ubuntu 預設）。
> 若需**立即**套用而不等重開機，可手動執行 `start.sh` 一次；看門狗會在程序消失時自動拉起。

### 5.1 從本機遠端存取（SSH 隧道）

測試機僅開 SSH（22 映射至 `2233`），服務監聽本機 `3100`，**不對外直接開埠**；
本機瀏覽器經 SSH 本地轉發（local port forwarding）存取：

```bash
# 本機 PowerShell / 終端機（保持此視窗開啟，關掉即斷線）
ssh -N -L 18080:127.0.0.1:3100 devusr@11.0.11.211 -p 2233
```

- `18080`：你**本機**任意閒置埠（與伺服器無關；被佔用可換 `18081` / `9999` 等）。
- `127.0.0.1:3100`：通道到達伺服器後，轉發給本機服務埠，須與 `.env` 的 `PORT` 一致（本機為 `3100`）。
- 啟動後瀏覽器開：
  - 後台：`http://localhost:18080/admin/login`
  - 公眾表單：`http://localhost:18080/?estate=CHNG`
- 若 `.env` 的 `PORT` 改為其他值，只需把指令中的 `3100` 同步改掉即可。

---

## 6. 驗證清單

依序確認：

> 本機（11.0.11.211）實際埠 `3100`；本機存取請先建 §5.1 隧道，URL 改用 `localhost:18080`。以下以隧道為例。

1. **健康檢查（API）**
   ```bash
   curl http://localhost:3100/api/v1/health
   ```
   預期：`{"status":"ok","db":true}`

2. **公眾表單（UI）**
   瀏覽器開啟 `http://localhost:18080/?estate=CHNG`（或直接 `http://<主機IP>:3100/?estate=CHNG` 若主機埠已對外）
   - 應顯示「頌雅苑」屋苑名稱、繁中/英文可切換；
   - 填寫並送出後出現個案編號（如 `SMS/SR/CHNG/YYMMDD001`）。

3. **後台登入（UI）**
   瀏覽器開啟 `http://localhost:18080/admin/login`（或直接 `http://<主機IP>:3100/admin/login`）
   - 以 `admin / Admin@2026` 登入，應見個案列表。

   演示帳號（詳見 README）：`admin`、`cc_sup`、`cwc_sup`、`ypr_sup`、`chng_sup`、`dahf_sup`、`chng_staff`。

4. **SLA 逾期篩選**
   於桌面與手機版個案清單確認「SLA 逾期」篩選（全部 / 逾期 / 未逾期）可正常過濾；
   手機版「狀態 / 屋苑 / SLA 逾期」三下拉已併入同一行。

5. **郵件寄送（SMTP）**
   - 後台開 `http://localhost:18080/admin/emails`（或直接 `http://<主機IP>:3100/admin/emails`，需 `dashboard:view` 權限，admin 具備）→ 應見「郵件發送管理」畫面。
   - 畫面頂部顯示「滿意度調查已發出 / 待發送 / 已送達 / 失敗」四項統計；下方清單可按「狀態 / 範本（滿意度調查 / 滿意度提醒）」篩選，並對單封信「重發」或點「重發全部失敗」批次補發。
   - 觸發一封滿意度調查：建案時勾選「滿意度調查同意」並填客戶 email → 審核關閉個案，約 15 秒後該列由「待發送」轉「已送達」。
   - 亦可經 `dbquery.js` 檢查佇列：`node dbquery.js 'SELECT status, COUNT(*) c FROM email_outbox GROUP BY status'`。

---

## 7. 常見問題（Troubleshooting）

| 現象 | 原因 / 解法 |
| --- | --- |
| `npm ci` 卡在 better-sqlite3 編譯或報 `gyp ERR` | 缺少編譯工具鏈。Linux 裝 build-essential + python3（見 §2.2）。 |
| 啟動後開首頁是空白 / 404，但 `/api/v1/health` 正常 | 前端未建置或 `frontend/dist` 與 `backend` 不同層。請回到 §4.2 `npm run build`，並確認解壓結構為同層。 |
| `EADDRINUSE` / 埠被佔用 | 修改 `backend/.env` 的 `PORT` 或更換占用程式。 |
| 時區顯示不符 | 確認 `APP_TZ=Asia/Hong_Kong`；DB 內存 UTC，對外輸出依此轉換。 |
| SPA 深鏈（如 `/admin/login`）重新整理變 404 | 後端已內建 SPA fallback（見 `app.js`），僅在 `frontend/dist` 存在時生效；請先完成 §4.2 建置。 |
| 跨域呼叫被擋 | `app.js` 已設 `Access-Control-Allow-Origin: *`（開發友好）；正式環境建議改為具體網域。 |
| 信件一直停在「待發送 (PENDING)」 | `SMTP_HOST` 未設或 relay 不可達；先確認 `.env` 與 `telnet 11.0.1.130 25`（或 `nc -vz 11.0.1.130 25`）。worker 每 15 秒掃描一次，設 `0` 會停用寄送。 |
| 信件變「失敗 (FAILED)」 | relay 拒絕（如收件網域不允許轉寄、寄件者被擋）。在 `/admin/emails` 點該列錯誤圖示看 `error`，修正後用「重發」或「重發全部失敗」補發。 |
| `npm ci` 報鎖檔不符（ERESOLVE / lockfile） | 依賴異動後須同步 `package-lock.json`；請在開發機對 `backend/`、`frontend/` 各執行一次 `npm install` 後重新封裝。 |

---

## 8. 停止、重啟與回滾

- **停止（systemd）**：`sudo systemctl stop qr-feedback`。
- **停止（cron 方式，無 sudo）**：`kill $(ss -ltnp | grep ':3100' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)`。
- **重啟（cron 方式）**：先以上述方式停止，再 `/home/devusr/qr-feedback/start.sh`；或由看門狗於下一分鐘自動拉起。
- **停用開機自啟**：`crontab -l | grep -v qr-feedback | crontab -`。
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

---

## 附錄 A. 資料庫連線與查詢（無 sqlite3 CLI / 無 sudo）

測試機**未安裝 `sqlite3` 指令列工具，也無 sudo 可安裝**；系統使用 SQLite 檔案庫（WAL 模式），
不方便直接對外開埠。最簡便的線上查詢方式是使用 app 已安裝的 `better-sqlite3`（Node 模組），
本機已預置**唯讀**查詢腳本 `dbquery.js`：

- 資料庫檔：`/home/devusr/qr-feedback/backend/data/qr_feedback.sqlite`
  （由 `.env` 的 `DB_PATH` 決定，相對 `backend` 啟動目錄）。
- 查詢腳本：`/home/devusr/qr-feedback/backend/dbquery.js`（**唯讀**開啟，不會鎖壞線上庫）。

```bash
cd /home/devusr/qr-feedback/backend
/home/devusr/node20/bin/node dbquery.js 'SELECT name FROM sqlite_master WHERE type="table" ORDER BY name'
/home/devusr/node20/bin/node dbquery.js 'SELECT COUNT(*) AS c FROM "case"'
/home/devusr/node20/bin/node dbquery.js 'SELECT id, title, status, created_at FROM "case" ORDER BY id DESC LIMIT 5'
```

- 用法：`node dbquery.js '<SQL>'`。僅允許**唯讀**陳述（`SELECT / PRAGMA / WITH / EXPLAIN`），回傳 JSON 陣列；`UPDATE / INSERT / DELETE` 等寫入會被腳本直接拒絕（見下方警告），以免鎖壞線上庫。連線本身亦以 `readonly` 開啟作為第二道防線。
- SQL 字串建議用**單引號**包住；若內含單引號，用 `'\''` 轉義（例如 `type='\''table'\''`）。

> ⚠️ **勿對線上庫直接寫入 / DELETE**：服務正在運行，直接改庫可能與 app 互相鎖表或損壞；
> 若需改資料，請經由 API 或先停止服務（見 §8）。回滾資料庫亦請見 §8。

### 改用圖形化工具（GUI）

1. 抓取檔案回本機：`scp -P 2233 devusr@11.0.11.211:/home/devusr/qr-feedback/backend/data/qr_feedback.sqlite .`
2. 用免費的 **DB Browser for SQLite** 開啟。
   - 注意服務為 WAL 模式且在線上；抓檔時建議連同 `-wal` / `-shm` 一併抓取或先 `checkpoint`，
     否則可能漏掉尚未寫回主檔的資料。直接線上用 `dbquery.js` 看到的即時資料最準。
