/**
 * M0 AI 診斷路由（掛載於 /api/v1/ai；全部 requireAuth）。
 * - GET    /api/v1/ai/status   AI 設定現況與環境變數就緒度（config:view）
 * - PUT    /api/v1/ai/api-key  設定 AI API Key（config:update；寫 .env＋即時生效，不入 DB）
 * - DELETE /api/v1/ai/api-key  清除 AI API Key
 * - POST   /api/v1/ai/test     AI 連線測試（config:update；rules 本機即測，遠端送樣本文字）
 * 皆不回傳任何金鑰內容；測試不改動個案，只寫 audit_log（AI_TEST／AI_APIKEY_UPDATE）與 ai_usage_log（task=test）。
 */
'use strict';
const express = require('express');
const { ok, ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const { aiStatus, testAiConnection, saveAiApiKey, scanAiQueue, AI_PROVIDERS } = require('../services/aiService');

const router = express.Router();
router.use(requireAuth);

router.get('/status', requirePerm('config:view'), (req, res) => {
  ok(res, aiStatus(getDb()));
});

/**
 * 設定／清除 AI API Key（body: { apiKey, persist? }；apiKey 空白或 DELETE = 清除）。
 * 金鑰不寫入資料庫：寫入 backend/.env 並即時更新執行期環境（免重啟）。
 */
router.put('/api-key', requirePerm('config:update'), (req, res) => {
  const body = req.body || {};
  ok(res, saveAiApiKey(getDb(), req.user, { apiKey: body.apiKey, persist: body.persist !== false }));
});

router.delete('/api-key', requirePerm('config:update'), (req, res) => {
  ok(res, saveAiApiKey(getDb(), req.user, { apiKey: '', persist: true }));
});

/**
 * 立即處理待辦佇列（ai_suggestion status=pending）。
 * rules 為同步即時；openai/ollama 由排程每 AI_SCAN_INTERVAL_MS 處理，此端點可免等待。
 */
router.post('/scan', requirePerm('config:update'), async (req, res, next) => {
  try {
    const limit = req.body && req.body.limit != null ? Number(req.body.limit) : 20;
    const out = await scanAiQueue(getDb(), { limit });
    ok(res, out);
  } catch (e) {
    next(e);
  }
});

router.post('/test', requirePerm('config:update'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.provider != null && !AI_PROVIDERS.includes(body.provider)) {
      throw new ApiError(ERR.VALIDATION, `provider 須為 ${AI_PROVIDERS.join(' / ')} 之一`);
    }
    if (body.text != null && String(body.text).length > 1000) {
      throw new ApiError(ERR.VALIDATION, '測試文字不得超過 1000 字');
    }
    const out = await testAiConnection(getDb(), req.user, {
      text: body.text,
      provider: body.provider,
    });
    ok(res, out);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
