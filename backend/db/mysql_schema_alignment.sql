-- ============================================================
-- MySQL 8 對齊檔（投產參考）
--
-- 來源：《QRCode客戶意見反饋系統_功能規格書》V1.0 §7.4 DDL（MySQL 8.x）
-- 版本對照：規格書 V1.0（2026-09-03）
-- 說明：本檔為規格書 7.4 之「原樣摘錄」，不做任何改動，供投產環境與
--       本骨架 SQLite schema（backend/db/schema.sql）做型態/約束對齊。
--       本機骨架運行使用 SQLite；欄位語意一律以規格書 7.3 為準。
-- ============================================================

CREATE DATABASE IF NOT EXISTS qr_feedback
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qr_feedback;

-- ---------- 屋苑主資料 ----------
CREATE TABLE sys_estate (
  estate_code    VARCHAR(10)  NOT NULL COMMENT '屋苑代碼 PK',
  estate_name_zh VARCHAR(50)  NOT NULL,
  estate_name_en VARCHAR(100) NOT NULL,
  company_code   VARCHAR(10)  NOT NULL COMMENT '公司代碼 CRPM/PML/SMS',
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (estate_code)
) ENGINE=InnoDB COMMENT='屋苑主資料';

INSERT INTO sys_estate VALUES
 ('CWC','灣景中心','Bayview Centre','CRPM',1),
 ('YPR','攸壆路','Yau Pok Road','PML',1),
 ('CHNG','頌雅苑','Chung Nga Court','SMS',1),
 ('DAHF','大夫第','Dai Fu House','SMS',1);

-- ---------- 用戶與角色 ----------
CREATE TABLE sys_user (
  user_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  username             VARCHAR(50)  NOT NULL UNIQUE,
  password_hash        VARCHAR(100) NOT NULL COMMENT 'bcrypt',
  full_name            VARCHAR(50)  NOT NULL,
  email                VARCHAR(100) NULL,
  phone                VARCHAR(20)  NULL,
  estate_code          VARCHAR(10)  NOT NULL DEFAULT 'ALL' COMMENT '數據範圍: 屋苑代碼或 ALL',
  security_question    VARCHAR(255) NULL,
  security_answer_hash VARCHAR(255) NULL,
  must_change_pwd      TINYINT(1)   NOT NULL DEFAULT 1,
  pwd_changed_at       DATETIME     NULL,
  failed_attempts      INT          NOT NULL DEFAULT 0,
  locked_until         DATETIME     NULL,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at        DATETIME     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_estate FOREIGN KEY (estate_code) REFERENCES sys_estate(estate_code)
) ENGINE=InnoDB COMMENT='系統用戶';

CREATE TABLE sys_role (
  role_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  role_code  VARCHAR(30) NOT NULL UNIQUE,
  role_name  VARCHAR(50) NOT NULL,
  data_scope VARCHAR(10) NOT NULL DEFAULT 'ALL' COMMENT 'ALL=全屋苑, ESTATE=限所屬屋苑',
  is_active  TINYINT(1)  NOT NULL DEFAULT 1,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='角色';

CREATE TABLE sys_permission (
  permission_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  perm_code     VARCHAR(60) NOT NULL UNIQUE COMMENT '如 case:assign',
  module        VARCHAR(30) NOT NULL,
  perm_name     VARCHAR(60) NOT NULL,
  perm_type     ENUM('MENU','ACTION','DATA') NOT NULL DEFAULT 'ACTION',
  is_active     TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB COMMENT='權限項目';

CREATE TABLE sys_role_permission (
  role_id       BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES sys_role(role_id),
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES sys_permission(permission_id)
) ENGINE=InnoDB COMMENT='角色-權限';

CREATE TABLE sys_user_role (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES sys_user(user_id),
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES sys_role(role_id)
) ENGINE=InnoDB COMMENT='用戶-角色';

-- ---------- 個案主表 ----------
CREATE TABLE `case` (
  case_id             VARCHAR(50)  NOT NULL COMMENT '個案編號 PK',
  case_source         ENUM('QR','CC','SITE','APP','EMAIL') NOT NULL DEFAULT 'QR',
  case_status         ENUM('PENDING','ASSIGNED','IN_PROGRESS','WAITING','RESOLVED','CLOSED','REOPENED') NOT NULL DEFAULT 'PENDING',
  event_type          ENUM('URGENT','NORMAL','COMPLEX','INSTANT','N/A') NOT NULL DEFAULT 'NORMAL',
  priority            ENUM('HIGH','MEDIUM','LOW') NOT NULL DEFAULT 'MEDIUM',
  intent_type         ENUM('COMPLAINT','FEEDBACK','INQUIRY','COMPLIMENT') NOT NULL,
  category_code       VARCHAR(20)  NOT NULL COMMENT '事項類別: MO_SERVICE/SECURITY/MAINTENANCE/CLEANLINESS/NUISANCE/OTHER',
  estate_code         VARCHAR(10)  NOT NULL,
  customer_title      VARCHAR(10)  NOT NULL,
  customer_name       VARCHAR(50)  NOT NULL,
  customer_email      VARCHAR(100) NULL,
  customer_phone      VARCHAR(20)  NULL,
  customer_block      VARCHAR(10)  NULL,
  customer_floor      VARCHAR(10)  NULL,
  customer_unit       VARCHAR(10)  NULL,
  incident_date       DATE         NOT NULL,
  incident_time       TIME         NULL,
  comment_content     TEXT         NOT NULL COMMENT '意見內容 ≤1000 字',
  satisfaction_consent TINYINT(1)  NOT NULL DEFAULT 1,
  is_second_complaint TINYINT(1)   NOT NULL DEFAULT 0,
  original_case_id    VARCHAR(50)  NULL,
  assigned_to         BIGINT       NULL,
  assigned_by         BIGINT       NULL,
  assigned_at         DATETIME     NULL,
  first_response_at   DATETIME     NULL,
  response_sla_due    DATETIME     NULL,
  response_sla_met    TINYINT(1)   NULL,
  resolved_at         DATETIME     NULL,
  closed_at           DATETIME     NULL,
  closure_sla_due     DATETIME     NULL,
  closure_sla_met     TINYINT(1)   NULL,
  handling_days       DECIMAL(6,2) NULL,
  resolution_result   ENUM('RESOLVED_FULL','RESOLVED_PART','UNRESOLVED','WITHDRAWN','REFERRED') NULL,
  resolution_summary  TEXT         NULL,
  source_submission_id VARCHAR(64) NULL COMMENT '防重複提交去重鍵',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(20)  NOT NULL DEFAULT 'SYSTEM',
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by          VARCHAR(20)  NULL,
  PRIMARY KEY (case_id),
  UNIQUE KEY uk_submission (source_submission_id),
  KEY ix_status (case_status),
  KEY ix_estate_status (estate_code, case_status),
  KEY ix_created (created_at),
  KEY ix_response_due (response_sla_due),
  KEY ix_closure_due (closure_sla_due),
  KEY ix_assigned (assigned_to),
  KEY ix_second (is_second_complaint, created_at),
  CONSTRAINT fk_case_estate FOREIGN KEY (estate_code) REFERENCES sys_estate(estate_code),
  CONSTRAINT fk_case_assign FOREIGN KEY (assigned_to) REFERENCES sys_user(user_id),
  CONSTRAINT fk_case_original FOREIGN KEY (original_case_id) REFERENCES `case`(case_id)
) ENGINE=InnoDB COMMENT='個案主表';

-- ---------- 個案時間軸 ----------
CREATE TABLE case_log (
  log_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id      VARCHAR(50) NOT NULL,
  log_type     ENUM('CREATE','ASSIGN','REASSIGN','UPDATE','STATUS_CHANGE','RESPONSE','NOTE',
                    'RESOLVE_REQUEST','RESOLVE_APPROVE','RESOLVE_REJECT','CLOSE','REOPEN',
                    'ESCALATE','REMINDER','UPLOAD','OTHER') NOT NULL,
  log_content  TEXT        NOT NULL,
  old_status   VARCHAR(20) NULL,
  new_status   VARCHAR(20) NULL,
  action_by    BIGINT      NOT NULL DEFAULT 0 COMMENT '0=SYSTEM',
  action_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attachment_id BIGINT     NULL,
  KEY ix_log_case (case_id, action_at),
  CONSTRAINT fk_log_case FOREIGN KEY (case_id) REFERENCES `case`(case_id)
) ENGINE=InnoDB COMMENT='個案時間軸';

-- ---------- 附件 ----------
CREATE TABLE case_log_attachment (
  attachment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  log_id        BIGINT       NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  file_size     INT          NOT NULL,
  file_type     VARCHAR(50)  NOT NULL,
  storage_key   VARCHAR(500) NOT NULL COMMENT '私有儲存路徑/對象鍵',
  uploaded_by   BIGINT       NOT NULL,
  uploaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_att_log FOREIGN KEY (log_id) REFERENCES case_log(log_id)
) ENGINE=InnoDB COMMENT='個案附件';

-- ---------- 滿意度問卷 ----------
CREATE TABLE satisfaction_survey (
  survey_id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id          VARCHAR(50)  NOT NULL,
  survey_token     VARCHAR(100) NOT NULL UNIQUE,
  sent_at          DATETIME     NOT NULL,
  expires_at       DATETIME     NOT NULL,
  submitted_at     DATETIME     NULL,
  rating_overall   TINYINT      NULL COMMENT '1-5',
  rating_response  TINYINT      NULL,
  rating_attitude  TINYINT      NULL,
  rating_resolution TINYINT     NULL,
  feedback         TEXT         NULL,
  status           ENUM('SENT','SUBMITTED','EXPIRED') NOT NULL DEFAULT 'SENT',
  is_low_score     TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_survey_case FOREIGN KEY (case_id) REFERENCES `case`(case_id),
  KEY ix_survey_case (case_id)
) ENGINE=InnoDB COMMENT='滿意度問卷';

-- ---------- 通知 ----------
CREATE TABLE notification (
  notif_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT       NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NULL,
  notif_type  ENUM('CASE','REMINDER','ESCALATION','SURVEY','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  ref_type    VARCHAR(20)  NULL COMMENT 'CASE / SURVEY / CONFIG ...',
  ref_id      VARCHAR(50)  NULL,
  channel     ENUM('IN_APP','EMAIL','BOTH') NOT NULL DEFAULT 'IN_APP',
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_notif_user (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES sys_user(user_id)
) ENGINE=InnoDB COMMENT='站內通知';

-- ---------- 操作審計日誌（append-only） ----------
CREATE TABLE audit_log (
  audit_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT       NULL,
  username    VARCHAR(50)  NOT NULL DEFAULT 'SYSTEM',
  action      VARCHAR(50)  NOT NULL,
  target_type VARCHAR(30)  NULL,
  target_id   VARCHAR(50)  NULL,
  detail      JSON         NULL COMMENT '前後值',
  ip          VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_audit_created (created_at),
  KEY ix_audit_user (user_id)
) ENGINE=InnoDB COMMENT='審計日誌(唯追加)';

-- ---------- 系統參數 ----------
CREATE TABLE sys_config (
  config_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
  config_value JSON         NOT NULL,
  config_type  VARCHAR(30)  NOT NULL COMMENT 'SLA/CATEGORY/NUMBERING/NOTIFICATION/SURVEY/REPORT/FORM_STYLE',
  is_audit_required TINYINT(1) NOT NULL DEFAULT 1,
  updated_by   BIGINT       NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='系統參數';

-- ---------- QR Code ----------
CREATE TABLE qr_code (
  qr_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  estate_code   VARCHAR(10) NOT NULL,
  qr_type       ENUM('FORM','PRINT') NOT NULL DEFAULT 'FORM',
  qr_content    VARCHAR(500) NOT NULL COMMENT '指向公眾表單 URL(含 estate 參數)',
  file_url      VARCHAR(500) NOT NULL,
  is_active     TINYINT(1)  NOT NULL DEFAULT 1,
  generated_by  BIGINT      NOT NULL,
  generated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  invalidated_at DATETIME   NULL,
  valid_until    DATETIME   NULL COMMENT '有效日期；NULL = 永不自動停用，到點由排程自動停用',
  CONSTRAINT fk_qr_estate FOREIGN KEY (estate_code) REFERENCES sys_estate(estate_code)
) ENGINE=InnoDB COMMENT='QR Code 主資料';
