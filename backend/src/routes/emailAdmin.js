'use strict';
/**
 * 郵件發送管理（F-007 輔助）：
 * GET  /api/v1/emails/stats          發送統計（總體 + 滿意度調查分類）
 * GET  /api/v1/emails                郵件清單（可依 template / status 過濾）
 * POST /api/v1/emails/:id/resend     立即重發單筆
 * POST /api/v1/emails/resend-failed  重發全部失敗的滿意度調查信件
 */
const express = require('express');
const { ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const { processOutbox, resendById, resendFailedSurveys } = require('../services/emailWorker');
const { getEffectiveTemplate, TEMPLATE_KEYS, updateOutboxContent } = require('../services/emailTemplateService');

const SAT_TEMPLATES = "('satisfaction_survey','satisfaction_survey_reminder')";

const router = express.Router();
router.use(requireAuth);
router.use(requirePerm('dashboard:view'));

function toStatusMap(rows) {
  const m = { PENDING: 0, SENT: 0, FAILED: 0 };
  for (const r of rows) m[r.status] = Number(r.c);
  return m;
}

router.get('/stats', (req, res) => {
  const db = getDb();
  const overall = db.prepare('SELECT status, COUNT(*) AS c FROM email_outbox GROUP BY status').all();
  const sat = db.prepare(`SELECT status, COUNT(*) AS c FROM email_outbox WHERE template IN ${SAT_TEMPLATES} GROUP BY status`).all();
  const satTotal = sat.reduce((a, r) => a + Number(r.c), 0);
  ok(res, { overall: toStatusMap(overall), satisfaction: toStatusMap(sat), satisfactionTotal: satTotal });
});

router.get('/', (req, res) => {
  const db = getDb();
  const { template, status, page = 1, pageSize = 20 } = req.query;
  const where = [];
  const params = [];
  if (template) { where.push('template = ?'); params.push(String(template)); }
  if (status) { where.push('status = ?'); params.push(String(status)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM email_outbox ${whereSql}`).get(...params).c;
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const p = Math.max(Number(page) || 1, 1);
  const items = db.prepare(
    `SELECT outbox_id AS outboxId, case_id AS caseId, template, recipient, subject, status, body,
            created_at AS createdAt, sent_at AS sentAt, error
       FROM email_outbox ${whereSql} ORDER BY outbox_id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size).map((r) => ({ ...r, body: r.body || '', error: r.error || null }));
  ok(res, { total, page: p, pageSize: size, items });
});

router.get('/email-templates', (req, res) => {
  const db = getDb();
  const items = [];
  for (const key of Object.keys(TEMPLATE_KEYS)) {
    for (const lang of ['zh', 'en']) {
      const t = getEffectiveTemplate(db, key, lang);
      items.push({ key, lang, configKey: TEMPLATE_KEYS[key][lang], subject: t.subject, body: t.body });
    }
  }
  ok(res, { items });
});

router.patch('/:id', (req, res) => {
  ok(res, updateOutboxContent(getDb(), req.params.id, req.body || {}));
});

router.post('/:id/resend', (req, res) => {
  resendById(getDb(), req.params.id).then((r) => ok(res, r));
});

router.post('/resend-failed', (req, res) => {
  resendFailedSurveys(getDb()).then((r) => ok(res, r));
});

module.exports = router;
