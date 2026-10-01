/**
 * cases + attachments 測試共用夾具。
 * 沿用 caseAction.test.js 的記憶體 DB 模式（freshDb / insertCase / user …），
 * 抽離至此供 caseLifecycle.test.js 與 attachment.test.js 共用，避免重複。
 *
 * 注意：本檔不設定 process.env.DB_PATH（freshDb 直接 new Database(':memory:')，
 * 與 HTTP 測試（initDatabase 讀 DB_PATH）互不干擾）。
 */
'use strict';
const Database = require('better-sqlite3');
const { applySchema } = require('../../src/db/connection');
const { ensureDefaults } = require('../../src/db/ensureDefaults');
const { seed } = require('../../db/seed');

/** 建立一個全新隔離的 in-memory DB（含 schema/seed/defaults） */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  seed(db);
  ensureDefaults(db);
  return db;
}

/** 取得種子用戶的 user_id */
function uid(db, username) {
  return db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get(username).user_id;
}

let seq = 100;
/**
 * 直接插入一筆個案（繞過狀態機，便於 service 層測試）。
 * overrides: { caseId, estate, status, eventType, email, assignedTo, responseDue, closureDue }
 */
function insertCase(db, overrides = {}) {
  const caseId = overrides.caseId || `T${seq++}`;
  const estate = overrides.estate || 'CHNG';
  db.prepare(
    `INSERT INTO \`case\` (case_id, case_status, event_type, priority, intent_type, category_code,
       estate_code, customer_title, customer_name, customer_email, incident_date, comment_content,
       satisfaction_consent, assigned_to, response_sla_due, closure_sla_due, created_at, updated_at)
     VALUES (?, ?, ?, 'HIGH', 'COMPLAINT', 'SECURITY', ?, '陳', '小明', ?, '2026-09-01', '測試意見內容', 1, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(
    caseId,
    overrides.status || 'PENDING',
    overrides.eventType || 'NORMAL',
    estate,
    overrides.email || 'cust@example.com',
    overrides.assignedTo || null,
    overrides.responseDue || null,
    overrides.closureDue || '2026-09-08 00:00:00'
  );
  return caseId;
}

/** 構造一個 req.user 物件（service 層直接傳入，不經路由權限中介） */
function user(userId, username, estateCode) {
  return { userId, username, estateCode };
}

/** 讀取個案時間軸（log_type / new_status / action_by） */
function notes(db, caseId) {
  return db.prepare('SELECT log_type AS logType, new_status AS newStatus, action_by AS actionBy FROM case_log WHERE case_id = ? ORDER BY log_id ASC').all(caseId);
}

/** 讀取指定用戶的通知 */
function notifs(db, userId) {
  return db.prepare('SELECT notif_type AS notifType, ref_id AS refId FROM notification WHERE user_id = ? ORDER BY notif_id DESC').all(userId);
}

module.exports = { freshDb, uid, insertCase, user, notes, notifs };
