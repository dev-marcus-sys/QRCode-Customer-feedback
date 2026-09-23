/**
 * 後台個案路由：
 * GET    /api/v1/cases                    列表（篩選/分頁/排序）— case:list
 * GET    /api/v1/cases/export             匯出（csv/xlsx）        — case:export
 * POST   /api/v1/cases/batch-assign       批次分派（同屋苑）      — case:assign
 * POST   /api/v1/cases/batch-update       批次開始處理            — case:update
 * GET    /api/v1/cases/:caseId            詳情（時間軸+allowedActions+survey）— case:view
 * GET    /api/v1/cases/:caseId/assignees  分派候選人＋建議        — case:assign
 * POST   /api/v1/cases/:caseId/assign     分派（PENDING/REOPENED→ASSIGNED）
 * POST   /api/v1/cases/:caseId/reassign   轉派（ASSIGNED/IN_PROGRESS/WAITING→ASSIGNED）
 * POST   /api/v1/cases/:caseId/start      開始處理（→IN_PROGRESS）
 * POST   /api/v1/cases/:caseId/waiting    等候客戶回覆（→WAITING）
 * POST   /api/v1/cases/:caseId/resume     恢復處理（→IN_PROGRESS）
 * POST   /api/v1/cases/:caseId/note       跟進記錄（首筆 RESPONSE）
 * POST   /api/v1/cases/:caseId/priority   調整優先級
 * POST   /api/v1/cases/:caseId/resolve-request  完結申請（→RESOLVED）— case:resolve
 * POST   /api/v1/cases/:caseId/approve    完結審核通過（→CLOSED）— case:review
 * POST   /api/v1/cases/:caseId/reject     完結審核駁回（→IN_PROGRESS）— case:review
 * POST   /api/v1/cases/:caseId/reopen     授權重開（→REOPENED）— case:reopen
 * POST   /api/v1/cases/:caseId/attachments  上傳附件（base64 JSON）— case:update
 * GET    /api/v1/cases/:caseId/attachments/:attachmentId/download  下載附件 — case:view
 */
'use strict';
const express = require('express');
const { ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const { listCases, getCaseDetail, getAssignees, assignCase, reassignCase,
  startCase, setWaitingCase, resumeCase, addCaseNote, changeCasePriority,
  submitResolution, approveResolution, rejectResolution, reopenCase,
  uploadCaseAttachment, downloadCaseAttachment, batchAssignCases, batchUpdateCases } = require('../services/caseService');
const { exportFile } = require('../services/exportService');
const { listAiSuggestions, decideAiSuggestion, reanalyzeCase, linkSimilarCase, suggestAssignee,
  createDraft, useDraft, caseFeedbackInsight, analyzeAttachment, attachmentInsights } = require('../services/aiService');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePerm('case:list'), (req, res) => {
  const db = getDb();
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  ok(res, listCases(db, req.query, req.user, { page, pageSize }));
});

router.get('/export', requirePerm('case:export'), async (req, res, next) => {
  const db = getDb();
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const out = await exportFile(db, format, req.query, req.user);
    db.prepare(
      'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.userId, req.user.username, 'EXPORT', 'CASE_LIST', null, JSON.stringify({ format, filters: req.query }), req.ip);
    logger.info('cases', `EXPORT ${out.ext} by ${req.user.username}`);
    res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${out.filename}"`);
    return res.send(out.buffer);
  } catch (e) {
    return next(e);
  }
});

/* ---------- 批次（F-004 FR-004-10） ---------- */
router.post('/batch-assign', requirePerm('case:assign'), (req, res) => {
  ok(res, batchAssignCases(getDb(), req.user, req.body || {}));
});

router.post('/batch-update', requirePerm('case:update'), (req, res) => {
  ok(res, batchUpdateCases(getDb(), req.user, req.body || {}));
});

/* ---------- 個案動作 ---------- */
router.get('/:caseId/assignees', requirePerm('case:assign'), (req, res) => {
  ok(res, getAssignees(getDb(), req.params.caseId, req.user));
});

router.post('/:caseId/assign', requirePerm('case:assign'), (req, res) => {
  ok(res, assignCase(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/reassign', requirePerm('case:assign'), (req, res) => {
  ok(res, reassignCase(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/start', requirePerm('case:update'), (req, res) => {
  ok(res, startCase(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/waiting', requirePerm('case:update'), (req, res) => {
  ok(res, setWaitingCase(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/resume', requirePerm('case:update'), (req, res) => {
  ok(res, resumeCase(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/note', requirePerm('case:update'), (req, res) => {
  ok(res, addCaseNote(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/priority', requirePerm('case:update'), (req, res) => {
  ok(res, changeCasePriority(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/resolve-request', requirePerm('case:resolve'), (req, res) => {
  ok(res, submitResolution(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/approve', requirePerm('case:review'), (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  ok(res, approveResolution(getDb(), req.params.caseId, req.user, { ...(req.body || {}), origin }));
});

router.post('/:caseId/reject', requirePerm('case:review'), (req, res) => {
  ok(res, rejectResolution(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/reopen', requirePerm('case:reopen'), (req, res) => {
  ok(res, reopenCase(getDb(), req.params.caseId, req.user, req.body || {}));
});

router.post('/:caseId/attachments', requirePerm('case:update'), (req, res) => {
  const body = req.body || {};
  const file = {
    name: body.fileName || '',
    data: Buffer.from(String(body.fileDataBase64 || ''), 'base64'),
  };
  ok(res, uploadCaseAttachment(getDb(), req.params.caseId, req.user, file), 201);
});

router.get('/:caseId/attachments/:attachmentId/download', requirePerm('case:view'), (req, res) => {
  const att = downloadCaseAttachment(getDb(), req.params.caseId, req.params.attachmentId, req.user);
  res.set('Content-Type', att.fileType === 'pdf' ? 'application/pdf' : `image/${att.fileType === 'jpg' ? 'jpeg' : att.fileType}`);
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(att.fileName)}"`);
  return res.sendFile(att.absPath);
});

/** AI-07 附件影像理解結果（按附件聚合最新一筆；case:view） */
router.get('/:caseId/attachments/ai-insights', requirePerm('case:view'), (req, res) => {
  ok(res, { items: attachmentInsights(getDb(), req.params.caseId, req.user) });
});

/** AI-07 觸發單一附件影像分析（case:update；寫 ai_suggestion + ocr_text） */
router.post('/:caseId/attachments/:attachmentId/analyze', requirePerm('case:update'), async (req, res, next) => {
  try {
    ok(res, await analyzeAttachment(getDb(), req.params.caseId, req.params.attachmentId, req.user));
  } catch (e) {
    next(e);
  }
});

/* ---------- AI 建議（M0 / AI-01 影子模式；docs/AI_利用方案.md §7.1） ---------- */
router.get('/:caseId/ai-suggestions', requirePerm('case:view'), (req, res) => {
  ok(res, listAiSuggestions(getDb(), req.params.caseId, req.user));
});

router.post('/:caseId/ai-suggestions/:suggestionId/accept', requirePerm('case:update'), (req, res) => {
  ok(res, decideAiSuggestion(getDb(), req.params.suggestionId, req.user, {
    accept: true,
    note: req.body && req.body.note,
  }));
});

router.post('/:caseId/ai-suggestions/:suggestionId/reject', requirePerm('case:update'), (req, res) => {
  ok(res, decideAiSuggestion(getDb(), req.params.suggestionId, req.user, {
    accept: false,
    note: req.body && req.body.note,
  }));
});

/** 重新分析（為現有個案即時產生分類建議；補跑開關開啟前／後台建案之個案） */
router.post('/:caseId/ai-suggestions/refresh', requirePerm('case:update'), async (req, res, next) => {
  try {
    ok(res, await reanalyzeCase(getDb(), req.params.caseId, req.user));
  } catch (e) {
    next(e);
  }
});

/** 確認相似個案為重複 → 關聯 original_case_id（case:update） */
router.post('/:caseId/ai-suggestions/:suggestionId/link', requirePerm('case:update'), (req, res) => {
  ok(res, linkSimilarCase(getDb(), req.params.suggestionId, req.user, {
    targetCaseId: (req.body || {}).targetCaseId,
  }));
});

/** AI-03 智能分派建議（case:assign；採納仍走現有分派 API） */
router.get('/:caseId/ai-assignee-suggestion', requirePerm('case:assign'), (req, res) => {
  ok(res, suggestAssignee(getDb(), req.params.caseId, req.user));
});

/** AI-04 產生個案摘要／回覆草稿（case:update；只出建議，不自動寄出） */
router.post('/:caseId/ai-draft', requirePerm('case:update'), async (req, res, next) => {
  try {
    const body = req.body || {};
    ok(res, await createDraft(getDb(), req.params.caseId, req.user, {
      kind: body.kind || 'summary',
      lang: body.lang || 'zh-Hant',
    }), 201);
  } catch (e) {
    next(e);
  }
});

/** AI-04 採納草稿：人手編輯後存入 case_log（AI_DRAFT_USED；不自動對外發送） */
router.post('/:caseId/ai-draft/:suggestionId/use', requirePerm('case:update'), (req, res) => {
  ok(res, useDraft(getDb(), req.params.caseId, req.params.suggestionId, req.user, {
    content: (req.body || {}).content,
  }));
});

/** AI-05 單一個案之問卷意見分析（低分「可能成因摘要」；case:view） */
router.get('/:caseId/ai-feedback-insight', requirePerm('case:view'), (req, res) => {
  ok(res, { insight: caseFeedbackInsight(getDb(), req.params.caseId, req.user) });
});
router.get('/:caseId', requirePerm('case:view'), (req, res) => {
  ok(res, getCaseDetail(getDb(), req.params.caseId, req.user));
});

module.exports = router;
