/**
 * F-005 SLA 到期提醒與預警掃描（規格書 5.5/6.6）：
 * - 首次回應：期限將至（提前 10/30 分鐘）提醒處理人員＋屋苑主管；逾期升級處理人員＋直屬主管
 * - 關閉期限：期限前 1 天提醒；逾期升級
 * - 問卷到期：SENT 且過期 → EXPIRED
 * 每個（case, kind）只提醒／升級一次（以 case 標記欄為準；重開時重設）。
 * 由 server 內定時器或 POST /api/v1/sla/scan（sla:run）觸發。
 */
'use strict';
const { getConfig } = require('../db/configStore');
const { toDb, parseDb, dbToIso8 } = require('../utils/time');
const { notifyUser, usersByRole, directSupervisorOf } = require('./notificationService');
const { expireSurveys } = require('./surveyService');
const logger = require('../utils/logger');

function nowDbAt(nowMs) {
  return toDb(new Date(nowMs));
}

const RESPONSE_LEAD_DEFAULT = { URGENT: 10, NORMAL: 30, COMPLEX: 30, INSTANT: 30 };
const CLOSURE_LEAD_DEFAULT = 1;

function fetchCases(db) {
  return db.prepare(
    `SELECT c.case_id AS caseId, c.case_status AS status, c.estate_code AS estateCode,
            c.assigned_to AS assignedTo, c.event_type AS eventType,
            c.response_sla_due AS responseDue, c.closure_sla_due AS closureDue,
            c.first_response_at AS firstResponseAt,
            c.response_reminded_at AS respReminded, c.closure_reminded_at AS closureReminded,
            c.response_escalated_at AS respEscalated, c.closure_escalated_at AS closureEscalated,
            e.estate_name_zh AS estateNameZh, u.full_name AS assignedName
       FROM \`case\` c
       JOIN sys_estate e ON e.estate_code = c.estate_code
       LEFT JOIN sys_user u ON u.user_id = c.assigned_to
      WHERE c.case_status IN ('PENDING','ASSIGNED','IN_PROGRESS','WAITING','REOPENED')
        AND c.closed_at IS NULL`
  ).all();
}

function ms(s) {
  const d = parseDb(s);
  return d ? d.getTime() : null;
}

function estateSupervisors(db, estateCode) {
  return usersByRole(db, 'ESTATE_SUPERVISOR', estateCode);
}

/** 通知對象：處理人員（若有）＋直屬主管；無處理人員時退回屋苑主管 */
function escalationRecipients(db, row, estateSup) {
  const map = new Map();
  if (row.assignedTo) {
    map.set(row.assignedTo, { userId: row.assignedTo, fullName: row.assignedName || '' });
    const sup = directSupervisorOf(db, row.assignedTo);
    if (sup) map.set(sup.userId, sup);
  }
  for (const sup of estateSup) if (!map.has(sup.userId)) map.set(sup.userId, sup);
  return [...map.values()];
}

/** 提醒對象：處理人員＋屋苑主管（6.6 SLA 臨期） */
function reminderRecipients(db, row, estateSup) {
  const map = new Map();
  if (row.assignedTo) map.set(row.assignedTo, { userId: row.assignedTo, fullName: row.assignedName || '' });
  for (const sup of estateSup) if (!map.has(sup.userId)) map.set(sup.userId, sup);
  return [...map.values()];
}

function logCase(db, caseId, logType, content) {
  db.prepare('INSERT INTO case_log (case_id, log_type, log_content, action_by, action_at) VALUES (?, ?, ?, 0, ?)')
    .run(caseId, logType, content, nowDbAt(Date.now()));
}

function markCase(db, caseId, col, atDb) {
  db.prepare(`UPDATE \`case\` SET ${col} = ?, updated_at = ? WHERE case_id = ?`).run(atDb, atDb, caseId);
}

/**
 * 執行一次 SLA 掃描（回應提醒＋升級；關閉提醒＋升級；問卷過期）。
 * @returns {{responseReminders, responseEscalations, closureReminders, closureEscalations, expiredSurveys, scanned}}
 */
function scanSla(db, nowMs = Date.now()) {
  const atDb = nowDbAt(nowMs);
  const reminderCfg = getConfig(db, 'sla.reminder', {});
  const responseLead = Object.assign({}, RESPONSE_LEAD_DEFAULT, reminderCfg.responseLeadMinutes || {});
  const closureLeadDays = Number(reminderCfg.closureLeadDays != null ? reminderCfg.closureLeadDays : CLOSURE_LEAD_DEFAULT);

  const summary = {
    scanned: 0,
    responseReminders: [],
    responseEscalations: [],
    closureReminders: [],
    closureEscalations: [],
  };
  const rows = fetchCases(db);
  summary.scanned = rows.length;

  const notify = (userId, type, title, body, refId) => {
    notifyUser(db, { userId, notifType: type, title, body, refId, email: true });
  };

  for (const row of rows) {
    const estateSup = estateSupervisors(db, row.estateCode);

    // ---- 首次回應 SLA（不適用 N/A；尚未有首次回應） ----
    if (row.eventType !== 'N/A' && row.responseDue && !row.firstResponseAt) {
      const due = ms(row.responseDue);
      const remaining = due - nowMs;
      if (remaining <= 0 && !row.respEscalated) {
        // 逾期升級（FR-005-03）
        const targets = escalationRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'ESCALATION', `個案 ${row.caseId} 首次回應已逾期`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 已超過首次回應期限（${dbToIso8(row.responseDue)}）仍未有回應，請即跟進。`, row.caseId);
        }
        markCase(db, row.caseId, 'response_escalated_at', atDb);
        logCase(db, row.caseId, 'ESCALATE', `首次回應期限 ${dbToIso8(row.responseDue)} 已過仍未有首次回應 → 升級提醒（處理人員＋直屬主管）`);
        summary.responseEscalations.push(row.caseId);
      } else if (remaining > 0 && !row.respReminded && remaining <= (responseLead[row.eventType] || 30) * 60 * 1000) {
        // 期限將至提醒（FR-005-01；特急提前 10 分鐘、其餘 30 分鐘）
        const targets = reminderRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'REMINDER', `個案 ${row.caseId} 首次回應期限將至`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 須於 ${dbToIso8(row.responseDue)} 前作出首次回應。`, row.caseId);
        }
        markCase(db, row.caseId, 'response_reminded_at', atDb);
        logCase(db, row.caseId, 'REMINDER', `首次回應期限 ${dbToIso8(row.responseDue)} 將至 → 提醒`);
        summary.responseReminders.push(row.caseId);
      }
    }

    // ---- 關閉期限（未關閉、非審核中） ----
    if (row.closureDue && !row.closedAt && row.status !== 'RESOLVED') {
      const due = ms(row.closureDue);
      const remaining = due - nowMs;
      if (remaining <= 0 && !row.closureEscalated) {
        const targets = escalationRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'ESCALATION', `個案 ${row.caseId} 逾期未關閉`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 已超過 7 天關閉期限（${dbToIso8(row.closureDue)}）仍未完成，請加緊處理。`, row.caseId);
        }
        markCase(db, row.caseId, 'closure_escalated_at', atDb);
        logCase(db, row.caseId, 'ESCALATE', `關閉期限 ${dbToIso8(row.closureDue)} 已過仍未關閉 → 升級提醒`);
        summary.closureEscalations.push(row.caseId);
      } else if (remaining > 0 && !row.closureReminded && remaining <= closureLeadDays * 24 * 60 * 60 * 1000) {
        const targets = reminderRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'REMINDER', `個案 ${row.caseId} 關閉期限將至`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 須於 ${dbToIso8(row.closureDue)} 前完成處理並關閉。`, row.caseId);
        }
        markCase(db, row.caseId, 'closure_reminded_at', atDb);
        logCase(db, row.caseId, 'REMINDER', `關閉期限 ${dbToIso8(row.closureDue)} 將至 → 提醒`);
        summary.closureReminders.push(row.caseId);
      }
    }
  }

  summary.expiredSurveys = expireSurveys(db, nowMs);
  logger.info('slaReminder', `SLA_SCAN cases=${summary.scanned} respRemind=${summary.responseReminders.length} respEsc=${summary.responseEscalations.length} closureRemind=${summary.closureReminders.length} closureEsc=${summary.closureEscalations.length} surveyExpired=${summary.expiredSurveys}`);
  return summary;
}

module.exports = { scanSla };
