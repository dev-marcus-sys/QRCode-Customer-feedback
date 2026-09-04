/**
 * 後台問卷路由：
 * GET  /api/v1/surveys/stats             問卷統計（dashboard:view）
 * POST /api/v1/surveys/:surveyId/resend  補發問卷電郵（case:review）
 */
'use strict';
const express = require('express');
const { ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const { surveyStats, resendSurvey } = require('../services/surveyService');

const router = express.Router();
router.use(requireAuth);

router.get('/stats', requirePerm('dashboard:view'), (req, res) => {
  ok(res, surveyStats(getDb(), req.user, req.query));
});

router.post('/:surveyId/resend', requirePerm('case:review'), (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const result = resendSurvey(getDb(), req.params.surveyId, req.user, {
    origin,
    lang: req.body && req.body.lang,
  });
  ok(res, result);
});

module.exports = router;
