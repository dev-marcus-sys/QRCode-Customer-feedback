/**
 * F-010 角色與權限管理路由（掛載於 /api/v1/roles；全部 requireAuth）。
 * - GET    /roles             角色列表（含權限）＋ 全量權限目錄（role:list）
 * - POST   /roles             新增角色（role:manage）
 * - PUT    /roles/:code       修改角色（role:manage）
 * - POST   /roles/copy        複製角色（FR-010-07，role:manage）
 * - DELETE /roles/:code       停用角色（軟刪，role:manage）
 */
'use strict';
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const roleService = require('../services/roleService');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePerm('role:list'), (req, res) => {
  ok(res, { roles: roleService.listRoles(getDb()).items, permissions: roleService.listAllPermissions(getDb()) });
});

router.post('/', requirePerm('role:manage'), (req, res) => {
  ok(res, roleService.createRole(getDb(), req.user, req.body || {}), 201);
});

router.put('/:code', requirePerm('role:manage'), (req, res) => {
  ok(res, roleService.updateRole(getDb(), req.user, req.params.code, req.body || {}));
});

router.post('/copy', requirePerm('role:manage'), (req, res) => {
  ok(res, roleService.copyRole(getDb(), req.user, req.body || {}), 201);
});

router.delete('/:code', requirePerm('role:manage'), (req, res) => {
  const role = roleService.roleToView(getDb(), getDb().prepare('SELECT * FROM sys_role WHERE role_code = ?').get(req.params.code));
  if (!role) throw new ApiError(ERR.VALIDATION, '角色不存在', 404);
  ok(res, roleService.updateRole(getDb(), req.user, req.params.code, { isActive: false }));
});

module.exports = router;
