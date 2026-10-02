'use strict';
/**
 * 資料庫瀏覽 / SQL 控制台（db:query 權限，僅 ADMIN）：
 * GET  /api/v1/db/tables               列出資料表/視圖（?includeSystem=1 含 sqlite_ 系統表）
 * GET  /api/v1/db/tables/:name/schema  資料表結構（欄位＋建表語句）
 * GET  /api/v1/db/tables/:name/preview?limit=  預覽前 N 筆（預設 100，範圍 1–1000）
 * POST /api/v1/db/query                執行 SQL（白名單：SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE/EXPLAIN）
 */
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const {
  listTables,
  getTableSchema,
  previewTable,
  runSql,
} = require('../services/dbConsoleService');

const router = express.Router();
router.use(requireAuth);
router.use(requirePerm('db:query'));

// 資料表名參數跳脫（路由層再加一層防護，業務層亦會驗證存在）
router.param('name', (req, res, next, name) => {
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]+$/.test(name)) {
    return next(new ApiError(ERR.VALIDATION, '資料表名稱含有非法字元'));
  }
  return next();
});

router.get('/tables', (req, res) => {
  const includeSystem = req.query.includeSystem === '1' || req.query.includeSystem === 'true';
  ok(res, listTables(getDb(), { includeSystem }));
});

router.get('/tables/:name/schema', (req, res) => {
  ok(res, getTableSchema(getDb(), req.params.name));
});

router.get('/tables/:name/preview', (req, res) => {
  ok(res, previewTable(getDb(), req.params.name, req.query.limit));
});

router.post('/query', (req, res) => {
  const { sql } = req.body || {};
  const result = runSql(getDb(), sql, {
    userId: req.user && req.user.userId,
    username: req.user && req.user.username,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  ok(res, result);
});

module.exports = router;
