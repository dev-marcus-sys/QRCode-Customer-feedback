/**
 * F-010 用戶管理路由（掛載於 /api/v1/users；全部 requireAuth）。
 * - GET    /users                      列表（user:list）
 * - POST   /users                      新增（user:create）
 * - PUT    /users/:id                  修改（user:update）
 * - DELETE /users/:id                  停用（軟刪，user:disable）
 * - POST   /users/:id/reset-password   重設為一次性密碼（user:reset_pwd）
 * - POST   /users/:id/lock             鎖定 30 分鐘（user:update）
 * - POST   /users/:id/unlock           解鎖（user:update）
 */
'use strict';
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const userService = require('../services/userService');

const router = express.Router();
router.use(requireAuth);

const numId = (s) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(ERR.VALIDATION, '用戶 id 不合法');
  return n;
};

router.get('/', requirePerm('user:list'), (req, res) => {
  const q = req.query;
  ok(res, userService.listUsers(getDb(), {
    actor: req.user,
    keyword: q.keyword,
    roleCode: q.role,
    estateCode: q.estate,
    active: q.active === undefined || q.active === '' ? undefined : q.active === '1',
    sortBy: q.sortBy,
    sortDir: q.sortDir,
    page: q.page,
    pageSize: q.pageSize,
  }));
});

router.post('/', requirePerm('user:create'), (req, res) => {
  const out = userService.createUser(getDb(), req.user, req.body || {});
  ok(res, out, 201);
});

router.put('/:id', requirePerm('user:update'), (req, res) => {
  ok(res, userService.updateUser(getDb(), req.user, numId(req.params.id), req.body || {}));
});

router.delete('/:id', requirePerm('user:disable'), (req, res) => {
  ok(res, userService.setActive(getDb(), req.user, numId(req.params.id), false));
});

router.post('/:id/reset-password', requirePerm('user:reset_pwd'), (req, res) => {
  ok(res, userService.resetPassword(getDb(), req.user, numId(req.params.id)));
});

router.post('/:id/lock', requirePerm('user:update'), (req, res) => {
  ok(res, userService.setLock(getDb(), req.user, numId(req.params.id), true));
});

router.post('/:id/unlock', requirePerm('user:update'), (req, res) => {
  ok(res, userService.setLock(getDb(), req.user, numId(req.params.id), false));
});

module.exports = router;
