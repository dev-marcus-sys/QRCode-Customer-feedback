/**
 * 系統路由：
 * GET  /api/v1/notifications                通知列表（本人）
 * GET  /api/v1/notifications/unread-count   未讀數
 * POST /api/v1/notifications/read-all       全部標已讀
 * POST /api/v1/notifications/:notifId/read  單筆標已讀
 * POST /api/v1/sla/scan                     手動執行 SLA 掃描（sla:run）
 */
'use strict';
const express = require('express');
const { ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const notificationService = require('../services/notificationService');
const { scanSla } = require('../services/slaReminderService');

const router = express.Router();
router.use(requireAuth);

router.get('/notifications', (req, res) => {
  const db = getDb();
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const result = notificationService.listNotifications(db, req.user.userId, {
    unreadOnly: req.query.unread === '1' || req.query.unread === 'true',
    page,
    pageSize,
  });
  ok(res, result);
});

router.get('/notifications/unread-count', (req, res) => {
  ok(res, { unread: notificationService.unreadCount(getDb(), req.user.userId) });
});

router.post('/notifications/read-all', (req, res) => {
  notificationService.markAllRead(getDb(), req.user.userId);
  ok(res, { updated: true });
});

router.post('/notifications/:notifId/read', (req, res) => {
  const id = Number(req.params.notifId);
  if (!Number.isInteger(id) || id <= 0) return ok(res, { updated: false });
  const updated = notificationService.markRead(getDb(), req.user.userId, id);
  return ok(res, { updated });
});

router.post('/sla/scan', requirePerm('sla:run'), (req, res) => {
  const summary = scanSla(getDb());
  ok(res, summary);
});

module.exports = router;
