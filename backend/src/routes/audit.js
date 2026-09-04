/**
 * F-010 操作審計日誌查閱（FR-010-05；掛載於 /api/v1/audit；全部 requireAuth）。
 * - GET /audit   查詢（audit:view）：依 action / 操作人 / 目標類型 / 時間範圍過濾，含分頁。
 * 日誌為 append-only，本端點僅供查閱，不提供刪除/修改。
 */
'use strict';
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');

const router = express.Router();
router.use(requireAuth);

const MAX_PAGE = 100;
const ACTIONS = ['LOGIN', 'LOGOUT', 'CASE_CREATE', 'CASE_ASSIGN', 'CASE_STATUS', 'CASE_REOPEN', 'CONFIG_CHANGE', 'EXPORT', 'QR_GENERATE', 'QR_DEACTIVATE', 'QR_REACTIVATE', 'USER_MANAGE', 'ROLE_MANAGE', 'WEEKLY_REPORT', 'SURVEY'];

router.get('/', requirePerm('audit:view'), (req, res) => {
  const q = req.query;
  const db = getDb();
  const where = [];
  const params = [];
  if (q.action) {
    if (!ACTIONS.includes(q.action)) throw new ApiError(ERR.VALIDATION, 'action 不合法');
    where.push('a.action = ?');
    params.push(q.action);
  }
  if (q.username) { where.push('a.username LIKE ?'); params.push(`%${q.username}%`); }
  if (q.targetType) { where.push('a.target_type = ?'); params.push(q.targetType); }
  if (q.from) { where.push('a.created_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('a.created_at <= ?'); params.push(q.to); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log a ${w}`).get(...params).c;
  const p = Math.max(1, Number(q.page) || 1);
  const ps = Math.min(MAX_PAGE, Math.max(1, Number(q.pageSize) || 20));
  const rows = db.prepare(
    `SELECT a.audit_id AS auditId, a.user_id AS userId, a.username, a.action, a.target_type AS targetType,
            a.target_id AS targetId, a.detail, a.ip, a.user_agent AS userAgent, a.created_at AS createdAt
       FROM audit_log a ${w} ORDER BY a.audit_id DESC LIMIT ? OFFSET ?`
  ).all(...params, ps, (p - 1) * ps);
  ok(res, {
    total,
    page: p,
    pageSize: ps,
    items: rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })),
    actions: ACTIONS,
  });
});

module.exports = router;
