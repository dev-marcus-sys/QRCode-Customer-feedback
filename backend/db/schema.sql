-- ============================================================
-- QRCode 客戶意見反饋系統  F-001~F-003 骨架 Schema（SQLite）
-- 欄位語意對應規格書 7.3；型態差異請見 docs/F001-F003_細部設計.md §3.2/§9
-- 時間一律存 UTC 字串 'YYYY-MM-DD HH:mm:ss'
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sys_estate (
  estate_code    TEXT PRIMARY KEY,
  estate_name_zh TEXT NOT NULL,
  estate_name_en TEXT NOT NULL,
  company_code   TEXT NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE IF NOT EXISTS sys_user (
  user_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  estate_code          TEXT NOT NULL DEFAULT 'ALL',
  security_question    TEXT,
  security_answer_hash TEXT,
  must_change_pwd      INTEGER NOT NULL DEFAULT 1,
  pwd_changed_at       TEXT,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sys_role (
  role_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code  TEXT NOT NULL UNIQUE,
  role_name  TEXT NOT NULL,
  data_scope TEXT NOT NULL DEFAULT 'ALL' CHECK (data_scope IN ('ALL','ESTATE')),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sys_permission (
  permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
  perm_code     TEXT NOT NULL UNIQUE,
  module        TEXT NOT NULL,
  perm_name     TEXT NOT NULL,
  perm_type     TEXT NOT NULL DEFAULT 'ACTION' CHECK (perm_type IN ('MENU','ACTION','DATA')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE IF NOT EXISTS sys_role_permission (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES sys_role(role_id),
  FOREIGN KEY (permission_id) REFERENCES sys_permission(permission_id)
);

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES sys_user(user_id),
  FOREIGN KEY (role_id) REFERENCES sys_role(role_id)
);

-- ---------- 個案主表（對應 7.3.1，43 欄全量） ----------
CREATE TABLE IF NOT EXISTS `case` (
  case_id              TEXT PRIMARY KEY,
  case_source          TEXT NOT NULL DEFAULT 'QR' CHECK (case_source IN ('QR','CC','SITE','APP','EMAIL')),
  case_status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (case_status IN ('PENDING','ASSIGNED','IN_PROGRESS','WAITING','RESOLVED','CLOSED','REOPENED')),
  event_type           TEXT NOT NULL DEFAULT 'NORMAL' CHECK (event_type IN ('URGENT','NORMAL','COMPLEX','INSTANT','N/A')),
  priority             TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  intent_type          TEXT NOT NULL CHECK (intent_type IN ('COMPLAINT','FEEDBACK','INQUIRY','COMPLIMENT')),
  category_code        TEXT NOT NULL CHECK (category_code IN ('MO_SERVICE','SECURITY','MAINTENANCE','CLEANLINESS','NUISANCE','OTHER')),
  estate_code          TEXT NOT NULL,
  customer_title       TEXT NOT NULL,
  customer_name        TEXT NOT NULL,
  customer_email       TEXT,
  customer_phone       TEXT,
  customer_block       TEXT,
  customer_floor       TEXT,
  customer_unit        TEXT,
  incident_date        TEXT NOT NULL,
  incident_time        TEXT,
  comment_content      TEXT NOT NULL,
  satisfaction_consent INTEGER NOT NULL DEFAULT 1 CHECK (satisfaction_consent IN (0,1)),
  is_second_complaint  INTEGER NOT NULL DEFAULT 0 CHECK (is_second_complaint IN (0,1)),
  original_case_id     TEXT,
  assigned_to          INTEGER,
  assigned_by          INTEGER,
  assigned_at          TEXT,
  first_response_at    TEXT,
  response_sla_due     TEXT,
  response_sla_met     INTEGER CHECK (response_sla_met IN (0,1)),
  resolved_at          TEXT,
  closed_at            TEXT,
  closure_sla_due      TEXT,
  closure_sla_met      INTEGER CHECK (closure_sla_met IN (0,1)),
  handling_days        REAL,
  resolution_result    TEXT CHECK (resolution_result IN ('RESOLVED_FULL','RESOLVED_PART','UNRESOLVED','WITHDRAWN','REFERRED')),
  resolution_summary   TEXT,
  source_submission_id TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by           TEXT NOT NULL DEFAULT 'SYSTEM',
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by           TEXT,
  -- F-005 提醒/升級一次性標記（重開時重設 closure 相關；既有 DB 由 ensureDefaults 補列）
  response_reminded_at  TEXT,
  closure_reminded_at   TEXT,
  response_escalated_at TEXT,
  closure_escalated_at  TEXT,
  FOREIGN KEY (estate_code) REFERENCES sys_estate(estate_code),
  FOREIGN KEY (original_case_id) REFERENCES `case`(case_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_submission ON `case`(source_submission_id);
CREATE INDEX IF NOT EXISTS ix_status ON `case`(case_status);
CREATE INDEX IF NOT EXISTS ix_estate_status ON `case`(estate_code, case_status);
CREATE INDEX IF NOT EXISTS ix_created ON `case`(created_at);
CREATE INDEX IF NOT EXISTS ix_response_due ON `case`(response_sla_due);
CREATE INDEX IF NOT EXISTS ix_closure_due ON `case`(closure_sla_due);
CREATE INDEX IF NOT EXISTS ix_assigned ON `case`(assigned_to);
CREATE INDEX IF NOT EXISTS ix_second ON `case`(is_second_complaint, created_at);

-- ---------- 個案時間軸（對應 7.3.2） ----------
CREATE TABLE IF NOT EXISTS case_log (
  log_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT NOT NULL,
  log_type     TEXT NOT NULL CHECK (log_type IN ('CREATE','ASSIGN','REASSIGN','UPDATE','STATUS_CHANGE','RESPONSE','NOTE','RESOLVE_REQUEST','RESOLVE_APPROVE','RESOLVE_REJECT','CLOSE','REOPEN','ESCALATE','REMINDER','UPLOAD','OTHER')),
  log_content  TEXT NOT NULL,
  old_status   TEXT,
  new_status   TEXT,
  action_by    INTEGER NOT NULL DEFAULT 0,
  action_at    TEXT NOT NULL DEFAULT (datetime('now')),
  attachment_id INTEGER,
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE INDEX IF NOT EXISTS ix_log_case ON case_log(case_id, action_at);

-- ---------- 系統參數（對應 7.3.5；value 存 JSON 字串） ----------
CREATE TABLE IF NOT EXISTS sys_config (
  config_key        TEXT PRIMARY KEY,
  config_value      TEXT NOT NULL,
  config_type       TEXT NOT NULL,
  is_audit_required INTEGER NOT NULL DEFAULT 1,
  updated_by        INTEGER,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- QR Code（對應 7.3.5） ----------
CREATE TABLE IF NOT EXISTS qr_code (
  qr_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_code    TEXT NOT NULL,
  qr_type        TEXT NOT NULL DEFAULT 'FORM' CHECK (qr_type IN ('FORM','PRINT')),
  qr_content     TEXT NOT NULL,
  link_token     TEXT,                 -- 短亂數連結令牌（?estate=..&t=..）；取代明文 qr_id/sig，連結更短更易掃描
  file_url       TEXT NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  generated_by   INTEGER NOT NULL,
  generated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  valid_until    TEXT,
  FOREIGN KEY (estate_code) REFERENCES sys_estate(estate_code)
);

-- ---------- 審計日誌（對應 7.3.6；骨架僅落庫） ----------
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT NOT NULL DEFAULT 'SYSTEM',
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS ix_audit_user ON audit_log(user_id);

-- ---------- 站內通知（對應 7.3.6） ----------
CREATE TABLE IF NOT EXISTS notification (
  notif_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  notif_type TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (notif_type IN ('CASE','REMINDER','ESCALATION','SURVEY','SYSTEM')),
  ref_type   TEXT,
  ref_id     TEXT,
  channel    TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','BOTH')),
  is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES sys_user(user_id)
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notification(user_id, is_read);

-- ---------- 郵件佇列 stub（骨架新增；規格書無此表） ----------
CREATE TABLE IF NOT EXISTS email_outbox (
  outbox_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    TEXT,
  template   TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'zh-Hant',
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 個案附件（F-004 FR-004-08；MySQL 對齊見 mysql_schema_alignment.sql） ----------
CREATE TABLE IF NOT EXISTS case_log_attachment (
  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id        INTEGER NOT NULL,
  case_id       TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  file_type     TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  uploaded_by   INTEGER NOT NULL,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- ---------- AI-07 附件影像理解（docs/AI_利用方案.md §4.7） ----------
  -- OCR 文字另存於此欄；完整結果（類別／描述／信心值）寫入 ai_suggestion(attachment_insight)。
  ocr_text      TEXT NULL,
  FOREIGN KEY (log_id) REFERENCES case_log(log_id),
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE INDEX IF NOT EXISTS ix_att_log ON case_log_attachment(log_id);
CREATE INDEX IF NOT EXISTS ix_att_case ON case_log_attachment(case_id);

-- ---------- 滿意度問卷（F-007 FR-007-01~05；對齊規格書 7.3.2） ----------
CREATE TABLE IF NOT EXISTS satisfaction_survey (
  survey_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id          TEXT NOT NULL,
  survey_token     TEXT NOT NULL UNIQUE,
  lang             TEXT NOT NULL DEFAULT 'zh-Hant',
  sent_at          TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL,
  submitted_at     TEXT,
  rating_overall   INTEGER CHECK (rating_overall BETWEEN 1 AND 5),
  rating_response  INTEGER CHECK (rating_response BETWEEN 1 AND 5),
  rating_attitude  INTEGER CHECK (rating_attitude BETWEEN 1 AND 5),
  rating_resolution INTEGER CHECK (rating_resolution BETWEEN 1 AND 5),
  feedback         TEXT,
  status           TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','SUBMITTED','EXPIRED')),
  is_low_score     INTEGER NOT NULL DEFAULT 0 CHECK (is_low_score IN (0,1)),
  resend_count     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE INDEX IF NOT EXISTS ix_survey_case ON satisfaction_survey(case_id);
CREATE INDEX IF NOT EXISTS ix_survey_status ON satisfaction_survey(status, expires_at);

-- ---------- 配置變更審計（F-009 FR-009-06；action 預留建議→審批兩段語意） ----------
CREATE TABLE IF NOT EXISTS sys_config_audit (
  audit_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key  TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'UPDATE'
              CHECK (action IN ('PROPOSE','APPROVE','REJECT','UPDATE')),
  old_value   TEXT,
  new_value   TEXT,
  actor_id    INTEGER,
  actor_name  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (config_key) REFERENCES sys_config(config_key)
);
CREATE INDEX IF NOT EXISTS ix_cfg_audit_key ON sys_config_audit(config_key, created_at);

-- ---------- 自動週報（F-008 FR-008-07；每週一 09:00 產生上週摘要） ----------
CREATE TABLE IF NOT EXISTS weekly_report (
  report_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start  TEXT NOT NULL,             -- 'YYYY-MM-DD'（香港週一）
  period_end    TEXT NOT NULL,             -- 'YYYY-MM-DD'（香港週日）
  period_key    TEXT NOT NULL UNIQUE,      -- = period_start（防重鍵）
  summary_json  TEXT NOT NULL,
  anomaly_json  TEXT NOT NULL DEFAULT '[]',
  generated_by  INTEGER NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- ---------- AI-06 週報 AI 摘要（docs/AI_利用方案.md §4.6） ----------
  -- 由 summary_json + anomaly_json 之彙總數字生成敘事摘要（唔含個案原文／PII）；
  -- ai_summary 附於郵件內文頂部，並於週報查閱 API 回傳。
  ai_summary     TEXT NULL,
  ai_summary_model TEXT NULL,
  ai_summary_at  TEXT NULL
);
CREATE INDEX IF NOT EXISTS ix_weekly_period ON weekly_report(period_start DESC);

-- ---------- AI 建議／用量日誌（M0 橫向服務層；AI-01 內容分類影子模式先導） ----------
-- 見 docs/AI_利用方案.md §6.3（ai_suggestion 表）。payload 存 JSON 字串；
-- 輸入只存 de-PII 遮罩後之摘要（input_excerpt），不存原文。
CREATE TABLE IF NOT EXISTS ai_suggestion (
  suggestion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       TEXT NOT NULL,
  ai_type       TEXT NOT NULL DEFAULT 'classify',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','shown','accepted','rejected','skipped','failed')),
  payload       TEXT,
  input_excerpt TEXT,
  confidence    REAL,
  model         TEXT,
  error         TEXT,
  created_by    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by    INTEGER,
  decided_at    TEXT,
  decided_note  TEXT,
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE INDEX IF NOT EXISTS ix_ai_sug_case ON ai_suggestion(case_id, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_sug_pending ON ai_suggestion(status, created_at);

CREATE TABLE IF NOT EXISTS ai_usage_log (
  usage_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task          TEXT NOT NULL DEFAULT 'classify',
  case_id       TEXT,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  latency_ms    INTEGER,
  ok            INTEGER NOT NULL DEFAULT 1 CHECK (ok IN (0,1)),
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ai_usage_task ON ai_usage_log(task, created_at);

-- ---------- AI-08 逾期風險預警（docs/AI_利用方案.md §4.8） ----------
-- 每個未結案個案一列（最新一次掃描之結果；UPSERT 更新），已確認由 acknowledged_by/at 記錄。
-- 級一＝純統計（剩餘 SLA vs 同屋苑＋同類別歷史 P75 處理時長）；級二＝LLM 一句預警理由＋建議動作（可選）。
CREATE TABLE IF NOT EXISTS ai_case_risk (
  risk_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         TEXT NOT NULL UNIQUE,
  estate_code     TEXT NOT NULL,
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('HIGH','MEDIUM','LOW')),
  risk_score      REAL NOT NULL,
  reason          TEXT,
  suggested_action TEXT,
  model           TEXT,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at     TEXT,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE INDEX IF NOT EXISTS ix_ai_risk_level ON ai_case_risk(risk_level, computed_at);
CREATE INDEX IF NOT EXISTS ix_ai_risk_estate ON ai_case_risk(estate_code);

-- ---------- AI-02 語意防重：內嵌向量（每案一列；量小時暴力 cosine，見 docs/AI_利用方案.md §4.2） ----------
-- vector 以 JSON 陣列存放；雲端路線只送 de-PII 後文字，本地路線優先。
CREATE TABLE IF NOT EXISTS ai_embedding (
  embedding_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT NOT NULL,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  vector       TEXT NOT NULL,
  text_hash    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_ai_emb_case_model ON ai_embedding(case_id, model);
CREATE INDEX IF NOT EXISTS ix_ai_emb_case ON ai_embedding(case_id);

-- ---------- AI-05 問卷開放意見分析（docs/AI_利用方案.md §4.5） ----------
-- 每份問卷一列（survey_id UNIQUE）；topics 存 JSON 陣列。原文保留於 satisfaction_survey.feedback，不另複製。
CREATE TABLE IF NOT EXISTS ai_feedback_insight (
  insight_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id    INTEGER NOT NULL UNIQUE,
  case_id      TEXT NOT NULL,
  estate_code  TEXT NOT NULL,
  topics       TEXT NOT NULL,
  sentiment    TEXT NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  summary      TEXT,
  confidence   REAL,
  model        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (survey_id) REFERENCES satisfaction_survey(survey_id),
  FOREIGN KEY (case_id) REFERENCES `case`(case_id)
);
CREATE INDEX IF NOT EXISTS ix_ai_fb_estate ON ai_feedback_insight(estate_code, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_fb_case ON ai_feedback_insight(case_id);

-- ---------- AI-09 RAG 知識庫（docs/AI_利用方案.md §4.9） ----------
-- 知識文件主檔：入庫前須審批（status=pending_review→active）；owner＋版本治理。
CREATE TABLE IF NOT EXISTS kb_document (
  doc_id          TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  source          TEXT NOT NULL,            -- wiki 路徑／檔案名／URL（來源可追溯）
  version         TEXT NOT NULL DEFAULT '1',
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','pending_review')),
  owner           TEXT,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,                     -- 入庫時所用向量模型（檢索只比對同模型）
  ingested_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_kb_doc_status ON kb_document(status, updated_at);

-- 知識塊：按標題結構分塊；vector 以 JSON 存放（起步量細，SQLite 內暴力 cosine）。
CREATE TABLE IF NOT EXISTS kb_chunk (
  chunk_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id          TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  heading         TEXT,                      -- 該塊所屬標題（不含 # 符號）
  heading_path    TEXT,                      -- JSON 陣列：祖先標題鏈（grounding 顯示章節用）
  level           INTEGER,
  content         TEXT NOT NULL,             -- 含標題之原文塊
  embedding_model TEXT,
  vector          TEXT NOT NULL,             -- JSON 向量
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (doc_id) REFERENCES kb_document(doc_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_kb_chunk_doc ON kb_chunk(doc_id);
CREATE INDEX IF NOT EXISTS ix_kb_chunk_model ON kb_chunk(embedding_model);
