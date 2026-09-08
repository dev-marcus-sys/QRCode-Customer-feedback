/**
 * 程序內定時器：
 * - SLA 提醒/升級掃描（F-005）：SLA_SCAN_INTERVAL_MS（省略/0 → 停用；建議 60000）
 * - 自動週報（F-008 FR-008-07）：WEEKLY_REPORT_CHECK_MS（預設 0 停用；啟用後每 tick
 *   檢查是否為「週報排程」時段（預設週一 09:00，可於 F-009 配置）且當期未產生）
 * 兩者亦可由手動端點觸發（POST /api/v1/sla/scan、POST /api/v1/dashboard/weekly-report/run）。
 */
'use strict';
const { scanSla } = require('./services/slaReminderService');
const { maybeRunWeekly } = require('./services/weeklyReportService');
const { applyExpiry } = require('./services/qrService');
const { processClassifyQueue } = require('./services/aiService');
const { getDb } = require('./db/connection');
const logger = require('./utils/logger');

let slaTimer = null;
let weeklyTimer = null;
let qrExpiryTimer = null;
let aiTimer = null;

function intervalOf(raw, fallback) {
  const intervalMs = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : null;
}

function startSlaScheduler() {
  if (slaTimer) return;
  const intervalMs = intervalOf(process.env.SLA_SCAN_INTERVAL_MS, 60000);
  if (!intervalMs) {
    logger.warn('scheduler', 'SLA 掃描定時器停用（SLA_SCAN_INTERVAL_MS 為 0/無效）');
    return;
  }
  slaTimer = setInterval(() => {
    try {
      scanSla(getDb());
    } catch (e) {
      logger.error('scheduler', `SLA 掃描失敗：${e.message}`);
    }
  }, intervalMs);
  if (slaTimer.unref) slaTimer.unref();
  logger.info('scheduler', `SLA 掃描定時器已啟動（每 ${intervalMs}ms）`);
}

function stopSlaScheduler() {
  if (slaTimer) {
    clearInterval(slaTimer);
    slaTimer = null;
  }
}

/** 自動週報定時器（F-008；預設停用，避免開發環境自動寄信） */
function startWeeklyScheduler() {
  if (weeklyTimer) return;
  const intervalMs = intervalOf(process.env.WEEKLY_REPORT_CHECK_MS, 0);
  if (!intervalMs) {
    logger.warn('scheduler', '週報定時器停用（WEEKLY_REPORT_CHECK_MS 為 0/未設定）');
    return;
  }
  weeklyTimer = setInterval(() => {
    try {
      const out = maybeRunWeekly(getDb());
      if (out.ran) logger.info('scheduler', `自動週報已產生（${out.report.periodStart}）`);
    } catch (e) {
      logger.error('scheduler', `週報檢查失敗：${e.message}`);
    }
  }, intervalMs);
  if (weeklyTimer.unref) weeklyTimer.unref();
  logger.info('scheduler', `週報定時器已啟動（每 ${intervalMs}ms）`);
}

function stopWeeklyScheduler() {
  if (weeklyTimer) {
    clearInterval(weeklyTimer);
    weeklyTimer = null;
  }
}

/**
 * QR Code 自動到期掃描（FR-009-03 延伸）：
 * 有效日期（valid_until）到點且仍啟用之 QR 自動停用並寫入停用時間。
 * 間隔由 QR_EXPIRY_SCAN_INTERVAL_MS 控制（省略 → 60000；設 0 停用）。
 */
function startQrExpiryScheduler() {
  if (qrExpiryTimer) return;
  const intervalMs = intervalOf(process.env.QR_EXPIRY_SCAN_INTERVAL_MS, 60000);
  if (!intervalMs) {
    logger.warn('scheduler', 'QR 自動到期掃描停用（QR_EXPIRY_SCAN_INTERVAL_MS 為 0/無效）');
    return;
  }
  qrExpiryTimer = setInterval(() => {
    try {
      const n = applyExpiry(getDb());
      if (n > 0) logger.info('scheduler', `QR 自動到期：已停用 ${n} 張 QR Code`);
    } catch (e) {
      logger.error('scheduler', `QR 自動到期掃描失敗：${e.message}`);
    }
  }, intervalMs);
  if (qrExpiryTimer.unref) qrExpiryTimer.unref();
  logger.info('scheduler', `QR 自動到期掃描已啟動（每 ${intervalMs}ms）`);
}

function stopQrExpiryScheduler() {
  if (qrExpiryTimer) {
    clearInterval(qrExpiryTimer);
    qrExpiryTimer = null;
  }
}

/**
 * AI 建議掃描（M0 / AI-01 影子模式）：處理 ai_suggestion 中 status=pending 之建議。
 * rules 基線通常於建案時已即時處理，此處主要服務遠端模型 provider 之佇列。
 * 間隔由 AI_SCAN_INTERVAL_MS 控制（省略 → 60000；設 0 停用）。
 */
function startAiScheduler() {
  if (aiTimer) return;
  const intervalMs = intervalOf(process.env.AI_SCAN_INTERVAL_MS, 60000);
  if (!intervalMs) {
    logger.warn('scheduler', 'AI 建議掃描定時器停用（AI_SCAN_INTERVAL_MS 為 0/無效）');
    return;
  }
  aiTimer = setInterval(() => {
    processClassifyQueue(getDb(), { limit: 5 }).catch((e) => {
      logger.error('scheduler', `AI 分類掃描失敗：${e.message}`);
    });
  }, intervalMs);
  if (aiTimer.unref) aiTimer.unref();
  logger.info('scheduler', `AI 建議掃描定時器已啟動（每 ${intervalMs}ms）`);
}

function stopAiScheduler() {
  if (aiTimer) {
    clearInterval(aiTimer);
    aiTimer = null;
  }
}

module.exports = {
  startSlaScheduler, stopSlaScheduler,
  startWeeklyScheduler, stopWeeklyScheduler,
  startQrExpiryScheduler, stopQrExpiryScheduler,
  startAiScheduler, stopAiScheduler,
};
