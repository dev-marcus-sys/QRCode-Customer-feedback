/**
 * AI-05 問卷開放意見分析路由（掛載於 /api/v1/analytics；docs/AI_利用方案.md §4.5）。
 * - 讀取：dashboard:view（屋苑範圍由服務層依 user.estateCode 收斂）；
 * - 批次分析：由排程 tick 處理，亦可於此手動補跑既有已提交問卷。
 */
'use strict';
const express = require('express');
const { ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const ai = require('../services/aiService');

const router = express.Router();
router.use(requireAuth);

/** 意見分析彙總：主題分佈（含平均分／負面率）、情緒分佈、逐份明細 */
router.get('/survey-insights', requirePerm('dashboard:view'), (req, res) => {
  ok(res, ai.listFeedbackInsights(getDb(), {
    from: req.query.from,
    to: req.query.to,
    estate: req.query.estate,
  }, req.user));
});

/** 手動觸發批次分析（排程之外補跑；limit 上限 50） */
router.post('/survey-insights/run', requirePerm('dashboard:view'), async (req, res, next) => {
  try {
    const limit = Number((req.body || {}).limit) || 20;
    ok(res, await ai.processFeedbackQueue(getDb(), { limit }));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
