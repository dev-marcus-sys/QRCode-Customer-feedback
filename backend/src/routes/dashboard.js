/**
 * F-008 數據分析與儀表板路由（掛載於 /api/v1/dashboard；全部 requireAuth）。
 * 對應 docs/F008-F009_細部設計.md §6.2。
 */
'use strict';
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const analytics = require('../services/analyticsService');
const weekly = require('../services/weeklyReportService');
const ai = require('../services/aiService');

const router = express.Router();
router.use(requireAuth);

router.get('/summary', requirePerm('dashboard:view'), (req, res) => {
  ok(res, analytics.summary(getDb(), req.user, req.query));
});

router.get('/trend', requirePerm('dashboard:view'), (req, res) => {
  ok(res, { items: analytics.trend(getDb(), req.user, req.query) });
});

router.get('/distribution', requirePerm('dashboard:view'), (req, res) => {
  ok(res, analytics.distributions(getDb(), req.user, req.query));
});

router.get('/handlers', requirePerm('dashboard:view'), (req, res) => {
  ok(res, { items: analytics.handlers(getDb(), req.user, req.query) });
});

router.get('/anomalies', requirePerm('dashboard:view'), (req, res) => {
  ok(res, analytics.anomalies(getDb(), req.user, req.query));
});

/** CSV（UTF-8 BOM）匯出（FR-008-06 骨架：Excel/PDF 差異見 §9.2） */
router.get('/export', requirePerm('dashboard:view'), requirePerm('case:export'), (req, res) => {
  const out = analytics.buildExportCsv(getDb(), req.user, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.buffer);
});

/** 手動產生上週週報（FR-008-07；同 period 已存在時回傳 duplicate；含 AI-06 摘要） */
router.post('/weekly-report/run', requirePerm('dashboard:view'), async (req, res) => {
  ok(res, await weekly.generateWeeklyReport(getDb(), { actor: req.user, nowMs: Date.now() }));
});

/** 為既有週報（重新）生成 AI-06 摘要（開關開啟後補跑舊報表用） */
router.post('/weekly-report/:id/ai-summary', requirePerm('dashboard:view'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(ERR.VALIDATION, '週報 id 不合法');
  ok(res, await weekly.regenerateWeeklyAiSummary(getDb(), id));
});

/* ---------- AI-08 逾期風險預警（docs/AI_利用方案.md §4.8） ---------- */
/** 風險個案清單（Dashboard「風險個案」卡；沿用 dashboard:view＋屋苑 data_scope） */
router.get('/risk-cases', requirePerm('dashboard:view'), (req, res) => {
  const limit = Number(req.query.limit) || 20;
  if (!Number.isInteger(limit) || limit < 1) throw new ApiError(ERR.VALIDATION, 'limit 不合法');
  ok(res, { items: ai.listCaseRisks(getDb(), req.user, { limit, level: req.query.level }) });
});

/** 手動觸發一次風險掃描（等同排程 tick） */
router.post('/risk-cases/run', requirePerm('dashboard:view'), async (req, res, next) => {
  try {
    ok(res, await ai.scanCaseRisk(getDb()));
  } catch (e) {
    next(e);
  }
});

/** 主管確認預警（寫 audit AI_RISK_ACK） */
router.post('/risk-cases/:caseId/ack', requirePerm('case:update'), (req, res) => {
  ok(res, ai.ackCaseRisk(getDb(), req.params.caseId, req.user));
});

router.get('/weekly-report/list', requirePerm('dashboard:view'), (req, res) => {
  const limit = Number(req.query.limit) || 20;
  if (!Number.isInteger(limit) || limit < 1) throw new ApiError(ERR.VALIDATION, 'limit 不合法');
  ok(res, { items: weekly.listWeeklyReports(getDb(), { limit }) });
});

module.exports = router;
