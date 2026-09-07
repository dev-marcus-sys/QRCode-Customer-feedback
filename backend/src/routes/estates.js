/**
 * 後台「屋苑」管理路由（屋苑主檔 sys_estate）：
 * GET  /api/v1/estates           屋苑清單（含啟用狀態）— 需登入（供後台下拉與名稱對照）
 * POST /api/v1/estates           新增屋苑               — estate:manage
 * PUT  /api/v1/estates/:code     修改名稱/公司代碼/停啟用 — estate:manage
 * 不提供 DELETE：case / qr_code 以 FK 參照 sys_estate，屋苑只能停用。
 * 所有變更動作寫入 audit_log（action=ESTATE_MANAGE）。
 */
'use strict';
const express = require('express');
const { ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const estateService = require('../services/estateService');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  ok(res, estateService.listEstates(getDb()));
});

router.post('/', requirePerm('estate:manage'), (req, res) => {
  const db = getDb();
  const row = estateService.createEstate(db, req.user, req.body || {});
  ok(res, row, 201);
});

router.put('/:estateCode', requirePerm('estate:manage'), (req, res) => {
  const db = getDb();
  const row = estateService.updateEstate(db, req.user, req.params.estateCode, req.body || {});
  ok(res, row);
});

module.exports = router;
