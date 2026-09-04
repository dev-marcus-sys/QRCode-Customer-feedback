/**
 * F-009 系統參數配置路由（掛載於 /api/v1/config；全部 requireAuth）。
 * - GET  /api/v1/config          配置目錄（config:view）
 * - GET  /api/v1/config/audit    配置變更審計（config:view）
 * - GET  /api/v1/config/:key     單鍵配置（config:view）
 * - PUT  /api/v1/config/:key     更新（config:update；直接生效＋審計，FR-009-02 差異見 §9.3）
 */
'use strict';
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const configService = require('../services/configService');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePerm('config:view'), (req, res) => {
  ok(res, configService.listConfigs(getDb()));
});

router.get('/audit', requirePerm('config:view'), (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1) throw new ApiError(ERR.VALIDATION, 'limit 不合法');
  ok(res, { items: configService.listAudit(getDb(), { key: req.query.key, limit }) });
});

router.get('/:key', requirePerm('config:view'), (req, res) => {
  const one = configService.getOne(getDb(), req.params.key);
  if (!one) throw new ApiError(ERR.VALIDATION, '參數不存在', 404);
  ok(res, one);
});

router.put('/:key', requirePerm('config:update'), (req, res) => {
  const value = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : undefined;
  if (value === undefined) throw new ApiError(ERR.VALIDATION, '請提供 value');
  ok(res, configService.updateConfig(getDb(), req.params.key, value, req.user));
});

module.exports = router;
