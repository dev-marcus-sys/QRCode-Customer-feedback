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

router.get('/:caseId', requirePerm('case:view'), (req, res) => {
  ok(res, getCaseDetail(getDb(), req.params.caseId, req.user));
});

module.exports = router;
