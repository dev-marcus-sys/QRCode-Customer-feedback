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
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { writeAudit } = require('../utils/audit');
const analytics = require('./analyticsService');
const ai = require('./aiService');
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

/** 以 KPI 摘要＋異常清單建立電郵內文（純文字；簡潔呈現）；AI 摘要附於頂部 */
function buildEmailBody(sum, an, aiSummary) {
  const lines = [`QRCode 客戶意見反饋週報（${sum.range.from} ~ ${sum.range.to}）`, ''];
  if (aiSummary) {
    lines.push('── AI 週報摘要（僅供參考，請以原數據為準）──');
    for (const l of String(aiSummary).split('\n')) lines.push(l);
    lines.push('', '── 以下為統計數據 ──', '');
  }
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
 * @returns {Promise<{ duplicate?:boolean, report?:object, recipients?:number, emailQueued?:number }>}
 */
async function generateWeeklyReport(db, { nowMs = Date.now(), actor = ALL_USER } = {}) {
  const lw = analytics.lastWeekRange(nowMs);
  const existing = db.prepare('SELECT * FROM weekly_report WHERE period_key = ?').get(lw.from);
  if (existing) {
    return { duplicate: true, report: toReportDto(existing) };
  }

  const sum = analytics.summary(db, ALL_USER, { range: 'custom', from: lw.from, to: lw.to }, { withPrev: false, nowMs });
  const an = analytics.anomalies(db, ALL_USER, {}, { limit: 50 });

  // AI-06 週報摘要：由彙總數字生成敘事（失敗／停用則略過，不影響週報產生）
  let aiSummary = null;
  let aiSummaryModel = null;
  try {
    const res = await ai.generateWeeklySummary(db, { summary: sum, anomalies: an, topItems: an.items });
    aiSummary = res.text;
    aiSummaryModel = res.model;
  } catch (e) {
    logger.warn('weeklyReport', `AI-06 週報摘要略過：${e.message}`);
  }

  const info = db.prepare(
    'INSERT INTO weekly_report (period_start, period_end, period_key, summary_json, anomaly_json, generated_by, generated_at, ai_summary, ai_summary_model, ai_summary_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(lw.from, lw.to, lw.from, JSON.stringify(sum), JSON.stringify(an.items), actor.userId || 0, toDb(new Date(nowMs)), aiSummary, aiSummaryModel, aiSummary ? toDb(new Date(nowMs)) : null);

  const recipients = weeklyRecipients(db);
  const subject = `客戶意見反饋週報（${lw.from} ~ ${lw.to}）`;
  const body = buildEmailBody(sum, an, aiSummary);
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
    aiSummary: row.ai_summary || null,
    aiSummaryModel: row.ai_summary_model || null,
    aiSummaryAt: row.ai_summary_at ? dbToIso8(row.ai_summary_at) : null,
  };
}

function listWeeklyReports(db, { limit = 20 } = {}) {
  const rows = db.prepare(
    'SELECT report_id, period_start, period_end, summary_json, anomaly_json, generated_at, ai_summary, ai_summary_model, ai_summary_at FROM weekly_report ORDER BY period_start DESC LIMIT ?'
  ).all(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    reportId: r.report_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    summary: JSON.parse(r.summary_json || 'null'),
    anomalyCount: JSON.parse(r.anomaly_json || '[]').length,
    generatedAt: dbToIso8(r.generated_at),
    aiSummary: r.ai_summary || null,
    aiSummaryModel: r.ai_summary_model || null,
    aiSummaryAt: r.ai_summary_at ? dbToIso8(r.ai_summary_at) : null,
  }));
}

/**
 * 為既有週報（重新）生成 AI 摘要（開關開啟後補跑舊報表用；dashboard:view）。
 * 摘要由該報表已儲存之 summary_json + anomaly_json 生成（輸入為彙總數字，不含個案原文）。
 * @returns {{ reportId:number, aiSummary:string|null, aiSummaryModel:string|null, aiSummaryAt:string|null }}
 */
async function regenerateWeeklyAiSummary(db, reportId) {
  const row = db.prepare('SELECT * FROM weekly_report WHERE report_id = ?').get(reportId);
  if (!row) throw new ApiError(ERR.VALIDATION, '週報不存在', 404);
  let summary = null;
  let anomalies = null;
  try { summary = JSON.parse(row.summary_json || 'null'); } catch { summary = null; }
  try { anomalies = { counts: { OVERDUE: 0, LOW_SCORE: 0, SECOND: 0 }, items: JSON.parse(row.anomaly_json || '[]') }; } catch { anomalies = { counts: { OVERDUE: 0, LOW_SCORE: 0, SECOND: 0 }, items: [] }; }
  let aiSummary = null;
  let aiSummaryModel = null;
  try {
    const res = await ai.generateWeeklySummary(db, { summary, anomalies, topItems: anomalies.items });
    aiSummary = res.text;
    aiSummaryModel = res.model;
  } catch (e) {
    logger.warn('weeklyReport', `AI-06 重算摘要略過：${e.message}`);
  }
  db.prepare(
    'UPDATE weekly_report SET ai_summary = ?, ai_summary_model = ?, ai_summary_at = ? WHERE report_id = ?'
  ).run(aiSummary, aiSummaryModel, aiSummary ? toDb(new Date()) : null, row.report_id);
  writeAudit(db, {
    userId: 0, username: 'SYSTEM', action: 'WEEKLY_REPORT_AI',
    targetType: 'WEEKLY_REPORT', targetId: String(row.report_id),
    detail: { reportId: row.report_id, model: aiSummaryModel, hasSummary: !!aiSummary },
  });
  return { reportId: row.report_id, aiSummary, aiSummaryModel, aiSummaryAt: aiSummary ? dbToIso8(toDb(new Date())) : null };
}

/**
 * 排程檢查：目前（香港時區）是否處於週報產生時段（每週一 HH:MM 起 10 分鐘內）
 * 且「上週」報表尚未產生。若符合即產生並回傳結果，否則回傳 { ran:false, reason }。
 */
async function maybeRunWeekly(db, nowMs = Date.now()) {
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
  const out = await generateWeeklyReport(db, { nowMs });
  return out.duplicate ? { ran: false, reason: 'already_generated' } : { ran: true, ...out };
}

module.exports = { generateWeeklyReport, listWeeklyReports, maybeRunWeekly, regenerateWeeklyAiSummary, weeklyRecipients };
