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
const { getConfig } = require('../db/configStore');
const { aiStatus, testAiConnection, saveAiApiKey, scanAiQueue, AI_PROVIDERS } = require('../services/aiService');
const kbService = require('../services/kbService');

/** 讀取布林型配置（sys_config 以 JSON 存 true/false） */
function bool(db, key, dflt) {
  const v = getConfig(db, key);
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return dflt;
}

const router = express.Router();
router.use(requireAuth);

/** 任一權限碼即通過（知識庫讀取：case:view 或 dashboard:view） */
function requireAnyPerm(...codes) {
  return (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    if (!codes.some((c) => perms.includes(c))) {
      return next(new ApiError(ERR.PERMISSION, '權限不足（需 case:view 或 dashboard:view）', 403));
    }
    return next();
  };
}

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

/* ====================== AI-09 RAG 知識庫（§4.9） ====================== */
/**
 * 入庫／重灌知識文件（wiki／Markdown）。body: { docId?, title, source, version?, owner?, status?, content }。
 * 管理權限 kb:manage；文檔治理（審批＋版本＋owner）由調用端於 status 控制。
 */
router.post('/kb/ingest', requirePerm('kb:manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const out = await kbService.ingestDocument(getDb(), {
      docId: b.docId, title: b.title, source: b.source, version: b.version,
      owner: b.owner || req.user.fullName || req.user.username, status: b.status, content: b.content,
    });
    ok(res, out);
  } catch (e) { next(e); }
});

/** 知識文件清單（含停用／待審；管理視圖） */
router.get('/kb/documents', requirePerm('kb:manage'), (req, res) => {
  ok(res, { items: kbService.listKbDocuments(getDb(), { status: req.query.status }) });
});

/** 單一知識文件 */
router.get('/kb/documents/:docId', requirePerm('kb:manage'), (req, res, next) => {
  try {
    const doc = kbService.getKbDocument(getDb(), req.params.docId);
    if (!doc) throw new ApiError(ERR.VALIDATION, '知識文件不存在', 404);
    ok(res, doc);
  } catch (e) { next(e); }
});

/** 啟用／停用／送審（管理） */
router.post('/kb/documents/:docId/status', requirePerm('kb:manage'), (req, res, next) => {
  try {
    const doc = kbService.setKbDocumentStatus(getDb(), req.params.docId, (req.body && req.body.status) || 'active');
    ok(res, doc);
  } catch (e) { next(e); }
});

/** 刪除知識文件（連帶塊，外鍵 CASCADE） */
router.delete('/kb/documents/:docId', requirePerm('kb:manage'), (req, res, next) => {
  try {
    ok(res, kbService.deleteKbDocument(getDb(), req.params.docId));
  } catch (e) { next(e); }
});

/** 檢索（讀取：case:view 或 dashboard:view）。body: { query, topK? } */
router.post('/kb/search', requireAnyPerm('case:view', 'dashboard:view'), async (req, res, next) => {
  try {
    const b = req.body || {};
    ok(res, await kbService.searchKb(getDb(), { query: b.query, topK: b.topK }));
  } catch (e) { next(e); }
});

/** 問答（檢索增強生成；讀取權限同上）。body: { query, topK? } */
router.post('/kb/ask', requireAnyPerm('case:view', 'dashboard:view'), async (req, res, next) => {
  try {
    const b = req.body || {};
    ok(res, await kbService.askKb(getDb(), { query: b.query, topK: b.topK, user: req.user }));
  } catch (e) { next(e); }
});

/**
 * 各頁 AI 功能開關快照（docs/AI_利用方案.md §4.x；router 已 requireAuth，任一登入管理員可讀，不含任何金鑰）。
 * 前端依此決定「個案頁／儀表板／問卷頁／知識庫頁」是否顯示對應 AI 功能。
 * 主開關 ai.enabled 關閉時，除知識庫（ai.kb.enabled 獨立）外其餘 AI 功能一併停用。
 */
router.get('/features', (req, res) => {
  const db = getDb();
  const aiEnabled = bool(db, 'ai.enabled', false);
  const on = (k) => aiEnabled && bool(db, `ai.${k}.enabled`, false);
  ok(res, {
    aiEnabled,
    features: {
      classify: on('classify'),       // AI-01 內容分類建議
      similar: on('similar'),         // AI-02 語意防重
      assign: on('assign'),           // AI-03 智能分派
      draft: on('draft'),             // AI-04 草擬回覆／摘要
      feedback: on('feedback'),       // AI-05 問卷意見分析
      weeklySummary: on('weekly_summary'), // AI-06 週報 AI 摘要
      attachment: on('attachment'),   // AI-07 附件影像理解
      risk: on('risk'),               // AI-08 逾期風險預警
      kb: bool(db, 'ai.kb.enabled', false),                       // AI-09 知識庫檢索
      kbAnswer: bool(db, 'ai.kb.enabled', false) && bool(db, 'ai.kb.answer_enabled', false),
    },
  });
});

module.exports = router;
