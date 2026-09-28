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
            c.response_sla_due AS responseDue, c.dispatch_sla_due AS dispatchDue,
            c.processing_sla_due AS processingDue, c.followup_sla_due AS followupDue,
            c.closure_sla_due AS closureDue, c.first_response_at AS firstResponseAt,
            c.response_reminded_at AS respReminded, c.response_escalated_at AS respEscalated,
            c.dispatch_reminded_at AS dispatchReminded, c.dispatch_escalated_at AS dispatchEscalated,
            c.processing_reminded_at AS processingReminded, c.processing_escalated_at AS processingEscalated,
            c.followup_reminded_at AS followupReminded,
            c.closure_reminded_at AS closureReminded, c.closure_escalated_at AS closureEscalated,
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
 * 執行一次 SLA 掃描（回應/派單/處理/跟進/關閉 提醒＋升級；問卷過期）。
 * @returns {{responseReminders, responseEscalations, dispatchReminders, dispatchEscalations, processingReminders, processingEscalations, followupReminders, closureReminders, closureEscalations, expiredSurveys, scanned}}
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
    dispatchReminders: [],
    dispatchEscalations: [],
    processingReminders: [],
    processingEscalations: [],
    followupReminders: [],
    closureReminders: [],
    closureEscalations: [],
  };
  const followupInterval = getConfig(db, 'sla.followup_interval_hours', { URGENT: null, NORMAL: null, COMPLEX: 48, INSTANT: 168 });
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

    // ---- 派單 SLA（未指派 → 升級／將至提醒） ----
    if (row.dispatchDue && !row.assignedTo) {
      const due = ms(row.dispatchDue);
      const remaining = due - nowMs;
      if (remaining <= 0 && !row.dispatchEscalated) {
        const targets = escalationRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'ESCALATION', `個案 ${row.caseId} 派單已逾期`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 已超過派單期限（${dbToIso8(row.dispatchDue)}）仍未分派，請即處理。`, row.caseId);
        }
        markCase(db, row.caseId, 'dispatch_escalated_at', atDb);
        logCase(db, row.caseId, 'ESCALATE', `派單期限 ${dbToIso8(row.dispatchDue)} 已過仍未分派 → 升級提醒`);
        summary.dispatchEscalations.push(row.caseId);
      } else if (remaining > 0 && !row.dispatchReminded && remaining <= (responseLead[row.eventType] || 30) * 60 * 1000) {
        const targets = reminderRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'REMINDER', `個案 ${row.caseId} 派單期限將至`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 須於 ${dbToIso8(row.dispatchDue)} 前完成分派。`, row.caseId);
        }
        markCase(db, row.caseId, 'dispatch_reminded_at', atDb);
        logCase(db, row.caseId, 'REMINDER', `派單期限 ${dbToIso8(row.dispatchDue)} 將至 → 提醒`);
        summary.dispatchReminders.push(row.caseId);
      }
    }

    // ---- 處理 SLA（未關閉 → 升級／將至提醒） ----
    if (row.processingDue && !row.closedAt) {
      const due = ms(row.processingDue);
      const remaining = due - nowMs;
      if (remaining <= 0 && !row.processingEscalated) {
        const targets = escalationRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'ESCALATION', `個案 ${row.caseId} 處理已逾期`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 已超過處理期限（${dbToIso8(row.processingDue)}）仍未完成，請加緊處理。`, row.caseId);
        }
        markCase(db, row.caseId, 'processing_escalated_at', atDb);
        logCase(db, row.caseId, 'ESCALATE', `處理期限 ${dbToIso8(row.processingDue)} 已過仍未完成 → 升級提醒`);
        summary.processingEscalations.push(row.caseId);
      } else if (remaining > 0 && !row.processingReminded && remaining <= (responseLead[row.eventType] || 30) * 60 * 1000) {
        const targets = reminderRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'REMINDER', `個案 ${row.caseId} 處理期限將至`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 須於 ${dbToIso8(row.processingDue)} 前完成處理。`, row.caseId);
        }
        markCase(db, row.caseId, 'processing_reminded_at', atDb);
        logCase(db, row.caseId, 'REMINDER', `處理期限 ${dbToIso8(row.processingDue)} 將至 → 提醒`);
        summary.processingReminders.push(row.caseId);
      }
    }

    // ---- 跟進 SLA（週期性進度提醒：到期即提醒並推進下一期） ----
    if (row.followupDue && !row.closedAt) {
      const due = ms(row.followupDue);
      if (due <= nowMs) {
        const targets = reminderRecipients(db, row, estateSup);
        for (const t of targets) {
          notify(t.userId, 'REMINDER', `個案 ${row.caseId} 請更新處理進度`,
            `屋苑 ${row.estateNameZh} 個案 ${row.caseId} 距上次進度更新已逾期限，請向客戶回報最新進度。`, row.caseId);
        }
        const fi = followupInterval[row.eventType];
        const nextDue = fi != null ? toDb(new Date(nowMs + fi * 60 * 60 * 1000)) : null;
        db.prepare('UPDATE `case` SET followup_sla_due = ?, followup_reminded_at = ?, updated_at = ? WHERE case_id = ?')
          .run(nextDue, atDb, atDb, row.caseId);
        logCase(db, row.caseId, 'REMINDER', `跟進期限已到 → 進度更新提醒${nextDue ? `，下一期 ${dbToIso8(nextDue)}` : ''}`);
        summary.followupReminders.push(row.caseId);
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
  logger.info('slaReminder', `SLA_SCAN cases=${summary.scanned} respRemind=${summary.responseReminders.length} respEsc=${summary.responseEscalations.length} dispatchRemind=${summary.dispatchReminders.length} dispatchEsc=${summary.dispatchEscalations.length} procRemind=${summary.processingReminders.length} procEsc=${summary.processingEscalations.length} followup=${summary.followupReminders.length} closureRemind=${summary.closureReminders.length} closureEsc=${summary.closureEscalations.length} surveyExpired=${summary.expiredSurveys}`);
  return summary;
}

module.exports = { scanSla };
