/**
 * F-008 自動週報（FR-008-07）：
 * - 每週一 09:00（可於 F-009 配置）自動產生「上週（香港週一~週日）」摘要
 * - 摘要＝全屋苑 KPI＋異常清單（上限 50）；寫入 weekly_report（period_key 防重）
 * - 電郵：email_outbox stub 逐收件人一筆（ADMIN＋CC_SUPERVISOR＋各屋苑 ESTATE_SUPERVISOR）
 * - 亦可由 POST /api/v1/dashboard/weekly-report/run（dashboard:view）手動觸發
 */
'use strict';
const { getConfig } = require('../db/configStore');
const { dbToIso8, toDb } = require('../utils/time');
const { enqueueEmail, usersByRole } = require('./notificationService');
const analytics = require('./analyticsService');
const logger = require('../utils/logger');

const HK_MS = 8 * 60 * 60 * 1000;

const ALL_USER = { userId: 0, username: 'SYSTEM', estateCode: 'ALL' };

function weeklyRecipients(db) {
  const map = new Map();
  const add = (u) => {
    if (u.email && !map.has(u.userId)) map.set(u.userId, u);
  };
  for (const u of usersByRole(db, 'ADMIN')) add(u);
  for (const u of usersByRole(db, 'CC_SUPERVISOR')) add(u);
  for (const e of db.prepare('SELECT estate_code AS code FROM sys_estate WHERE is_active = 1').all()) {
    for (const u of usersByRole(db, 'ESTATE_SUPERVISOR', e.code)) add(u);
  }
  return [...map.values()];
}

/** 以 KPI 摘要＋異常清單建立電郵內文（純文字；簡潔呈現） */
function buildEmailBody(sum, an) {
  const lines = [`QRCode 客戶意見反饋週報（${sum.range.from} ~ ${sum.range.to}）`, ''];
  for (const k of sum.kpi) {
    lines.push(`${k.labelZh}：${k.value == null ? '—' : k.value} ${k.unit || ''}${k.delta == null ? '' : `（較上期 ${k.delta >= 0 ? '+' : ''}${k.delta}）`}`);
  }
  lines.push('', `異常：逾期 ${an.counts.OVERDUE}、低分 ${an.counts.LOW_SCORE}、二次投訴 ${an.counts.SECOND}`);
  if (an.items.length) {
    lines.push('');
    for (const it of an.items.slice(0, 20)) {
      lines.push(`- [${it.type}] ${it.aspect ? `${it.aspect} ` : ''}個案 ${it.caseId}（${it.estateNameZh}）`);
    }
  }
  return lines.join('\n');
}

/**
 * 產生上週週報。同 period_key 已存在時不重寫。
 * @returns {{ duplicate?:boolean, report?:object, recipients?:number, emailQueued?:number }}
 */
function generateWeeklyReport(db, { nowMs = Date.now(), actor = ALL_USER } = {}) {
  const lw = analytics.lastWeekRange(nowMs);
  const existing = db.prepare('SELECT * FROM weekly_report WHERE period_key = ?').get(lw.from);
  if (existing) {
    return { duplicate: true, report: toReportDto(existing) };
  }

  const sum = analytics.summary(db, ALL_USER, { range: 'custom', from: lw.from, to: lw.to }, { withPrev: false, nowMs });
  const an = analytics.anomalies(db, ALL_USER, {}, { limit: 50 });

  const info = db.prepare(
    'INSERT INTO weekly_report (period_start, period_end, period_key, summary_json, anomaly_json, generated_by, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(lw.from, lw.to, lw.from, JSON.stringify(sum), JSON.stringify(an.items), actor.userId || 0, toDb(new Date(nowMs)));

  const recipients = weeklyRecipients(db);
  const subject = `客戶意見反饋週報（${lw.from} ~ ${lw.to}）`;
  const body = buildEmailBody(sum, an);
  let queued = 0;
  for (const r of recipients) {
    enqueueEmail(db, { template: 'weekly_report', recipient: r.email, subject, body });
    queued += 1;
  }

  db.prepare(
    'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(actor.userId || 0, actor.username || 'SYSTEM', 'WEEKLY_REPORT', 'WEEKLY_REPORT', lw.from,
    JSON.stringify({ periodStart: lw.from, periodEnd: lw.to, recipients: recipients.length }));

  logger.info('weeklyReport', `WEEKLY_REPORT ${lw.from}~${lw.to} recipients=${recipients.length} emailQueued=${queued}`);
  const row = db.prepare('SELECT * FROM weekly_report WHERE report_id = ?').get(info.lastInsertRowid);
  return { duplicate: false, report: toReportDto(row), recipients: recipients.length, emailQueued: queued };
}

function toReportDto(row) {
  return {
    reportId: row.report_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    summary: JSON.parse(row.summary_json || 'null'),
    anomalies: JSON.parse(row.anomaly_json || '[]'),
    generatedAt: dbToIso8(row.generated_at),
  };
}

function listWeeklyReports(db, { limit = 20 } = {}) {
  const rows = db.prepare(
    'SELECT report_id, period_start, period_end, summary_json, anomaly_json, generated_at FROM weekly_report ORDER BY period_start DESC LIMIT ?'
  ).all(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    reportId: r.report_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    summary: JSON.parse(r.summary_json || 'null'),
    anomalyCount: JSON.parse(r.anomaly_json || '[]').length,
    generatedAt: dbToIso8(r.generated_at),
  }));
}

/**
 * 排程檢查：目前（香港時區）是否處於週報產生時段（每週一 HH:MM 起 10 分鐘內）
 * 且「上週」報表尚未產生。若符合即產生並回傳結果，否則回傳 { ran:false, reason }。
 */
function maybeRunWeekly(db, nowMs = Date.now()) {
  const cfg = getConfig(db, 'weekly_report.schedule', { dayOfWeek: 'MON', time: '09:00' });
  const dayOfWeek = String(cfg.dayOfWeek || 'MON').toUpperCase();
  const time = String(cfg.time || '09:00');
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const wantDow = days.indexOf(dayOfWeek); // 0=Mon
  const hk = new Date(nowMs + HK_MS);
  const dow = (hk.getUTCDay() + 6) % 7; // 0=Mon
  const nowMin = hk.getUTCHours() * 60 + hk.getUTCMinutes();
  const [hh, mm] = String(time).split(':').map(Number);
  const startMin = (Number.isInteger(hh) ? hh : 9) * 60 + (Number.isInteger(mm) ? mm : 0);
  if (dow !== wantDow || nowMin < startMin || nowMin >= startMin + 10) {
    return { ran: false, reason: 'not_in_window' };
  }
  const out = generateWeeklyReport(db, { nowMs });
  return out.duplicate ? { ran: false, reason: 'already_generated' } : { ran: true, ...out };
}

module.exports = { generateWeeklyReport, listWeeklyReports, maybeRunWeekly, weeklyRecipients };
