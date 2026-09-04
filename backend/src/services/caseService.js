/**
 * 個案服務：建案、列表（篩選/分頁/排序）、詳情。
 * 建案整段（編號＋查重＋SLA＋log＋通知＋郵件佇列）於單一交易內完成。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ERR, STATUS_ACTIONS, PRIORITY, EVENT_TYPE, RESOLUTION_RESULT, REOPEN_TYPE } = require('../config/constants');
const { ApiError } = require('../middlewares/error');
const { getConfig } = require('../db/configStore');
const { generateCaseId } = require('./numbering');
const { findDuplicate, findSecondComplaint } = require('./dedupe');
const { computeEvent, computeDueDates } = require('./sla');
const { submissionKey } = require('../utils/hash');
const { toDb, now, parseDb, dbToIso8, dateRangeUtc } = require('../utils/time');
const { notifyUser, enqueueEmail, reviewersForCase } = require('./notificationService');
const logger = require('../utils/logger');

const SYSTEM_USER_ID = 0;
const CLOSED_STATUSES = ['CLOSED', 'RESOLVED'];
/** F-004 附件：私有儲存根目錄（測試可改 process.env.UPLOAD_DIR） */
function uploadsDir() {
  return process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');
}

const PRIORITY_LABEL = { HIGH: '高', MEDIUM: '中', LOW: '低' };
const RESOLUTION_LABEL = { RESOLVED_FULL: '完全解決', RESOLVED_PART: '部分解決', UNRESOLVED: '無法解決', WITHDRAWN: '客戶撤回', REFERRED: '轉介處理' };
const EVENT_LABEL = { URGENT: '緊急', NORMAL: '一般', COMPLEX: '複雜', INSTANT: '即辦', 'N/A': '不適用' };
const REOPEN_LABEL = { SECOND_COMPLAINT: '二次投訴', INSUFFICIENT_FOLLOWUP: '跟進不足' };
const ACTIONABLE_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'REOPENED'];

function isConstraintError(e) {
  return typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT');
}

function dbNow() {
  return toDb(new Date());
}

function dueMs(s) {
  const d = parseDb(s);
  return d ? d.getTime() : null;
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 原始 case 列（含屋苑名稱／處理人），不存在即 404 */
function getRawCase(db, caseId) {
  const row = db.prepare(`${SELECT_SQL} WHERE c.case_id = ?`).get(caseId);
  if (!row) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  return row;
}

function assertEstateScope(user, row) {
  if (user && user.estateCode && user.estateCode !== 'ALL' && row.estate_code !== user.estateCode) {
    throw new ApiError(ERR.DATA_SCOPE, null, 403);
  }
}

function assertState(row, allowed, actionLabel) {
  if (!allowed.includes(row.case_status)) {
    throw new ApiError(ERR.STATE_TRANSITION, `${actionLabel} 不允許由狀態 ${row.case_status} 執行（允許：${allowed.join('/')}）`);
  }
}

function userBrief(db, userId) {
  if (!userId) return null;
  return db.prepare(
    'SELECT user_id AS userId, full_name AS fullName, email AS email FROM sys_user WHERE user_id = ?'
  ).get(userId);
}

function audit(db, user, action, targetId, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    user ? user.userId : 0,
    user ? user.username || 'USER' : 'SYSTEM',
    action,
    'CASE',
    targetId,
    detail ? JSON.stringify(detail) : null
  );
}

function insertLog(db, caseId, logType, content, fromStatus, toStatus, actorId, atDb, attachmentId) {
  const info = db.prepare(
    'INSERT INTO case_log (case_id, log_type, log_content, old_status, new_status, action_by, action_at, attachment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(caseId, logType, content, fromStatus || null, toStatus || null, actorId, atDb, attachmentId || null);
  return info.lastInsertRowid;
}

/** 首次回應標記（FR-004-11）：處理人員首筆跟進 → log_type=RESPONSE 並記 first_response_at */
function markFirstResponse(db, row, actorId, atDb, logType) {
  if (logType === 'RESPONSE') return 'RESPONSE';
  if (row.first_response_at || !row.assigned_to || row.assigned_to !== actorId || !row.response_sla_due) return logType;
  const met = dueMs(row.response_sla_due) >= dueMs(atDb) ? 1 : 0;
  db.prepare('UPDATE `case` SET first_response_at = ?, response_sla_met = ? WHERE case_id = ?').run(atDb, met, row.case_id);
  return 'RESPONSE';
}

function cleanPayload(body) {
  const address = body.address && typeof body.address === 'object' ? body.address : {};
  return {
    estate: body.estate,
    title: body.title,
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    phone: String(body.phone || '').replace(/[\s\-()]/g, ''),
    incidentDate: body.incidentDate,
    incidentTime: body.incidentTime || null,
    address: {
      block: address.block || null,
      floor: address.floor || null,
      unit: address.unit || null,
    },
    categories: Array.isArray(body.categories) ? body.categories : [],
    otherText: body.otherText || '',
    content: String(body.content || '').trim(),
    surveyConsent: body.surveyConsent === true ? 1 : 0,
  };
}

function estateOf(db, estateCode) {
  const row = db.prepare(
    'SELECT estate_code AS estate_code, estate_name_zh AS estate_name_zh, estate_name_en AS estate_name_en, company_code AS company_code, is_active AS is_active FROM sys_estate WHERE estate_code = ?'
  ).get(estateCode);
  if (!row || !row.is_active) {
    throw new ApiError(ERR.ESTATE_NOT_FOUND, null, 404);
  }
  return row;
}

function notifySupervisor(db, estateCode, { caseId, title, body, template }) {
  const sup = db.prepare(
    `SELECT u.user_id AS userId, u.email
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.user_id
       JOIN sys_role r ON r.role_id = ur.role_id
      WHERE r.role_code = 'ESTATE_SUPERVISOR' AND u.estate_code = ? AND u.is_active = 1
      LIMIT 1`
  ).get(estateCode);
  if (!sup) return;
  db.prepare(
    'INSERT INTO notification (user_id, title, body, notif_type, ref_type, ref_id, channel) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(sup.userId, title, body, 'CASE', 'CASE', caseId, 'BOTH');
  if (sup.email) {
    db.prepare('INSERT INTO email_outbox (case_id, template, recipient, lang, subject, body) VALUES (?, ?, ?, ?, ?, ?)')
      .run(caseId, template, sup.email, 'zh-Hant', title, body);
  }
}

/**
 * 公眾提交建案。
 * 回傳：{ isDuplicate:true, caseId } 或 { isDuplicate:false, caseId, status, responseSlaDue, closureSlaDue, isSecondComplaint, message }
 */
function createCaseFromFeedback(db, payload, lang = 'zh-Hant') {
  const p = cleanPayload(payload);
  const estate = estateOf(db, p.estate);
  const rules = getConfig(db, 'sla.rules', {});
  const mapping = getConfig(db, 'category.event_mapping', {});

  const nowDate = now();
  const nowMs = nowDate.getTime();

  // 10 分鐘同內容重複 → 回顯原案號，不建案
  const dup = findDuplicate(db, p, nowMs);
  if (dup) {
    return { isDuplicate: true, caseId: dup.case_id };
  }

  // 24 小時二次投訴（先於建案判定，於交易內寫入標記）
  const secondRow = findSecondComplaint(db, p, nowMs);

  // 事件類型判定（二次投訴 → COMPLEX 升級）
  const { intentType, eventType } = computeEvent(
    { categories: p.categories, content: p.content, isSecondComplaint: !!secondRow },
    rules,
    mapping
  );

  let created = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      created = db.transaction(() => {
        const caseId = generateCaseId(db, estate, nowDate);
        const { responseDue, closureDue } = computeDueDates(db, nowDate, eventType);
        const isSecond = !!secondRow;
        const priority = isSecond ? 'HIGH' : 'MEDIUM';
        // category_code 為單欄位（規格書 7.3.1）：多選時以首選為主類別
        const categoryCode = p.categories[0];

        db.prepare(
          `INSERT INTO \`case\`
           (case_id, case_source, case_status, event_type, priority, intent_type, category_code,
            estate_code, customer_title, customer_name, customer_email, customer_phone,
            customer_block, customer_floor, customer_unit, incident_date, incident_time,
            comment_content, satisfaction_consent, is_second_complaint, original_case_id,
            response_sla_due, closure_sla_due, source_submission_id, created_at, updated_at)
           VALUES (?, 'QR', 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          caseId, eventType, priority, intentType, categoryCode,
          p.estate, p.title, p.name, p.email || null, p.phone || null,
          p.address.block || null, p.address.floor || null, p.address.unit || null,
          p.incidentDate, p.incidentTime,
          p.content, p.surveyConsent, isSecond ? 1 : 0, secondRow ? secondRow.case_id : null,
          responseDue, closureDue, submissionKey(p, nowMs), toDb(nowDate), toDb(nowDate)
        );

        // 首筆時間軸（FR-002-07）
        const summary = `系統自動建立個案（來源 QR）。客戶：${p.title} ${p.name}；主類別：${categoryCode}；事件類型：${eventType}。內容摘要：${p.content.slice(0, 200)}`;
        db.prepare(
          'INSERT INTO case_log (case_id, log_type, log_content, old_status, new_status, action_by, action_at) VALUES (?, ?, ?, NULL, ?, ?, ?)'
        ).run(caseId, 'CREATE', summary, 'PENDING', SYSTEM_USER_ID, toDb(nowDate));

        // 確認電郵佇列（FR-001-07，SMTP stub）
        if (p.email) {
          const promiseZh = getConfig(db, 'form.promise', {})[lang === 'en' ? 'en' : 'zh'];
          const subject = lang === 'en'
            ? `[${estate.estate_name_en}] Feedback Acknowledged - Case ${caseId}`
            : `[${estate.estate_name_zh}] 客戶意見反饋已收悉 — 個案編號 ${caseId}`;
          const body = `caseId: ${caseId}\ncategory: ${categoryCode}\npromise: ${promiseZh}`;
          db.prepare('INSERT INTO email_outbox (case_id, template, recipient, lang, subject, body) VALUES (?, ?, ?, ?, ?, ?)')
            .run(caseId, 'feedback_confirmation', p.email, lang, subject, body);
        }

        // 建案通知屋苑主管（6.6 個案建立 → 站內＋電郵）
        const title = `新增個案 ${caseId}`;
        const body = `屋苑 ${estate.estate_name_zh} 收到客戶意見（${categoryCode}），請於待辦處理。`;
        notifySupervisor(db, p.estate, { caseId, title, body, template: 'case_notify_supervisor' });

        // 審計 stub
        db.prepare('INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
          .run(SYSTEM_USER_ID, 'SYSTEM', 'CASE_CREATE', 'CASE', caseId, JSON.stringify({ estate: p.estate, eventType, second: isSecond }));

        return { caseId, responseDue, closureDue };
      })();
      break;
    } catch (e) {
      if (isConstraintError(e) && attempt < 2) {
        logger.warn('caseService', `caseId 衝突重試 ${attempt + 1}`);
        continue;
      }
      throw e;
    }
  }

  const promise = getConfig(db, 'form.promise', {})[lang === 'en' ? 'en' : 'zh'];
  logger.info('caseService', `CASE_CREATE ${created.caseId} eventType=${eventType}`);
  return {
    isDuplicate: false,
    caseId: created.caseId,
    status: 'PENDING',
    eventType,
    responseSlaDue: dbToIso8(created.responseDue),
    closureSlaDue: dbToIso8(created.closureDue),
    isSecondComplaint: !!secondRow,
    originalCaseId: secondRow ? secondRow.case_id : null,
    message: promise || 'success',
  };
}

const SORT_COLUMNS = {
  caseId: { col: 'c.case_id', nullsLast: false },
  createdAt: { col: 'c.created_at', nullsLast: false },
  responseSlaDue: { col: 'c.response_sla_due', nullsLast: true },
  closureSlaDue: { col: 'c.closure_sla_due', nullsLast: true },
};

/** 解析篩選 Query → SQL 片段 */
function parseCaseFilters(query, user) {
  const where = [];
  const params = [];
  const q = query || {};

  if (user && user.estateCode && user.estateCode !== 'ALL') {
    where.push('c.estate_code = ?');
    params.push(user.estateCode);
  }
  if (q.estate) {
    where.push('c.estate_code = ?');
    params.push(q.estate);
  }
  if (q.category) {
    where.push('c.category_code = ?');
    params.push(q.category);
  }
  if (q.status) {
    where.push('c.case_status = ?');
    params.push(q.status);
  }
  if (q.eventType) {
    where.push('c.event_type = ?');
    params.push(q.eventType);
  }
  if (q.priority) {
    where.push('c.priority = ?');
    params.push(q.priority);
  }
  if (q.assignedTo === 'me' && user) {
    where.push('c.assigned_to = ?');
    params.push(user.userId);
  } else if (q.assignedTo && q.assignedTo !== 'all' && q.assignedTo !== '') {
    where.push('c.assigned_to = ?');
    params.push(Number(q.assignedTo));
  }
  if (q.secondComplaint === '1' || q.secondComplaint === 'true') {
    where.push('c.is_second_complaint = 1');
  } else if (q.secondComplaint === '0' || q.secondComplaint === 'false') {
    where.push('c.is_second_complaint = 0');
  }
  const from = dateRangeUtc(q.dateFrom, false);
  const to = dateRangeUtc(q.dateTo, true);
  if (from) {
    where.push('c.created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('c.created_at <= ?');
    params.push(to);
  }
  if (q.keyword) {
    const kw = `%${q.keyword}%`;
    where.push('(c.case_id LIKE ? OR c.customer_name LIKE ? OR c.comment_content LIKE ?)');
    params.push(kw, kw, kw);
  }

  const sortBy = SORT_COLUMNS[q.sortBy] || SORT_COLUMNS.createdAt;
  const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
  let orderSql = `${sortBy.col} ${dir}, c.case_id`;
  if (sortBy.nullsLast) orderSql = `(c.response_sla_due IS NULL) ASC, ${sortBy.col} ${dir}, c.case_id`;

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params, orderSql };
}

const SELECT_SQL = `
  SELECT c.case_id AS case_id, c.case_source AS case_source, c.case_status AS case_status,
         c.event_type AS event_type, c.priority AS priority, c.intent_type AS intent_type,
         c.category_code AS category_code, c.estate_code AS estate_code,
         e.estate_name_zh AS estate_name_zh, e.estate_name_en AS estate_name_en,
         c.customer_title AS customer_title, c.customer_name AS customer_name,
         c.customer_email AS customer_email, c.customer_phone AS customer_phone,
         c.customer_block AS customer_block, c.customer_floor AS customer_floor,
         c.customer_unit AS customer_unit, c.incident_date AS incident_date,
         c.incident_time AS incident_time, c.comment_content AS comment_content,
         c.satisfaction_consent AS satisfaction_consent,
         c.is_second_complaint AS is_second_complaint,
         c.original_case_id AS original_case_id,
         c.assigned_to AS assigned_to, u.full_name AS assigned_name,
         c.response_sla_due AS response_sla_due, c.closure_sla_due AS closure_sla_due,
         c.response_sla_met AS response_sla_met, c.closed_at AS closed_at,
         c.closure_sla_met AS closure_sla_met, c.handling_days AS handling_days,
         c.first_response_at AS first_response_at, c.resolution_result AS resolution_result,
         c.resolution_summary AS resolution_summary,
         c.created_at AS created_at, c.updated_at AS updated_at
    FROM \`case\` c
    JOIN sys_estate e ON e.estate_code = c.estate_code
    LEFT JOIN sys_user u ON u.user_id = c.assigned_to`;

function rowToDto(row) {
  const overdue = !CLOSED_STATUSES.includes(row.case_status) && (
    (row.response_sla_due && !row.first_response_at && dueMs(row.response_sla_due) < Date.now()) ||
    (row.closure_sla_due && !row.closed_at && dueMs(row.closure_sla_due) < Date.now())
  );
  return {
    caseId: row.case_id,
    caseSource: row.case_source,
    caseStatus: row.case_status,
    eventType: row.event_type,
    priority: row.priority,
    intentType: row.intent_type,
    categoryCode: row.category_code,
    estateCode: row.estate_code,
    estateNameZh: row.estate_name_zh,
    estateNameEn: row.estate_name_en,
    customerTitle: row.customer_title,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    address: {
      block: row.customer_block,
      floor: row.customer_floor,
      unit: row.customer_unit,
    },
    incidentDate: row.incident_date,
    incidentTime: row.incident_time,
    commentContent: row.comment_content,
    satisfactionConsent: !!row.satisfaction_consent,
    isSecondComplaint: !!row.is_second_complaint,
    originalCaseId: row.original_case_id,
    assignedTo: row.assigned_to ? { id: row.assigned_to, fullName: row.assigned_name || '' } : null,
    responseSlaDue: dbToIso8(row.response_sla_due),
    closureSlaDue: dbToIso8(row.closure_sla_due),
    slaOverdue: overdue,
    responseSlaMet: row.response_sla_met,
    closedAt: dbToIso8(row.closed_at),
    closureSlaMet: row.closure_sla_met,
    handlingDays: row.handling_days,
    firstResponseAt: dbToIso8(row.first_response_at),
    createdAt: dbToIso8(row.created_at),
    updatedAt: dbToIso8(row.updated_at),
  };
}

/** 個案列表（篩選＋排序＋分頁）。 */
function listCases(db, filters, user, { page = 1, pageSize = 20, noPaging = false } = {}) {
  const { whereSql, params, orderSql } = parseCaseFilters(filters, user);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM \`case\` c ${whereSql}`).get(...params).c;
  const size = Math.min(Math.max(pageSize, 1), 100);
  const p = Math.max(page, 1);
  const limitSql = noPaging ? ' LIMIT 5000' : ' LIMIT ? OFFSET ?';
  const qParams = noPaging ? params : [...params, size, (p - 1) * size];
  const rows = db.prepare(`${SELECT_SQL} ${whereSql} ORDER BY ${orderSql} ${limitSql}`).all(...qParams);
  return { total, page: p, pageSize: size, items: rows.map(rowToDto) };
}

/** 個案詳情（含時間軸與 allowedActions）。 */
function getCaseDetail(db, caseId, user) {
  const row = db.prepare(`${SELECT_SQL} WHERE c.case_id = ?`).get(caseId);
  if (!row) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  if (user && user.estateCode && user.estateCode !== 'ALL' && row.estate_code !== user.estateCode) {
    throw new ApiError(ERR.DATA_SCOPE, null, 403);
  }
  const timeline = db.prepare(
    `SELECT l.log_id AS logId, l.case_id AS caseId, l.log_type AS logType, l.log_content AS logContent,
            l.old_status AS oldStatus, l.new_status AS newStatus, l.action_by AS actionBy,
            u.full_name AS actionByName, l.action_at AS actionAt,
            a.attachment_id AS attachmentId, a.file_name AS attachmentName, a.file_size AS attachmentSize
       FROM case_log l
       LEFT JOIN sys_user u ON u.user_id = l.action_by
       LEFT JOIN case_log_attachment a ON a.log_id = l.log_id
      WHERE l.case_id = ? ORDER BY l.log_id ASC`
  ).all(caseId).map((l) => ({
    ...l,
    actionByName: l.actionBy === 0 ? 'SYSTEM' : l.actionByName,
    actionAt: dbToIso8(l.actionAt),
  }));
  const surveyRow = db.prepare(
    `SELECT survey_id AS surveyId, case_id AS caseId, status, lang, sent_at AS sentAt, submitted_at AS submittedAt,
            expires_at AS expiresAt, rating_overall AS ratingOverall, rating_response AS ratingResponse,
            rating_attitude AS ratingAttitude, rating_resolution AS ratingResolution,
            feedback, is_low_score AS isLowScore, resend_count AS resendCount
       FROM satisfaction_survey WHERE case_id = ? ORDER BY survey_id DESC LIMIT 1`
  ).get(caseId);
  const survey = surveyRow
    ? {
        surveyId: surveyRow.surveyId,
        status: surveyRow.status,
        lang: surveyRow.lang,
        sentAt: dbToIso8(surveyRow.sentAt),
        submittedAt: dbToIso8(surveyRow.submittedAt),
        expiresAt: dbToIso8(surveyRow.expiresAt),
        ratings: surveyRow.status === 'SUBMITTED'
          ? { overall: surveyRow.ratingOverall, response: surveyRow.ratingResponse, attitude: surveyRow.ratingAttitude, resolution: surveyRow.ratingResolution }
          : null,
        average: surveyRow.status === 'SUBMITTED'
          ? Math.round(((surveyRow.ratingOverall + surveyRow.ratingResponse + surveyRow.ratingAttitude + surveyRow.ratingResolution) / 4) * 10) / 10
          : null,
        feedback: surveyRow.feedback,
        isLowScore: !!surveyRow.isLowScore,
        resendCount: surveyRow.resendCount,
      }
    : null;
  const allowedActions = (STATUS_ACTIONS[row.case_status] || []).map((a) => ({ action: a.action, toStatus: a.toStatus }));
  return { case: rowToDto(row), timeline, survey, allowedActions };
}

/* ============================================================
 * F-004 分派與跟進 / F-006 完結與回饋 — 個案動作
 * 權限由路由層以 requirePerm 把關，此處只負責狀態機／範圍／資料校驗。
 * ============================================================ */

/** 分派候選人（FR-004-02：限定該屋苑用戶＋可處理角色）＋預設建議（屋苑主管） */
function getAssignees(db, caseId, user) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  const rows = db.prepare(
    `SELECT u.user_id AS userId, u.full_name AS fullName, u.email AS email, u.estate_code AS estateCode,
            (SELECT GROUP_CONCAT(r2.role_name) FROM sys_user_role ur2
               JOIN sys_role r2 ON r2.role_id = ur2.role_id
              WHERE ur2.user_id = u.user_id) AS roleNames
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.user_id
       JOIN sys_role r ON r.role_id = ur.role_id
      WHERE u.is_active = 1 AND r.is_active = 1
        AND r.role_code IN ('ESTATE_STAFF','ESTATE_SUPERVISOR','CC_STAFF')
        AND (r.data_scope = 'ALL' OR u.estate_code = ?)
      GROUP BY u.user_id
      ORDER BY (SELECT COUNT(*) FROM sys_user_role ur3
                  JOIN sys_role r3 ON r3.role_id = ur3.role_id
                 WHERE ur3.user_id = u.user_id AND r3.role_code = 'ESTATE_SUPERVISOR') DESC, u.full_name`
  ).all(row.estate_code);
  const supRow = rows.find((x) => String(x.roleNames || '').includes('主管')) || null;
  return {
    caseId,
    estateCode: row.estate_code,
    suggestedUserId: supRow ? supRow.userId : rows.length ? rows[0].userId : null,
    assignableUsers: rows,
  };
}

/** 內部：狀態跳轉（狀態不變動的表達：log_type=STATUS_CHANGE / NOTE / UPDATE） */
function statusChange(db, row, user, to, logType, content, extraSets) {
  const atDb = dbNow();
  const sets = ["case_status = ?", 'updated_at = ?'];
  const vals = [to, atDb];
  for (const col of Object.keys(extraSets || {})) {
    sets.push(`${col} = ?`);
    vals.push(extraSets[col]);
  }
  db.prepare(`UPDATE \`case\` SET ${sets.join(', ')} WHERE case_id = ?`).run(...vals, row.case_id);
  insertLog(db, row.case_id, logType, content, row.case_status, to, user.userId, atDb, null);
}

/** 內部：指派落庫（分派/轉派共用；kind: 'assign' | 'reassign'） */
function doAssign(db, row, assignee, user, opts, kind) {
  const atDb = dbNow();
  const parts = ["case_status = 'ASSIGNED'", 'assigned_to = ?', 'assigned_by = ?', 'assigned_at = ?', 'updated_at = ?'];
  const vals = [assignee.userId, user.userId, atDb, atDb];
  if (opts.priority && PRIORITY.includes(opts.priority) && opts.priority !== row.priority) {
    parts.push('priority = ?');
    vals.push(opts.priority);
  }
  if (opts.eventType && EVENT_TYPE.includes(opts.eventType) && opts.eventType !== row.event_type) {
    parts.push('event_type = ?', 'response_sla_due = ?');
    vals.push(opts.eventType, computeDueDates(db, new Date(), opts.eventType).responseDue);
  }
  db.prepare(`UPDATE \`case\` SET ${parts.join(', ')} WHERE case_id = ?`).run(...vals, row.case_id);
  const notes = [];
  if (opts.priority && opts.priority !== row.priority) notes.push(`優先級改為 ${PRIORITY_LABEL[opts.priority] || opts.priority}`);
  if (opts.eventType && opts.eventType !== row.event_type) notes.push(`事件類型改為 ${EVENT_LABEL[opts.eventType] || opts.eventType}`);
  if (opts.note) notes.push(`說明：${opts.note}`);
  const content = kind === 'reassign'
    ? `轉派自 ${(row.assigned_name && row.assigned_name !== assignee.fullName ? `${row.assigned_name} ` : '')}予 ${assignee.fullName}${notes.length ? `；${notes.join('；')}` : ''}`
    : `分派予 ${assignee.fullName}${notes.length ? `；${notes.join('；')}` : ''}`;
  insertLog(db, row.case_id, kind === 'reassign' ? 'REASSIGN' : 'ASSIGN', content, row.case_status, 'ASSIGNED', user.userId, atDb, null);
  const verb = kind === 'reassign' ? '轉派' : '分派';
  notifyUser(db, {
    userId: assignee.userId,
    notifType: 'CASE',
    title: `${verb}個案 ${row.case_id}`,
    body: `屋苑 ${row.estate_name_zh} 個案 ${row.case_id}（${row.intent_type}／${EVENT_LABEL[row.event_type] || row.event_type}）已${verb}予你處理。`,
    refId: row.case_id,
  });
  if (kind === 'reassign' && row.assigned_to && row.assigned_to !== assignee.userId) {
    notifyUser(db, {
      userId: row.assigned_to,
      notifType: 'CASE',
      title: `個案 ${row.case_id} 已轉派`,
      body: `你負責的個案 ${row.case_id} 已轉派予 ${assignee.fullName}。`,
      refId: row.case_id,
    });
  }
  audit(db, user, kind === 'reassign' ? 'CASE_REASSIGN' : 'CASE_ASSIGN', row.case_id, { assigneeId: assignee.userId, from: row.case_status });
  logger.info('caseService', `${kind === 'reassign' ? 'REASSIGN' : 'ASSIGN'} ${row.case_id} → ${assignee.userId} by ${user.username}`);
}

/** 分派（PENDING / REOPENED → ASSIGNED；FR-004-01/02/03） */
function assignCase(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['PENDING', 'REOPENED'], '分派');
  if (!body.assigneeId) throw new ApiError(ERR.VALIDATION, '請選擇處理人員');
  const assignee = userBrief(db, Number(body.assigneeId));
  if (!assignee) throw new ApiError(ERR.VALIDATION, '處理人員不存在');
  db.transaction(() => doAssign(db, row, assignee, user, body, 'assign'))();
  return { caseId: row.case_id, caseStatus: 'ASSIGNED', assigneeId: assignee.userId };
}

/** 轉派（ASSIGNED / IN_PROGRESS / WAITING → ASSIGNED；原因必填） */
function reassignCase(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['ASSIGNED', 'IN_PROGRESS', 'WAITING'], '轉派');
  if (!body.assigneeId) throw new ApiError(ERR.VALIDATION, '請選擇新的處理人員');
  const assignee = userBrief(db, Number(body.assigneeId));
  if (!assignee) throw new ApiError(ERR.VALIDATION, '新處理人員不存在');
  if (Number(body.assigneeId) === row.assigned_to) throw new ApiError(ERR.VALIDATION, '新處理人員與現任處理人員相同');
  if (!String(body.reason || '').trim()) throw new ApiError(ERR.VALIDATION, '請填寫轉派原因');
  db.transaction(() => doAssign(db, row, assignee, user, { ...body, reason: body.reason, note: `轉派原因：${body.reason}${body.note ? `；${body.note}` : ''}` }, 'reassign'))();
  return { caseId: row.case_id, caseStatus: 'ASSIGNED', assigneeId: assignee.userId };
}

/** 開始處理（ASSIGNED / REOPENED → IN_PROGRESS） */
function startCase(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['ASSIGNED', 'REOPENED'], '開始處理');
  const content = body.note ? `開始處理：${body.note}` : '開始處理';
  db.transaction(() => {
    statusChange(db, row, user, 'IN_PROGRESS', 'STATUS_CHANGE', content, {});
    audit(db, user, 'CASE_START', row.case_id, { from: row.case_status });
  })();
  return { caseId: row.case_id, caseStatus: 'IN_PROGRESS' };
}

/** 等候客戶回覆（IN_PROGRESS → WAITING） */
function setWaitingCase(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['IN_PROGRESS'], '轉等候客戶回覆');
  db.transaction(() => {
    statusChange(db, row, user, 'WAITING', 'STATUS_CHANGE', `等候客戶回覆：${body.note ? body.note : '—'}`, {});
    audit(db, user, 'CASE_WAITING', row.case_id, {});
  })();
  return { caseId: row.case_id, caseStatus: 'WAITING' };
}

/** 恢復處理（WAITING → IN_PROGRESS） */
function resumeCase(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['WAITING'], '恢復處理');
  const atDb = dbNow();
  db.transaction(() => {
    statusChange(db, row, user, 'IN_PROGRESS', 'STATUS_CHANGE', body.note ? `恢復處理：${body.note}` : '恢復處理', {});
    if (body.note && !row.first_response_at && row.assigned_to === user.userId) {
      const met = dueMs(row.response_sla_due) >= dueMs(atDb) ? 1 : 0;
      db.prepare('UPDATE `case` SET first_response_at = ?, response_sla_met = ? WHERE case_id = ?').run(atDb, met, row.case_id);
      insertLog(db, row.case_id, 'RESPONSE', body.note, row.case_status, 'IN_PROGRESS', user.userId, atDb, null);
    }
    audit(db, user, 'CASE_RESUME', row.case_id, {});
  })();
  return { caseId: row.case_id, caseStatus: 'IN_PROGRESS' };
}

/** 跟進記錄（附註；首筆由處理人員寫入 → RESPONSE 並記 first_response_at） */
function addCaseNote(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ACTIONABLE_STATUSES, '跟進記錄');
  const content = String(body.content || '').trim();
  if (!content) throw new ApiError(ERR.VALIDATION, '請填寫跟進內容');
  const atDb = dbNow();
  let logType = 'NOTE';
  db.transaction(() => {
    logType = markFirstResponse(db, row, user.userId, atDb, 'NOTE');
    insertLog(db, row.case_id, logType, content, row.case_status, row.case_status, user.userId, atDb, null);
    audit(db, user, logType === 'RESPONSE' ? 'CASE_FIRST_RESPONSE' : 'CASE_NOTE', row.case_id, {});
  })();
  return { caseId: row.case_id, logType };
}

/** 調整優先級（更新 → 時間軸 UPDATE） */
function changeCasePriority(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  if (row.case_status === 'CLOSED') throw new ApiError(ERR.STATE_TRANSITION, '已關閉個案不可調整優先級');
  if (!body.priority || !PRIORITY.includes(body.priority)) throw new ApiError(ERR.VALIDATION, '優先級必須為 HIGH/MEDIUM/LOW');
  const atDb = dbNow();
  db.transaction(() => {
    db.prepare('UPDATE `case` SET priority = ?, updated_at = ? WHERE case_id = ?').run(body.priority, atDb, row.case_id);
    insertLog(db, row.case_id, 'UPDATE', `優先級由 ${PRIORITY_LABEL[row.priority] || row.priority} 調整為 ${PRIORITY_LABEL[body.priority]}`, row.case_status, row.case_status, user.userId, atDb, null);
    audit(db, user, 'CASE_PRIORITY', row.case_id, { from: row.priority, to: body.priority });
  })();
  return { caseId: row.case_id, priority: body.priority };
}

/** 完結申請（IN_PROGRESS / WAITING → RESOLVED；FR-006-01/02） */
function submitResolution(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['IN_PROGRESS', 'WAITING'], '完結申請');
  const result = body.result;
  if (!RESOLUTION_RESULT.includes(result)) throw new ApiError(ERR.VALIDATION, '請選擇完結結果');
  const summary = String(body.summary || '').trim();
  if (!summary) throw new ApiError(ERR.VALIDATION, '請填寫處理內容摘要');
  if (result === 'UNRESOLVED' && !String(body.reason || '').trim()) {
    throw new ApiError(ERR.VALIDATION, '「無法解決」必須填寫原因');
  }
  const atDb = dbNow();
  const extra = [];
  const vals = [];
  if (body.reason && String(body.reason).trim()) { extra.push('resolution_reason_tmp'); }
  const summaryText = body.reason && String(body.reason).trim()
    ? `（無法解決原因：${String(body.reason).trim()}）${summary}`
    : summary;
  db.transaction(() => {
    db.prepare(
      'UPDATE `case` SET case_status = ?, resolution_result = ?, resolution_summary = ?, resolved_at = ?, updated_at = ? WHERE case_id = ?'
    ).run('RESOLVED', result, summaryText, atDb, atDb, row.case_id);
    const customerReply = body.customerReply ? `\n客戶回覆：${body.customerReply}` : '';
    const completionDate = body.completionDate ? `\n處理完成日期：${body.completionDate}` : '';
    insertLog(db, row.case_id, 'RESOLVE_REQUEST', `申請完結（${RESOLUTION_LABEL[result] || result}）：${summaryText}${customerReply}${completionDate}`, row.case_status, 'RESOLVED', user.userId, atDb, null);
    audit(db, user, 'CASE_RESOLVE_REQUEST', row.case_id, { result, summary: summaryText });
  })();
  // 通知審核主管（6.6：屋苑主管／客服主管／管理員）
  const reviewers = reviewersForCase(db, row.estate_code, user.userId);
  for (const r of reviewers) {
    notifyUser(db, {
      userId: r.userId,
      notifType: 'CASE',
      title: `個案 ${row.case_id} 完結申請待審核`,
      body: `屋苑 ${row.estate_name_zh} 個案 ${row.case_id} 已提交完結申請（${RESOLUTION_LABEL[result] || result}），請審核。`,
      refId: row.case_id,
    });
  }
  return { caseId: row.case_id, caseStatus: 'RESOLVED', resolutionResult: result };
}

/** 完結審核通過（RESOLVED → CLOSED；FR-006-03/04/05 + F-007 問卷觸發） */
function approveResolution(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['RESOLVED'], '審核通過');
  const atDb = dbNow();
  const atMs = dueMs(atDb);
  const closedMs = dueMs(atDb);
  const createdMs = dueMs(row.created_at);
  const handlingDays = createdMs ? Math.round(((closedMs - createdMs) / 86400000) * 100) / 100 : null;
  const closureSlaMet = row.closure_sla_due ? (closedMs <= dueMs(row.closure_sla_due) ? 1 : 0) : null;
  db.transaction(() => {
    db.prepare(
      'UPDATE `case` SET case_status = ?, closed_at = ?, closure_sla_met = ?, handling_days = ?, updated_at = ? WHERE case_id = ?'
    ).run('CLOSED', atDb, closureSlaMet, handlingDays, atDb, row.case_id);
    const note = body.note ? `\n審核意見：${body.note}` : '';
    insertLog(db, row.case_id, 'RESOLVE_APPROVE', `審核通過並關閉（處理 ${handlingDays} 天${closureSlaMet === 1 ? '，於關閉期限內' : closureSlaMet === 0 ? '，超出關閉期限' : ''}）${note}`, 'RESOLVED', 'CLOSED', user.userId, atDb, null);
    audit(db, user, 'CASE_APPROVE_CLOSE', row.case_id, { handlingDays, closureSlaMet });
  })();
  if (row.assigned_to) {
    notifyUser(db, {
      userId: row.assigned_to,
      notifType: 'CASE',
      title: `個案 ${row.case_id} 已關閉`,
      body: `你處理的個案 ${row.case_id} 已通過審核並關閉（處理 ${handlingDays} 天）。`,
      refId: row.case_id,
    });
  }
  // 感謝電郵（FR-006-05）＋ 滿意度問卷（F-007）— SMTP stub 落庫
  let survey = null;
  if (row.customer_email) {
    enqueueEmail(db, {
      caseId: row.case_id,
      template: 'case_closed_thanks',
      recipient: row.customer_email,
      lang: 'zh-Hant',
      subject: `[${row.estate_name_zh}] 您的意見已處理完畢 — 個案 ${row.case_id}`,
      body: `感謝您的意見反饋。\n個案編號：${row.case_id}\n處理結果：${RESOLUTION_LABEL[row.resolution_result] || row.resolution_result}\n摘要：${row.resolution_summary || ''}`,
    });
    if (row.satisfaction_consent) {
      // eslint-disable-next-line global-require
      const surveyService = require('./surveyService');
      survey = surveyService.createSurveyOnClose(db, row, { origin: body.origin || '' });
    }
  }
  return { caseId: row.case_id, caseStatus: 'CLOSED', handlingDays, closureSlaMet, survey };
}

/** 完結審核駁回（RESOLVED → IN_PROGRESS；原因必填） */
function rejectResolution(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['RESOLVED'], '審核駁回');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new ApiError(ERR.VALIDATION, '請填寫駁回原因');
  const atDb = dbNow();
  db.transaction(() => {
    db.prepare('UPDATE `case` SET case_status = ?, updated_at = ? WHERE case_id = ?').run('IN_PROGRESS', atDb, row.case_id);
    insertLog(db, row.case_id, 'RESOLVE_REJECT', `審核未通過，退回處理：${reason}`, 'RESOLVED', 'IN_PROGRESS', user.userId, atDb, null);
    audit(db, user, 'CASE_REJECT', row.case_id, { reason });
  })();
  if (row.assigned_to) {
    notifyUser(db, {
      userId: row.assigned_to,
      notifType: 'CASE',
      title: `個案 ${row.case_id} 完結申請被駁回`,
      body: `個案 ${row.case_id} 的完結申請未獲通過，原因：${reason}。請繼續處理。`,
      refId: row.case_id,
    });
  }
  return { caseId: row.case_id, caseStatus: 'IN_PROGRESS' };
}

/** 授權重開（CLOSED → REOPENED；FR-006-06/07；重算關閉期限並重設標記） */
function reopenCase(db, caseId, user, body) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ['CLOSED'], '重新開啟');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new ApiError(ERR.VALIDATION, '請填寫重開原因');
  const reopenType = REOPEN_TYPE.includes(body.reopenType) ? body.reopenType : 'SECOND_COMPLAINT';
  const atDb = dbNow();
  const newClosureDue = computeDueDates(db, new Date(), row.event_type).closureDue;
  db.transaction(() => {
    db.prepare(
      `UPDATE \`case\`
          SET case_status = 'REOPENED', closure_sla_due = ?, closure_reminded_at = NULL, closure_escalated_at = NULL,
              updated_at = ?
        WHERE case_id = ?`
    ).run(newClosureDue, atDb, row.case_id);
    insertLog(db, row.case_id, 'REOPEN', `重新開啟（標記：${REOPEN_LABEL[reopenType]}）：${reason}；新的關閉期限 ${newClosureDue}`, 'CLOSED', 'REOPENED', user.userId, atDb, null);
    audit(db, user, 'CASE_REOPEN', row.case_id, { reason, reopenType });
  })();
  if (row.assigned_to) {
    notifyUser(db, {
      userId: row.assigned_to,
      notifType: 'CASE',
      title: `個案 ${row.case_id} 已重新開啟`,
      body: `個案 ${row.case_id}（原已關閉）已重新開啟，待重新分派處理，原因：${reason}。`,
      refId: row.case_id,
    });
  }
  return { caseId: row.case_id, caseStatus: 'REOPENED', closureSlaDue: dbToIso8(newClosureDue) };
}

/** 上傳附件（FR-004-08：jpg/png/pdf ≤ 10MB，私有儲存） */
function uploadCaseAttachment(db, caseId, user, file) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  assertState(row, ACTIONABLE_STATUSES, '上傳附件');
  const fileName = String(file.name || '').trim();
  const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
  if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) throw new ApiError(ERR.ATTACH_INVALID);
  const buf = file.data;
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > 10 * 1024 * 1024) throw new ApiError(ERR.ATTACH_INVALID);
  const caseDir = path.join(uploadsDir(), row.case_id);
  fs.mkdirSync(caseDir, { recursive: true });
  const storageKey = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(caseDir, storageKey), buf);
  const atDb = dbNow();
  let attachmentId;
  db.transaction(() => {
    const logId = insertLog(db, row.case_id, 'UPLOAD', `上傳附件：${fileName}（${fmtSize(buf.length)}）`, row.case_status, row.case_status, user.userId, atDb, null);
    const info = db.prepare(
      'INSERT INTO case_log_attachment (log_id, case_id, file_name, file_size, file_type, storage_key, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(logId, row.case_id, fileName, buf.length, ext, storageKey, user.userId, atDb);
    attachmentId = info.lastInsertRowid;
    db.prepare('UPDATE case_log SET attachment_id = ? WHERE log_id = ?').run(attachmentId, logId);
  })();
  return { caseId: row.case_id, attachmentId, fileName, fileSize: buf.length };
}

/** 附件下載（私有：一律經權限 API，不開放靜態路徑） */
function downloadCaseAttachment(db, caseId, attachmentId, user) {
  const row = getRawCase(db, caseId);
  assertEstateScope(user, row);
  const att = db.prepare(
    'SELECT attachment_id AS attachmentId, case_id AS caseId, file_name AS fileName, file_type AS fileType, storage_key AS storageKey, file_size AS fileSize FROM case_log_attachment WHERE attachment_id = ? AND case_id = ?'
  ).get(Number(attachmentId), caseId);
  if (!att) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  const absPath = path.join(uploadsDir(), row.case_id, att.storageKey);
  if (!fs.existsSync(absPath)) throw new ApiError(ERR.INTERNAL, null, 500);
  return { absPath, fileName: att.fileName, fileType: att.fileType, fileSize: att.fileSize };
}

/** 批次分派（FR-004-10：同屋苑多案指派同一人；PENDING/REOPENED） */
function batchAssignCases(db, user, body) {
  const ids = Array.isArray(body.caseIds) ? [...new Set(body.caseIds.map(String))] : [];
  if (!ids.length || ids.length > 200) throw new ApiError(ERR.VALIDATION, 'caseIds 需為 1~200 個個案編號');
  if (!body.assigneeId) throw new ApiError(ERR.VALIDATION, '請選擇處理人員');
  const assignee = userBrief(db, Number(body.assigneeId));
  if (!assignee) throw new ApiError(ERR.VALIDATION, '處理人員不存在');
  const assigned = [];
  const skipped = [];
  const run = db.transaction((caseRow) => doAssign(db, caseRow, assignee, user, { priority: body.priority, eventType: body.eventType, note: body.note }, 'assign'));
  for (const id of ids) {
    let row;
    try {
      row = getRawCase(db, id);
      assertEstateScope(user, row);
      if (!['PENDING', 'REOPENED'].includes(row.case_status)) {
        skipped.push({ caseId: id, reason: `狀態 ${row.case_status} 不允許分派` });
        continue;
      }
      if (assignee.estateCode && assignee.estateCode !== 'ALL' && row.estate_code !== assignee.estateCode) {
        skipped.push({ caseId: id, reason: '個案屋苑與處理人員不符' });
        continue;
      }
      run(row);
      assigned.push(id);
    } catch (e) {
      skipped.push({ caseId: id, reason: e.message });
    }
  }
  return { assigned, skipped, assigneeId: assignee.userId };
}

/** 批次開始處理（ASSIGNED/REOPENED → IN_PROGRESS） */
function batchUpdateCases(db, user, body) {
  const ids = Array.isArray(body.caseIds) ? [...new Set(body.caseIds.map(String))] : [];
  if (!ids.length || ids.length > 200) throw new ApiError(ERR.VALIDATION, 'caseIds 需為 1~200 個個案編號');
  const action = body.action || 'start';
  if (action !== 'start') throw new ApiError(ERR.VALIDATION, 'batch action 僅支援 start');
  const done = [];
  const skipped = [];
  for (const id of ids) {
    let row;
    try {
      row = getRawCase(db, id);
      assertEstateScope(user, row);
      if (!['ASSIGNED', 'REOPENED'].includes(row.case_status)) {
        skipped.push({ caseId: id, reason: `狀態 ${row.case_status} 不允許開始處理` });
        continue;
      }
      statusChange(db, row, user, 'IN_PROGRESS', 'STATUS_CHANGE', '開始處理（批次）', {});
      done.push(id);
    } catch (e) {
      skipped.push({ caseId: id, reason: e.message });
    }
  }
  return { done, skipped };
}

module.exports = {
  createCaseFromFeedback,
  listCases,
  getCaseDetail,
  parseCaseFilters,
  cleanPayload,
  estateOf,
  getAssignees,
  assignCase,
  reassignCase,
  startCase,
  setWaitingCase,
  resumeCase,
  addCaseNote,
  changeCasePriority,
  submitResolution,
  approveResolution,
  rejectResolution,
  reopenCase,
  uploadCaseAttachment,
  downloadCaseAttachment,
  batchAssignCases,
  batchUpdateCases,
};
