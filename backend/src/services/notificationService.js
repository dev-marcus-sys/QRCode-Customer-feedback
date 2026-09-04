/**
 * 通知中心與郵件佇列（F-005/F-006/F-007，規格書 6.6）。
 * - 站內通知：notification 表（notif_type ∈ CASE/REMINDER/ESCALATION/SURVEY/SYSTEM）
 * - 電郵：email_outbox stub（SMTP 投產接入；本骨架只落庫＋log）
 * - 角色查詢：兼顧 data_scope=ALL（如 CC_SUPERVISOR）與 ESTATE（屋苑主管）
 */
'use strict';

const { dbToIso8 } = require('../utils/time');
const logger = require('../utils/logger');

const NOTIF_TYPES = ['CASE', 'REMINDER', 'ESCALATION', 'SURVEY', 'SYSTEM'];

/** 電郵佇列（SMTP stub）。回傳 outbox_id。 */
function enqueueEmail(db, { caseId, template, recipient, lang = 'zh-Hant', subject, body }) {
  if (!recipient) return null;
  const info = db.prepare(
    'INSERT INTO email_outbox (case_id, template, recipient, lang, subject, body) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(caseId || null, template, String(recipient).trim(), lang, subject, body);
  logger.info('notification', `EMAIL_QUEUE template=${template} recipient=${String(recipient).replace(/@.+/, '@***')}`);
  return info.lastInsertRowid;
}

/**
 * 站內通知（＋視乎 email 同時進郵件佇列）。
 * @param {object} opt { userId, notifType, title, body, refType, refId, email, lang }
 */
function notifyUser(db, { userId, notifType = 'CASE', title, body, refType = 'CASE', refId = null, email = true, lang = 'zh-Hant' }) {
  if (!userId) return null;
  if (!NOTIF_TYPES.includes(notifType)) notifType = 'SYSTEM';
  const u = db.prepare('SELECT user_id AS userId, email FROM sys_user WHERE user_id = ? AND is_active = 1').get(userId);
  if (!u) return null;
  const withMail = email && !!u.email;
  const info = db.prepare(
    'INSERT INTO notification (user_id, title, body, notif_type, ref_type, ref_id, channel) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(u.userId, title, body, notifType, refType, refId, withMail ? 'BOTH' : 'IN_APP');
  if (withMail) {
    enqueueEmail(db, { caseId: refType === 'CASE' ? refId : null, template: `notif_${notifType.toLowerCase()}`, recipient: u.email, lang, subject: title, body });
  }
  return info.lastInsertRowid;
}

/** 依角色＋數據範圍取得用戶（data_scope=ALL 的角色不受屋苑限制） */
function usersByRole(db, roleCode, estateCode = null) {
  if (estateCode) {
    return db.prepare(
      `SELECT DISTINCT u.user_id AS userId, u.full_name AS fullName, u.email AS email
         FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.user_id
         JOIN sys_role r ON r.role_id = ur.role_id
        WHERE r.role_code = ? AND u.is_active = 1
          AND (r.data_scope = 'ALL' OR u.estate_code = ?)`
    ).all(roleCode, estateCode);
  }
  return db.prepare(
    `SELECT DISTINCT u.user_id AS userId, u.full_name AS fullName, u.email AS email
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.user_id
       JOIN sys_role r ON r.role_id = ur.role_id
      WHERE r.role_code = ? AND u.is_active = 1`
  ).all(roleCode);
}

/**
 * 取得個案之審核主管（6.6「完結申請提交」通知對象）：
 * 屋苑主管（同屋苑）＋客服主管＋系統管理員，排除操作者本人。
 */
function reviewersForCase(db, estateCode, exceptUserId) {
  const rows = db.prepare(
    `SELECT DISTINCT u.user_id AS userId, u.full_name AS fullName, u.email AS email
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.user_id
       JOIN sys_role r ON r.role_id = ur.role_id
      WHERE u.is_active = 1 AND r.is_active = 1
        AND r.role_code IN ('ESTATE_SUPERVISOR','CC_SUPERVISOR','ADMIN')
        AND (r.data_scope = 'ALL' OR u.estate_code = ?)
        AND u.user_id <> ?`
  ).all(estateCode, exceptUserId || -1);
  return rows;
}

/** 處理人員之直屬主管（FR-005-03「本人及其直屬主管」） */
function directSupervisorOf(db, userId) {
  if (!userId) return null;
  const user = db.prepare(
    'SELECT u.user_id AS userId, u.full_name AS fullName, u.email AS email, u.estate_code AS estateCode FROM sys_user u WHERE u.user_id = ?'
  ).get(userId);
  if (!user) return null;
  const roles = db.prepare(
    `SELECT r.role_code AS roleCode
       FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.role_id
      WHERE ur.user_id = ?`
  ).all(userId).map((r) => r.roleCode);
  const want = roles.includes('CC_STAFF') ? 'CC_SUPERVISOR' : roles.includes('ESTATE_STAFF') ? 'ESTATE_SUPERVISOR' : null;
  if (!want) return null;
  const rows = usersByRole(db, want, roles.includes('ESTATE_STAFF') ? user.estateCode : null);
  const sup = rows.find((s) => s.userId !== userId) || rows[0];
  return sup || null;
}

/** 通知中心列表（僅本人） */
function listNotifications(db, userId, { unreadOnly = false, page = 1, pageSize = 20 } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (unreadOnly) where.push('is_read = 0');
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM notification WHERE ${whereSql}`).get(...params).c;
  const size = Math.min(Math.max(pageSize, 1), 100);
  const p = Math.max(page, 1);
  const rows = db.prepare(
    `SELECT notif_id AS notifId, title, body, notif_type AS notifType, ref_type AS refType,
            ref_id AS refId, is_read AS isRead, created_at AS createdAt
       FROM notification WHERE ${whereSql}
      ORDER BY notif_id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size);
  return { total, page: p, pageSize: size, items: rows.map((r) => ({ ...r, isRead: !!r.isRead, createdAt: dbToIso8(r.createdAt) })) };
}

function unreadCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notification WHERE user_id = ? AND is_read = 0').get(userId).c;
}

function assertOwnNotification(db, userId, notifId) {
  const row = db.prepare('SELECT notif_id AS notifId FROM notification WHERE notif_id = ? AND user_id = ?').get(notifId, userId);
  return !!row;
}

function markRead(db, userId, notifId) {
  if (!assertOwnNotification(db, userId, notifId)) return false;
  db.prepare('UPDATE notification SET is_read = 1 WHERE notif_id = ? AND user_id = ?').run(notifId, userId);
  return true;
}

function markAllRead(db, userId) {
  db.prepare('UPDATE notification SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

module.exports = {
  enqueueEmail,
  notifyUser,
  usersByRole,
  reviewersForCase,
  directSupervisorOf,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
};
