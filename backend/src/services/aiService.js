/**
 * AI-01 內容分類影子模式服務（M0 橫向層；docs/AI_利用方案.md §4.1/§6.3/§7.1）。
 * - 建案後自動入隊（rules 規則基線即時分類；遠端模型留待排程 tick 處理）；
 * - 無差異 → status=skipped（error='no_diff'），不產生噪音建議；
 * - 有差異 → status=shown，供前台 case:view 查閱；case:update 可採納／忽略；
 * - 採納套用 category / intent / event_type（事件類型有變則重算首次回應 SLA 到期），
 *   並寫 case_log + audit_log（AI_SUGGEST_ACCEPT / AI_SUGGEST_REJECT）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../db/configStore');
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { dbToIso8, toIso8, toDb, parseDb } = require('../utils/time');
const { writeAudit } = require('../utils/audit');
const { inEstates, estateInClause } = require('../utils/estateScope');
const { notifyUser, usersByRole } = require('./notificationService');
const { computeDueDates } = require('./sla');
const crypto = require('crypto');
const { classifyRemote, classifyWithRules, eventTypeOfSuggestion, maskPii, EVENT_ORDER, lexicalEmbed, cosine, sharedEntities, embedRemote } = require('./aiProvider');
const {
  summarizeWithRules, replyDraftWithRules, buildDraftMessages, parseDraftOutput, restorePlaceholders,
  generateRemote, analyzeFeedbackWithRules, analyzeFeedbackRemote, TOPIC_KEYWORDS,
  buildWeeklySummaryMessages, weeklySummaryWithRules, parseWeeklyOutput,
  analyzeAttachmentWithRules, analyzeAttachmentRemote,
  buildRiskReasonMessages, riskReasonWithRules,
} = require('./aiGenerate');
const logger = require('../utils/logger');

const SYSTEM_USER_ID = 0;
const CATEGORY_CODES = ['MO_SERVICE', 'SECURITY', 'MAINTENANCE', 'CLEANLINESS', 'NUISANCE', 'OTHER'];
const INTENT_TYPES = ['COMPLAINT', 'FEEDBACK', 'INQUIRY', 'COMPLIMENT'];
const EXCERPT_LEN = 240;
/** ai.provider 合法值（與 configService CATALOG 之 enum options 一致） */
const AI_PROVIDERS = ['none', 'rules', 'openai', 'ollama'];
/** 連線測試預設樣本文字（含電話以驗證 de-PII 遮罩） */
const TEST_SAMPLE = '廁所天花爆喉漏水，好危險，請盡快派師傅維修。聯絡電話 91234567。';

function cfg(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.classify.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
  };
}

/** AI-02 語意防重設定 */
function cfgSimilar(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.similar.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
    lookbackDays: Number(getConfig(db, 'ai.similar.lookback_days', 30)) || 30,
    threshold: Number(getConfig(db, 'ai.similar.threshold', 0.82)) || 0.82,
    maxMatches: Number(getConfig(db, 'ai.similar.max_matches', 3)) || 3,
  };
}

/** AI-03 智能分派設定 */
function cfgAssign(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.assign.enabled', false),
    lookbackDays: Number(getConfig(db, 'ai.assign.lookback_days', 90)) || 90,
    mapping: getConfig(db, 'ai.assign.category_role', {}) || {},
  };
}

function getCaseCore(db, caseId) {
  return db.prepare(
    'SELECT case_id, estate_code, category_code, event_type, intent_type, is_second_complaint, case_status, comment_content AS content FROM `case` WHERE case_id = ?'
  ).get(caseId);
}

function loadSuggestion(db, suggestionId) {
  return db.prepare('SELECT * FROM ai_suggestion WHERE suggestion_id = ?').get(suggestionId);
}

function assertScope(user, estateCode) {
  if (!inEstates(user && user.estateCode, estateCode)) {
    throw new ApiError(ERR.DATA_SCOPE, null, 403);
  }
}

function usageLog(db, caseId, model, latencyMs, ok, errMsg, task = 'classify') {
  db.prepare(
    'INSERT INTO ai_usage_log (task, case_id, model, latency_ms, ok, error) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(task, caseId, model || null, latencyMs != null ? Math.round(latencyMs) : null, ok ? 1 : 0, errMsg || null);
}

function markFailed(db, s, e, provider, latencyMs) {
  const msg = String((e && e.message) || e).slice(0, 500);
  db.prepare('UPDATE ai_suggestion SET status = \'failed\', error = ? WHERE suggestion_id = ?').run(msg, s.suggestion_id);
  usageLog(db, s.case_id, provider, latencyMs, false, msg);
}

/** 統一寫入結果：與現行判定一致 → skipped；有差異 → shown（payload 含 baseline 供對比） */
function storeClassify(db, s, row, result, latencyMs) {
  const same = row.category_code === result.category
    && row.event_type === result.eventType
    && row.intent_type === result.intent;
  if (same) {
    db.prepare(
      'UPDATE ai_suggestion SET status = \'skipped\', error = \'no_diff\', confidence = ?, model = ? WHERE suggestion_id = ?'
    ).run(result.confidence, result.model || null, s.suggestion_id);
    usageLog(db, s.case_id, result.model, latencyMs, true, null);
    return { status: 'skipped' };
  }
  const payload = {
    category: result.category,
    intent: result.intent,
    urgency: result.urgency,
    eventType: result.eventType,
    reason: result.reason,
    withDiff: true,
    baseline: {
      category: row.category_code,
      intent: row.intent_type,
      eventType: row.event_type,
    },
  };
  db.prepare(
    "UPDATE ai_suggestion SET status = 'shown', payload = ?, confidence = ?, model = ?, error = NULL WHERE suggestion_id = ?"
  ).run(JSON.stringify(payload), result.confidence, result.model || null, s.suggestion_id);
  usageLog(db, s.case_id, result.model, latencyMs, true, null);
  return { status: 'shown' };
}

/** 遠端模型輸出 → 統一分類結果（補 eventType；對 baseline 判斷 changed） */
function normalizeRemote(raw, row, mapping) {
  const eventType = eventTypeOfSuggestion(
    { category: raw.category, intent: raw.intent, urgency: raw.urgency, isSecondComplaint: !!row.is_second_complaint },
    mapping
  );
  return {
    category: raw.category,
    intent: raw.intent,
    urgency: raw.urgency,
    eventType,
    confidence: raw.confidence,
    reason: raw.reason,
    model: raw.model,
  };
}

/** 規則基線即時分類（同步；用於入隊後立即處理與排程掃描） */
function applyClassify(db, suggestionId) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) return;
  const row = getCaseCore(db, s.case_id);
  if (!row) {
    markFailed(db, s, new Error('個案不存在'), 'rules', 0);
    return;
  }
  const started = Date.now();
  try {
    const rules = getConfig(db, 'sla.rules', {});
    const mapping = getConfig(db, 'category.event_mapping', {});
    const result = classifyWithRules(
      { content: row.content, category: row.category_code, isSecondComplaint: !!row.is_second_complaint },
      rules,
      mapping
    );
    storeClassify(db, s, row, result, Date.now() - started);
  } catch (e) {
    markFailed(db, s, e, 'rules', Date.now() - started);
    logger.warn('aiService', `AI-01 分類失敗 ${s.case_id}: ${e.message}`);
  }
}

/**
 * 遠端連線設定（系統參數 ai.api.* 優先；其次環境變數；最後 provider 預設）。
 * 金鑰一律只由環境變數／執行期提供，不存資料庫。
 */
function remoteApiOptions(db) {
  const baseUrl = String(getConfig(db, 'ai.api.base_url', '') || '').trim();
  const model = String(getConfig(db, 'ai.api.model', '') || '').trim();
  return {
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    apiKey: process.env.AI_API_KEY || undefined,
  };
}

/** 遠端模型分類（非同步；de-PII 遮罩後送出） */
async function applyRemote(db, suggestionId) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) return;
  const row = getCaseCore(db, s.case_id);
  const provider = getConfig(db, 'ai.provider', 'openai');
  if (!row) {
    markFailed(db, s, new Error('個案不存在'), provider, 0);
    return;
  }
  const started = Date.now();
  try {
    const mapping = getConfig(db, 'category.event_mapping', {});
    const text = maskPii(String(row.content || ''));
    const raw = await classifyRemote(provider, text, remoteApiOptions(db));
    const result = normalizeRemote(raw, row, mapping);
    storeClassify(db, s, row, result, Date.now() - started);
  } catch (e) {
    markFailed(db, s, e, provider, Date.now() - started);
    logger.warn('aiService', `AI-01 遠端分類失敗 ${s.case_id}: ${e.message}`);
  }
}

/**
 * 建案後入隊（createCaseFromFeedback 呼叫；失敗不影響建案）。
 * @returns {null | {suggestionId:number, status:string}}
 */
function enqueueClassify(db, caseId) {
  const { enabled, provider } = cfg(db);
  if (!enabled || provider === 'none') return null;
  const row = getCaseCore(db, caseId);
  if (!row) return null;
  const excerpt = maskPii(String(row.content || '')).slice(0, EXCERPT_LEN);
  const info = db.prepare(
    'INSERT INTO ai_suggestion (case_id, ai_type, status, input_excerpt, created_by) VALUES (?, \'classify\', \'pending\', ?, ?)'
  ).run(caseId, excerpt, SYSTEM_USER_ID);
  const suggestionId = Number(info.lastInsertRowid);
  if (provider === 'rules') {
    try {
      applyClassify(db, suggestionId);
    } catch (e) {
      logger.warn('aiService', `AI-01 入隊處理失敗 ${caseId}: ${e.message}`);
    }
  }
  return { suggestionId, status: 'pending' };
}

/** 排程掃描：處理未處理建議（classify 與 similar_case 共用；開關已關 → skipped） */
async function processClassifyQueue(db, { limit = 5 } = {}) {
  const provider = getConfig(db, 'ai.provider', 'rules');
  const n = Math.max(1, Math.min(Number(limit) || 5, 50));
  const pending = db.prepare(
    "SELECT suggestion_id, case_id, ai_type FROM ai_suggestion WHERE ai_type IN ('classify','similar_case') AND status = 'pending' ORDER BY created_at, suggestion_id LIMIT ?"
  ).all(n);
  let processed = 0;
  for (const s of pending) {
    if (s.ai_type === 'similar_case') {
      if (!cfgSimilar(db).enabled || provider === 'none') {
        db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'disabled' WHERE suggestion_id = ?").run(s.suggestion_id);
      } else if (provider === 'rules') {
        applySimilar(db, s.suggestion_id);
      } else {
        await applySimilar(db, s.suggestion_id);
      }
    } else {
      const { enabled } = cfg(db);
      if (!enabled || provider === 'none') {
        db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'disabled' WHERE suggestion_id = ?").run(s.suggestion_id);
      } else if (provider === 'rules') {
        applyClassify(db, s.suggestion_id);
      } else {
        await applyRemote(db, s.suggestion_id);
      }
    }
    processed += 1;
  }
  return { processed };
}

/* ====================== AI-02 語意防重／相似個案偵測（§4.2） ====================== */

/** 取得個案 embedding（優先讀快取；遠端失敗自動回落本地詞彙向量） */
async function ensureEmbedding(db, caseId) {
  const c = getCaseCore(db, caseId);
  if (!c) return null;
  const { enabled, provider } = cfgSimilar(db);
  if (!enabled) return null;
  const model = provider === 'rules' ? 'lexical' : `${provider}:embed`;
  const exist = db.prepare('SELECT vector FROM ai_embedding WHERE case_id = ? AND model = ?').get(caseId, model);
  if (exist) return JSON.parse(exist.vector);
  const text = maskPii(String(c.content || ''));
  let vector;
  let usedModel = model;
  try {
    if (provider === 'rules') {
      vector = lexicalEmbed(text);
    } else {
      const r = await embedRemote(provider, [text], remoteApiOptions(db));
      vector = r.vectors[0];
      usedModel = r.model;
    }
  } catch (e) {
    logger.warn('aiService', `AI-02 embedding 失敗 ${caseId}，回落本地向量：${e.message}`);
    vector = lexicalEmbed(text);
    usedModel = 'lexical-fallback';
  }
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  db.prepare(
    'INSERT OR REPLACE INTO ai_embedding (case_id, model, dim, vector, text_hash, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
  ).run(caseId, usedModel, vector.length, JSON.stringify(vector), hash);
  return vector;
}

/** 同步版 ensureEmbedding（rules 詞彙向量用；建案入隊需即時產生結果） */
function ensureEmbeddingSync(db, caseId) {
  const c = getCaseCore(db, caseId);
  if (!c) return null;
  const exist = db.prepare('SELECT vector FROM ai_embedding WHERE case_id = ? AND model = ?').get(caseId, 'lexical');
  if (exist) return JSON.parse(exist.vector);
  const text = maskPii(String(c.content || ''));
  const vector = lexicalEmbed(text);
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  db.prepare(
    'INSERT OR REPLACE INTO ai_embedding (case_id, model, dim, vector, text_hash, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
  ).run(caseId, 'lexical', vector.length, JSON.stringify(vector), hash);
  return vector;
}

/** 核心：以 vector 比對近 N 日同屋苑未關閉個案（同步） */
function matchSimilar(db, caseId, cfgS, vector) {
  const c = getCaseCore(db, caseId);
  const since = toDb(new Date(Date.now() - cfgS.lookbackDays * 86400000));
  const cand = db.prepare(
    `SELECT case_id, estate_code, comment_content AS content, category_code
       FROM \`case\`
      WHERE estate_code = ? AND case_id <> ? AND case_status <> 'CLOSED' AND created_at >= ?
      ORDER BY created_at DESC LIMIT 200`
  ).all(c.estate_code, caseId, since);
  const matches = [];
  for (const other of cand) {
    const ov = ensureEmbeddingSync(db, other.case_id);
    if (!ov) continue;
    const score = cosine(vector, ov);
    if (score >= cfgS.threshold) {
      matches.push({
        caseId: other.case_id,
        category: other.category_code,
        score: Number(score.toFixed(3)),
        sharedEntities: sharedEntities(String(c.content || ''), String(other.content || '')),
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return {
    threshold: cfgS.threshold,
    lookbackDays: cfgS.lookbackDays,
    model: cfgS.provider === 'rules' ? 'lexical' : cfgS.provider,
    matches: matches.slice(0, cfgS.maxMatches),
  };
}

/** 比對近 N 日同屋苑未關閉個案，回傳相似個案列表 */
async function findSimilarCases(db, caseId) {
  const c = getCaseCore(db, caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  const cfgS = cfgSimilar(db);
  if (!cfgS.enabled) return { enabled: false, matches: [] };
  const vector = await ensureEmbedding(db, caseId);
  if (!vector) return { enabled: true, matches: [] };
  return { enabled: true, ...matchSimilar(db, caseId, cfgS, vector) };
}

/** 同步版（rules 詞彙向量；建案入隊即時完成，毋須等待排程） */
function findSimilarCasesSync(db, caseId) {
  const c = getCaseCore(db, caseId);
  if (!c) return null;
  const cfgS = cfgSimilar(db);
  if (!cfgS.enabled) return null;
  const vector = ensureEmbeddingSync(db, caseId);
  if (!vector) return null;
  return { enabled: true, ...matchSimilar(db, caseId, cfgS, vector) };
}

/** 建案後入隊（createCaseFromFeedback / reanalyze 呼叫） */
function enqueueSimilar(db, caseId) {
  const cfgS = cfgSimilar(db);
  if (!cfgS.enabled || cfgS.provider === 'none') return null;
  const c = getCaseCore(db, caseId);
  if (!c) return null;
  const excerpt = maskPii(String(c.content || '')).slice(0, EXCERPT_LEN);
  const info = db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status, input_excerpt, created_by) VALUES (?, 'similar_case', 'pending', ?, ?)"
  ).run(caseId, excerpt, SYSTEM_USER_ID);
  const suggestionId = Number(info.lastInsertRowid);
  if (cfgS.provider === 'rules') {
    try { applySimilarSync(db, suggestionId); } catch (e) { logger.warn('aiService', `AI-02 入隊處理失敗 ${caseId}: ${e.message}`); }
  }
  return { suggestionId, status: 'pending' };
}

/** 同步處理單筆相似個案建議（rules 詞彙向量；建案入隊即時完成） */
function applySimilarSync(db, suggestionId) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) return;
  if (!cfgSimilar(db).enabled) {
    db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'disabled' WHERE suggestion_id = ?").run(s.suggestion_id);
    return;
  }
  try {
    const res = findSimilarCasesSync(db, s.case_id);
    if (!res || !res.matches.length) {
      db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'no_match', model = ? WHERE suggestion_id = ?").run(res ? res.model : null, s.suggestion_id);
      usageLog(db, s.case_id, res ? res.model : 'lexical', 0, true, null, 'similar');
    } else {
      db.prepare(
        "UPDATE ai_suggestion SET status = 'shown', payload = ?, confidence = ?, model = ?, error = NULL WHERE suggestion_id = ?"
      ).run(JSON.stringify({
        matches: res.matches,
        threshold: res.threshold,
        lookbackDays: res.lookbackDays,
      }), Math.max(...res.matches.map((m) => m.score)), res.model, s.suggestion_id);
      usageLog(db, s.case_id, res.model, 0, true, null, 'similar');
    }
  } catch (e) {
    markFailed(db, s, e, 'lexical', 0);
  }
}

/** 處理單筆相似個案建議（遠端 await；排程掃描用） */
async function applySimilar(db, suggestionId) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) return;
  if (!cfgSimilar(db).enabled) {
    db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'disabled' WHERE suggestion_id = ?").run(s.suggestion_id);
    return;
  }
  const started = Date.now();
  try {
    const res = await findSimilarCases(db, s.case_id);
    if (!res.matches.length) {
      db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'no_match', model = ? WHERE suggestion_id = ?").run(res.model || null, s.suggestion_id);
      usageLog(db, s.case_id, res.model, Date.now() - started, true, null, 'similar');
    } else {
      db.prepare(
        "UPDATE ai_suggestion SET status = 'shown', payload = ?, confidence = ?, model = ?, error = NULL WHERE suggestion_id = ?"
      ).run(JSON.stringify({
        matches: res.matches,
        threshold: res.threshold,
        lookbackDays: res.lookbackDays,
      }), Math.max(...res.matches.map((m) => m.score)), res.model, s.suggestion_id);
      usageLog(db, s.case_id, res.model, Date.now() - started, true, null, 'similar');
    }
  } catch (e) {
    markFailed(db, s, e, cfgSimilar(db).provider, Date.now() - started);
  }
}

/** 人員確認相似個案為重複 → 關聯 original_case_id（case:update） */
function linkSimilarCase(db, suggestionId, user, { targetCaseId }) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) throw new ApiError(ERR.VALIDATION, 'AI 建議不存在', 404);
  const c = getCaseCore(db, s.case_id);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  if (s.status !== 'shown') throw new ApiError(ERR.STATE_TRANSITION, `該建議目前狀態為 ${s.status}，不能操作`);
  if (!targetCaseId) throw new ApiError(ERR.VALIDATION, '需指定關聯個案');
  const target = getCaseCore(db, targetCaseId);
  if (!target) throw new ApiError(ERR.VALIDATION, '關聯個案不存在', 404);
  if (target.case_id === s.case_id) throw new ApiError(ERR.VALIDATION, '不能關聯自身個案');
  const actorId = user ? user.userId : SYSTEM_USER_ID;
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE `case` SET original_case_id = ?, is_second_complaint = 1, updated_at = datetime('now') WHERE case_id = ?"
    ).run(target.case_id, s.case_id);
    db.prepare(
      "UPDATE ai_suggestion SET status = 'accepted', decided_by = ?, decided_at = datetime('now'), decided_note = ? WHERE suggestion_id = ?"
    ).run(actorId, `關聯至 ${target.case_id}`, s.suggestion_id);
    db.prepare(
      "INSERT INTO case_log (case_id, log_type, log_content, old_status, new_status, action_by) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(s.case_id, 'UPDATE', `經 AI-02 語意防重建議，關聯至 ${target.case_id}`, c.case_status, c.case_status, actorId);
    writeAudit(db, {
      userId: actorId, username: user ? user.username : 'SYSTEM', action: 'CASE_LINK_SIMILAR',
      targetType: 'CASE', targetId: s.case_id,
      detail: { caseId: s.case_id, targetCaseId, suggestionId: s.suggestionId },
    });
  });
  tx();
  return { suggestionId: s.suggestionId, caseId: s.case_id, status: 'accepted', originalCaseId: target.case_id };
}

/* ====================== AI-03 智能分派建議（§4.3 級一：規則＋SQL 統計） ====================== */

/** 取得屋苑可處理候選人（與 caseService.getAssignees 同邏輯，避免循環依賴） */
function getCandidates(db, estateCode) {
  return db.prepare(
    `SELECT u.user_id AS userId, u.full_name AS fullName, u.email AS email, u.estate_code AS estateCode,
            GROUP_CONCAT(r.role_name) AS roleNames,
            GROUP_CONCAT(r.role_code) AS roleCodes
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.user_id
       JOIN sys_role r ON r.role_id = ur.role_id
      WHERE u.is_active = 1 AND r.is_active = 1
        AND r.role_code IN ('ESTATE_STAFF','ESTATE_SUPERVISOR','CC_STAFF')
        AND (r.data_scope = 'ALL' OR (',' || u.estate_code || ',') LIKE ?)
      GROUP BY u.user_id`
  ).all(`%,${estateCode},%`);
}

/** 智能分派建議（即時計算；建議寫入 ai_suggestion 僅供質素分析，採納仍走現有 assign API） */
function suggestAssignee(db, caseId, user) {
  const c = getCaseCore(db, caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const cfgA = cfgAssign(db);
  if (!cfgA.enabled) return { enabled: false, candidates: [] };

  const rows = getCandidates(db, c.estate_code);
  const since = toDb(new Date(Date.now() - cfgA.lookbackDays * 86400000));
  const preferredRole = cfgA.mapping[c.category_code];

  const candidates = rows.map((u) => {
    const stats = db.prepare(
      `SELECT COUNT(*) AS n,
              AVG(CASE WHEN closed_at IS NOT NULL THEN (julianday(closed_at) - julianday(created_at)) END) AS avgDays,
              SUM(CASE WHEN response_sla_met = 0 AND response_sla_due IS NOT NULL AND first_response_at IS NOT NULL THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN response_sla_due IS NOT NULL AND first_response_at IS NOT NULL THEN 1 ELSE 0 END) AS judged
         FROM \`case\` WHERE assigned_to = ? AND category_code = ? AND created_at >= ?`
    ).get(u.userId, c.category_code, since);
    const openRow = db.prepare(
      "SELECT COUNT(*) AS n FROM `case` WHERE assigned_to = ? AND case_status IN ('ASSIGNED','IN_PROGRESS','WAITING')"
    ).get(u.userId);
    const roleNames = (u.roleNames || '').split(',');
    const roleCodes = (u.roleCodes || '').split(',');
    const isPreferred = !!(preferredRole && roleCodes.includes(preferredRole));
    const n = stats.n || 0;
    const avgDays = stats.avgDays || null;
    const judged = stats.judged || 0;
    const overdue = stats.overdue || 0;
    const openCount = openRow.n || 0;

    const volumeScore = Math.min(n / 10, 1);
    const speedScore = avgDays == null ? 0.5 : Math.max(0, Math.min(1, 1 - avgDays / 10));
    const qualityScore = judged ? 1 - overdue / judged : 0.6;
    const score = 0.35 * volumeScore + 0.25 * speedScore + 0.25 * qualityScore
      + (isPreferred ? 0.15 : 0) - Math.min(openCount / 10, 1) * 0.1;

    let reason;
    if (n === 0) reason = '近 90 日無同類別處理紀錄，依角色預設排序';
    else reason = `近 ${cfgA.lookbackDays} 日處理 ${n} 宗同類別，平均 ${avgDays != null ? avgDays.toFixed(1) : '-'} 日結案${judged ? `，逾期率 ${Math.round((overdue / judged) * 100)}%` : ''}`;
    if (isPreferred) reason += '（類別對應偏好角色）';

    return {
      userId: u.userId, fullName: u.fullName, email: u.email, roles: roleNames, roleCodes,
      isPreferredRole: isPreferred,
      stats: { sameCategoryCount: n, avgHandlingDays: avgDays, judged, overdue, openCount },
      score: Number(score.toFixed(3)),
      reason,
    };
  });
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] || null;
  return {
    enabled: true,
    category: c.category_code,
    preferredRole: preferredRole || null,
    lookbackDays: cfgA.lookbackDays,
    suggestedUserId: top ? top.userId : null,
    suggestedUserName: top ? top.fullName : null,
    candidates,
  };
}

/** 查閱個案 AI 建議（case:view；屋苑範圍由路由層保證，此處亦防呆） */
function listAiSuggestions(db, caseId, user) {
  const c = db.prepare('SELECT estate_code FROM `case` WHERE case_id = ?').get(caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const rows = db.prepare(
    `SELECT s.suggestion_id AS suggestionId, s.case_id AS caseId, s.ai_type AS aiType, s.status,
            s.payload, s.input_excerpt AS inputExcerpt, s.confidence, s.model, s.error,
            s.created_at AS createdAt, s.decided_by AS decidedBy, s.decided_at AS decidedAt,
            s.decided_note AS decidedNote, u.full_name AS decidedByName
       FROM ai_suggestion s LEFT JOIN sys_user u ON u.user_id = s.decided_by
      WHERE s.case_id = ?
      ORDER BY s.suggestion_id DESC LIMIT 20`
  ).all(caseId);
  return rows.map((r) => ({
    suggestionId: r.suggestionId,
    caseId: r.caseId,
    aiType: r.aiType,
    status: r.status,
    payload: r.payload ? JSON.parse(r.payload) : null,
    inputExcerpt: r.inputExcerpt,
    confidence: r.confidence,
    model: r.model,
    error: r.error,
    createdAt: dbToIso8(r.createdAt),
    decidedAt: dbToIso8(r.decidedAt),
    decidedByName: r.decidedByName || null,
    decidedNote: r.decidedNote || null,
  }));
}

/**
 * 採納／忽略 AI 建議（case:update）。
 * @param {{ userId:number, username:string, estateCode?:string }} user
 */
function decideAiSuggestion(db, suggestionId, user, { accept, note }) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) throw new ApiError(ERR.VALIDATION, 'AI 建議不存在', 404);
  const c = getCaseCore(db, s.case_id);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  if (s.status !== 'shown') {
    throw new ApiError(ERR.STATE_TRANSITION, `該建議目前狀態為 ${s.status}，不能操作`);
  }
  const trimmed = typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null;
  return accept ? applySuggestion(db, s, c, user, trimmed) : rejectSuggestion(db, s, user, trimmed);
}

function applySuggestion(db, s, c, user, note) {
  let payload;
  try {
    payload = JSON.parse(s.payload || '{}');
  } catch {
    payload = {};
  }
  const cat = CATEGORY_CODES.includes(payload.category) ? payload.category : null;
  const intent = INTENT_TYPES.includes(payload.intent) ? payload.intent : null;
  const evt = EVENT_ORDER.includes(payload.eventType) ? payload.eventType : null;
  if (!cat && !intent && !evt) throw new ApiError(ERR.VALIDATION, 'AI 建議缺少可套用欄位');
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  const actorId = user ? user.userId : SYSTEM_USER_ID;

  const tx = db.transaction(() => {
    const sets = [];
    const vals = [];
    if (cat && cat !== c.category_code) {
      sets.push('category_code = ?');
      vals.push(cat);
    }
    if (intent && intent !== c.intent_type) {
      sets.push('intent_type = ?');
      vals.push(intent);
    }
    let newDueDb = null;
    if (evt && evt !== c.event_type) {
      sets.push('event_type = ?');
      vals.push(evt);
      newDueDb = computeDueDates(db, new Date(), evt).responseDue;
      sets.push('response_sla_due = ?');
      vals.push(newDueDb);
    }
    const detail = { caseId: s.case_id, suggestionId: s.suggestion_id, aiType: s.ai_type, note, reason };
    if (!sets.length) {
      db.prepare(
        'UPDATE ai_suggestion SET status = \'accepted\', decided_by = ?, decided_at = datetime(\'now\'), decided_note = ? WHERE suggestion_id = ?'
      ).run(actorId, note, s.suggestion_id);
      db.prepare(
        'INSERT INTO case_log (case_id, log_type, log_content, old_status, new_status, action_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(s.case_id, 'UPDATE', 'AI 分類建議已採納（與現行判定一致，無欄位變更）', c.case_status, c.case_status, actorId);
      db.prepare(
        'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(actorId, user ? user.username : 'SYSTEM', 'AI_SUGGEST_ACCEPT', 'CASE', s.case_id,
        JSON.stringify({ ...detail, changes: [] }));
      return { changes: [], responseSlaDue: null };
    }

    sets.push('updated_at = datetime(\'now\')');
    const changeSql = [];
    if (cat && cat !== c.category_code) changeSql.push(`類別 ${c.category_code}→${cat}`);
    if (intent && intent !== c.intent_type) changeSql.push(`意圖 ${c.intent_type}→${intent}`);
    if (evt && evt !== c.event_type) {
      changeSql.push(`事件類型 ${c.event_type}→${evt}`);
      if (newDueDb) changeSql.push('首次回應時限已按新事件類型重算');
    }
    db.prepare(`UPDATE \`case\` SET ${sets.join(', ')} WHERE case_id = ?`).run(...vals, s.case_id);
    db.prepare(
      'UPDATE ai_suggestion SET status = \'accepted\', decided_by = ?, decided_at = datetime(\'now\'), decided_note = ? WHERE suggestion_id = ?'
    ).run(actorId, note, s.suggestion_id);
    db.prepare(
      'INSERT INTO case_log (case_id, log_type, log_content, old_status, new_status, action_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(s.case_id, 'UPDATE', `採納 AI 分類建議。變更：${changeSql.join('；')}（AI 理由：${reason}）`, c.case_status, c.case_status, actorId);
    db.prepare(
      'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(actorId, user ? user.username : 'SYSTEM', 'AI_SUGGEST_ACCEPT', 'CASE', s.case_id,
      JSON.stringify({ ...detail, changes: changeSql }));
    return { changes: changeSql, responseSlaDue: newDueDb ? dbToIso8(newDueDb) : null };
  });
  return { suggestionId: s.suggestion_id, caseId: s.case_id, status: 'accepted', ...tx() };
}

function rejectSuggestion(db, s, user, note) {
  const actorId = user ? user.userId : SYSTEM_USER_ID;
  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE ai_suggestion SET status = \'rejected\', decided_by = ?, decided_at = datetime(\'now\'), decided_note = ? WHERE suggestion_id = ?'
    ).run(actorId, note, s.suggestion_id);
    db.prepare(
      'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(actorId, user ? user.username : 'SYSTEM', 'AI_SUGGEST_REJECT', 'CASE', s.case_id,
      JSON.stringify({ caseId: s.case_id, suggestionId: s.suggestion_id, aiType: s.ai_type, note }));
  });
  tx();
  return { suggestionId: s.suggestion_id, caseId: s.case_id, status: 'rejected' };
}

/**
 * AI 設定現況（F-009 診斷用；只回「是否已設定」，絕不回傳金鑰內容）。
 * @returns {object} provider / 開關狀態 / 環境變數就緒度
 */
function aiStatus(db) {
  const aiEnabled = !!getConfig(db, 'ai.enabled', false);
  const classifyEnabled = !!getConfig(db, 'ai.classify.enabled', false);
  const provider = getConfig(db, 'ai.provider', 'rules');
  const isOllama = provider === 'ollama';
  const raw = process.env.AI_SCAN_INTERVAL_MS;
  const n = raw === undefined || raw === '' ? 60000 : Number(raw);
  const scanIntervalMs = Number.isFinite(n) && n > 0 ? n : null;

  const dbBaseUrl = String(getConfig(db, 'ai.api.base_url', '') || '').trim();
  const dbModel = String(getConfig(db, 'ai.api.model', '') || '').trim();
  const envBaseUrl = String(process.env.AI_BASE_URL || '').trim();
  const envModel = String(process.env.AI_MODEL || '').trim();
  const baseUrl = (dbBaseUrl || envBaseUrl).replace(/\/+$/, '') || (isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1');
  const model = dbModel || envModel || (isOllama ? 'qwen2.5:7b' : 'gpt-4o-mini');

  return {
    provider,
    aiEnabled,
    classifyEnabled,
    effective: aiEnabled && classifyEnabled && provider !== 'none',
    piiMode: getConfig(db, 'ai.pii.mode', 'local'),
    providers: AI_PROVIDERS,
    env: {
      baseUrl,
      model,
      baseUrlSource: dbBaseUrl ? 'db' : envBaseUrl ? 'env' : 'default',
      modelSource: dbModel ? 'db' : envModel ? 'env' : 'default',
      baseUrlSet: !!(dbBaseUrl || envBaseUrl),
      apiKeySet: !!String(process.env.AI_API_KEY || '').trim(),
      apiKeyMasked: maskSecret(process.env.AI_API_KEY),
      scanIntervalMs,
      scanEnabled: scanIntervalMs !== null,
    },
    checkedAt: toIso8(new Date()),
  };
}

/**
 * 為指定個案（重新）產生分類建議；供前端「重新分析」與補跑舊個案之用。
 * 建案流程只對公眾提交個案自動入隊，故後台建案／開關開啟前之個案需由此補跑。
 * @returns {object[]} 該個案之建議清單（供前端直接刷新）
 */
async function reanalyzeCase(db, caseId, user) {
  const c = getCaseCore(db, caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const { enabled, provider } = cfg(db);
  if (!enabled || provider === 'none') {
    throw new ApiError(
      ERR.VALIDATION,
      'AI 分類尚未啟用：請先於「系統參數 → AI 參數」開啟 AI 總開關與 AI-01 內容分類建議，並將供應商設為 rules / openai / ollama'
    );
  }
  const excerpt = maskPii(String(c.content || '')).slice(0, EXCERPT_LEN);
  const info = db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status, input_excerpt, created_by) VALUES (?, 'classify', 'pending', ?, ?)"
  ).run(caseId, excerpt, user ? user.userId : SYSTEM_USER_ID);
  const suggestionId = Number(info.lastInsertRowid);
  if (provider === 'rules') applyClassify(db, suggestionId);
  else await applyRemote(db, suggestionId);

  // 若 AI-02 已啟用，同場重新產生相似個案建議
  try {
    enqueueSimilar(db, caseId);
  } catch (e) {
    logger.warn('aiService', `重新分析：AI-02 入隊失敗 ${caseId}: ${e.message}`);
  }

  writeAudit(db, {
    userId: user ? user.userId : SYSTEM_USER_ID,
    username: user ? user.username : 'SYSTEM',
    action: 'AI_REANALYZE',
    targetType: 'CASE',
    targetId: caseId,
    detail: { caseId, suggestionId, provider },
  });
  return listAiSuggestions(db, caseId, user);
}

/** 敏感值遮罩（只留前 3 與末 4 位；過短則全遮） */
function maskSecret(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.length <= 8) return '********';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** .env 檔案路徑（可用 AI_ENV_FILE 覆寫，便於測試與容器掛載） */
function envFilePath() {
  return process.env.AI_ENV_FILE || path.resolve(__dirname, '../../.env');
}

/** 新增／更新 .env 內指定鍵（保留其他行與註解） */
function upsertEnvFile(pairs) {
  const file = envFilePath();
  let text = '';
  if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
  let next = text;
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    next = re.test(next) ? next.replace(re, line) : `${next.replace(/\s*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(file, next, 'utf8');
  return file;
}

/**
 * 儲存／清除 AI API Key（config:update）。
 * 金鑰**不寫入資料庫**：寫入 backend/.env 並即時更新 process.env（免重啟）；
 * 若 .env 不可寫（如唯讀容器）則只生效於執行期，回傳 persisted=false 提示改用環境變數。
 * 審計只記錄「是否已設定」，不記錄金鑰內容。
 * @returns {{ apiKeySet:boolean, apiKeyMasked:string|null, persisted:boolean, persistedAt:string|null, persistError:string|null }}
 */
function saveAiApiKey(db, user, { apiKey, persist = true } = {}) {
  const value = String(apiKey == null ? '' : apiKey).trim();
  if (value.length > 500) throw new ApiError(ERR.VALIDATION, 'API Key 長度不得超過 500 字');
  let persisted = false;
  let persistError = null;
  if (persist) {
    try {
      upsertEnvFile({ AI_API_KEY: value });
      persisted = true;
    } catch (e) {
      persistError = String((e && e.message) || e).slice(0, 200);
      logger.warn('aiService', `AI_API_KEY 未能寫入 .env：${persistError}`);
    }
  }
  if (value) process.env.AI_API_KEY = value;
  else delete process.env.AI_API_KEY;

  writeAudit(db, {
    userId: user ? user.userId : SYSTEM_USER_ID,
    username: user ? user.username : 'SYSTEM',
    action: 'AI_APIKEY_UPDATE',
    targetType: 'AI',
    targetId: 'AI_API_KEY',
    detail: { apiKeySet: !!value, persisted, persistError },
  });
  return {
    apiKeySet: !!value,
    apiKeyMasked: maskSecret(value),
    persisted,
    persistedAt: persisted ? envFilePath() : null,
    persistError,
  };
}

/**
 * AI 連線測試（F-009 診斷；不改動任何個案）。
 * - none：直接回「已停用」；rules：本機規則基線即時分類（零外部依賴）；
 * - openai/ollama：de-PII 遮罩後送樣本文字，回傳模型輸出與延遲；失敗回傳錯誤原因。
 * 每次測試皆寫 audit_log（action=AI_TEST）；遠端測試另寫 ai_usage_log（task=test）。
 * @param {{ userId:number, username:string }} user
 * @param {{ text?:string, provider?:string }} [opts]
 */
async function testAiConnection(db, user, opts = {}) {
  const current = getConfig(db, 'ai.provider', 'rules');
  const provider = AI_PROVIDERS.includes(opts.provider) ? opts.provider : current;
  const sample = String(opts.text || '').trim().slice(0, 1000) || TEST_SAMPLE;
  const mapping = getConfig(db, 'category.event_mapping', {});
  const started = Date.now();
  const head = { provider, testedAt: toIso8(new Date()) };
  let out;

  if (provider === 'none') {
    out = {
      ...head, ok: false, local: true, skipped: true, latencyMs: 0, model: null,
      message: 'ai.provider = none，AI 已停用（不會呼叫任何外部服務）', result: null, error: null,
    };
  } else if (provider === 'rules') {
    try {
      const rules = getConfig(db, 'sla.rules', {});
      const r = classifyWithRules({ content: sample, category: 'OTHER', isSecondComplaint: false }, rules, mapping);
      out = {
        ...head, ok: true, local: true, skipped: false, latencyMs: Date.now() - started, model: 'rules',
        message: '規則基線（本機）分類成功，無需外部連線',
        result: {
          category: r.category, intent: r.intent, urgency: r.urgency,
          eventType: r.eventType, confidence: r.confidence, reason: r.reason,
        },
        error: null,
      };
    } catch (e) {
      out = {
        ...head, ok: false, local: true, skipped: false, latencyMs: Date.now() - started, model: 'rules',
        message: '規則基線執行失敗', result: null, error: String((e && e.message) || e).slice(0, 300),
      };
    }
  } else {
    try {
      const raw = await classifyRemote(provider, maskPii(sample), remoteApiOptions(db));
      const eventType = eventTypeOfSuggestion(
        { category: raw.category, intent: raw.intent, urgency: raw.urgency, isSecondComplaint: false },
        mapping
      );
      out = {
        ...head, ok: true, local: false, skipped: false, latencyMs: Date.now() - started, model: raw.model,
        message: `${provider} 連線成功`,
        result: {
          category: raw.category, intent: raw.intent, urgency: raw.urgency,
          eventType, confidence: raw.confidence, reason: raw.reason,
        },
        error: null,
      };
      usageLog(db, null, raw.model, out.latencyMs, true, null, 'test');
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 300);
      const hint = /AI_API_KEY/.test(msg)
        ? '（尚未設定 API Key：請於「系統參數 → AI 連線測試 → AI API 連線設定」輸入並儲存，或於後端設定環境變數 AI_API_KEY）'
        : '';
      out = {
        ...head, ok: false, local: false, skipped: false, latencyMs: Date.now() - started, model: null,
        message: `${provider} 連線失敗${hint}`, result: null, error: msg,
      };
      usageLog(db, null, provider, out.latencyMs, false, msg, 'test');
      logger.warn('aiService', `AI 連線測試失敗（${provider}）：${msg}`);
    }
  }

  writeAudit(db, {
    userId: user ? user.userId : SYSTEM_USER_ID,
    username: user ? user.username : 'SYSTEM',
    action: 'AI_TEST',
    targetType: 'AI',
    targetId: provider,
    detail: { provider, ok: out.ok, latencyMs: out.latencyMs, model: out.model || null, error: out.error },
  });
  return out;
}

/* ====================== AI-04 草擬回覆／個案摘要（§4.4；人審先發，不自動寄出） ====================== */

function cfgDraft(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.draft.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
    styleGuide: String(getConfig(db, 'ai.draft.style_guide', '') || '').trim(),
  };
}

function getCaseDraftContext(db, caseId) {
  return db.prepare(
    `SELECT c.case_id AS caseId, c.estate_code AS estateCode, e.estate_name_zh AS estateNameZh,
            c.category_code AS categoryCode, c.event_type AS eventType, c.intent_type AS intentType,
            c.customer_title AS customerTitle, c.customer_name AS customerName,
            c.comment_content AS content, c.customer_block AS block, c.customer_floor AS floor,
            c.customer_unit AS unit, c.incident_date AS incidentDate,
            c.response_sla_due AS responseSlaDue, c.case_status AS caseStatus
       FROM \`case\` c LEFT JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE c.case_id = ?`
  ).get(caseId);
}

function addressOf(ctx) {
  return [ctx.block ? `${ctx.block}座` : '', ctx.floor, ctx.unit].filter(Boolean).join(' ');
}

function draftPlaceholderValues(ctx) {
  return {
    '{{稱呼}}': `${String(ctx.customerTitle || '').trim()}${String(ctx.customerName || '').trim()}`.trim() || '住戶',
    '{{個案編號}}': ctx.caseId,
    '{{屋苑}}': ctx.estateNameZh || '',
    '{{類別}}': ctx.categoryCode || '',
    '{{承諾回覆時間}}': ctx.responseSlaDue ? String(ctx.responseSlaDue).replace('T', ' ').slice(0, 16) : '（盡快）',
  };
}

/**
 * 產生個案摘要（kind=summary）或回覆草稿（kind=reply）。
 * - rules provider：零依賴範本；遠端失敗自動回落範本（fallback）。
 * - 識別資料以佔位符送雲端，回應後於伺服器端還原（PII 不外送）。
 * - 只產生建議，不自動發信。
 */
async function createDraft(db, caseId, user, { kind = 'summary', lang = 'zh-Hant' } = {}) {
  const cfgD = cfgDraft(db);
  if (!cfgD.enabled) {
    throw new ApiError(ERR.VALIDATION, 'AI-04 草擬功能未啟用（請於系統參數開啟 AI 總開關與「AI-04 草擬回覆／個案摘要」）');
  }
  if (kind !== 'summary' && kind !== 'reply') throw new ApiError(ERR.VALIDATION, 'kind 須為 summary 或 reply');
  const ctx = getCaseDraftContext(db, caseId);
  if (!ctx) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, ctx.estateCode);

  const content = maskPii(String(ctx.content || ''));
  const excerpt = content.slice(0, EXCERPT_LEN);
  const info = db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status, input_excerpt, created_by) VALUES (?, 'draft', 'pending', ?, ?)"
  ).run(caseId, excerpt, user ? user.userId : SYSTEM_USER_ID);
  const suggestionId = Number(info.lastInsertRowid);
  const started = Date.now();
  const address = addressOf(ctx);
  const useRemote = cfgD.provider !== 'rules' && cfgD.provider !== 'none';

  let payload;
  let model = 'rules';
  let confidence = 0.7;
  if (useRemote) {
    try {
      const messages = buildDraftMessages({
        kind, lang, content, category: ctx.categoryCode, estateNameZh: ctx.estateNameZh,
        eventType: ctx.eventType, responseSlaDue: ctx.responseSlaDue, styleGuide: cfgD.styleGuide,
      });
      const out = await generateRemote(cfgD.provider, messages, { ...remoteApiOptions(db), json: true, maxTokens: 600, temperature: 0.3 });
      const parsed = parseDraftOutput(out.text, kind);
      payload = {
        kind, lang,
        text: restorePlaceholders(parsed.text, draftPlaceholderValues(ctx)),
        points: parsed.points,
      };
      model = out.model;
      confidence = 0.85;
      usageLog(db, caseId, model, Date.now() - started, true, null, 'draft');
    } catch (e) {
      logger.warn('aiService', `AI-04 遠端生成失敗 ${caseId}，回落規則範本：${e.message}`);
      usageLog(db, caseId, cfgD.provider, Date.now() - started, false, String(e.message).slice(0, 300), 'draft');
      const r = kind === 'summary'
        ? summarizeWithRules({ content, category: ctx.categoryCode, estateNameZh: ctx.estateNameZh, eventType: ctx.eventType, address, incidentDate: ctx.incidentDate })
        : replyDraftWithRules({ caseId, customerTitle: ctx.customerTitle, customerName: ctx.customerName, category: ctx.categoryCode, estateNameZh: ctx.estateNameZh, responseSlaDue: ctx.responseSlaDue, content, styleGuide: cfgD.styleGuide, lang });
      payload = { kind, lang, ...r, fallback: true };
      model = 'rules-fallback';
      confidence = 0.6;
    }
  } else {
    const r = kind === 'summary'
      ? summarizeWithRules({ content, category: ctx.categoryCode, estateNameZh: ctx.estateNameZh, eventType: ctx.eventType, address, incidentDate: ctx.incidentDate })
      : replyDraftWithRules({ caseId, customerTitle: ctx.customerTitle, customerName: ctx.customerName, category: ctx.categoryCode, estateNameZh: ctx.estateNameZh, responseSlaDue: ctx.responseSlaDue, content, styleGuide: cfgD.styleGuide, lang });
    payload = { kind, lang, ...r };
    usageLog(db, caseId, 'rules', 0, true, null, 'draft');
  }

  db.prepare(
    "UPDATE ai_suggestion SET status = 'shown', payload = ?, confidence = ?, model = ?, error = NULL WHERE suggestion_id = ?"
  ).run(JSON.stringify(payload), confidence, model, suggestionId);
  writeAudit(db, {
    userId: user ? user.userId : SYSTEM_USER_ID,
    username: user ? user.username : 'SYSTEM',
    action: 'AI_DRAFT_CREATED',
    targetType: 'CASE',
    targetId: caseId,
    detail: { caseId, suggestionId, kind, lang, model },
  });
  return { suggestionId, caseId, aiType: 'draft', status: 'shown', kind, lang, payload, model, confidence };
}

/** 採納草稿：人手編輯後存入 case_log（AI_DRAFT_USED）；不自動對外發送 */
function useDraft(db, caseId, suggestionId, user, { content } = {}) {
  const s = loadSuggestion(db, suggestionId);
  if (!s) throw new ApiError(ERR.VALIDATION, 'AI 建議不存在', 404);
  if (s.case_id !== caseId) throw new ApiError(ERR.VALIDATION, '建議不屬於此個案');
  if (s.ai_type !== 'draft') throw new ApiError(ERR.VALIDATION, '此建議不是草稿類型');
  const c = getCaseCore(db, caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const text = String(content == null ? '' : content).trim();
  if (!text) throw new ApiError(ERR.VALIDATION, '請提供回覆／摘要內容');
  if (text.length > 4000) throw new ApiError(ERR.VALIDATION, '內容長度不得超過 4000 字');
  const pl = s.payload ? JSON.parse(s.payload) : {};
  const kind = pl.kind === 'reply' ? 'reply' : 'summary';
  const actorId = user ? user.userId : SYSTEM_USER_ID;
  const kindZh = kind === 'reply' ? '回覆草稿' : '個案摘要';
  db.transaction(() => {
    db.prepare(
      'INSERT INTO case_log (case_id, log_type, log_content, old_status, new_status, action_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(caseId, 'NOTE', `【AI ${kindZh}】（經人手編輯後採用）\n${text}`, c.case_status, c.case_status, actorId);
    db.prepare(
      "UPDATE ai_suggestion SET status = 'accepted', decided_by = ?, decided_at = datetime('now'), decided_note = ? WHERE suggestion_id = ?"
    ).run(actorId, '已採納並存入個案紀錄', suggestionId);
    writeAudit(db, {
      userId: actorId,
      username: user ? user.username : 'SYSTEM',
      action: 'AI_DRAFT_USED',
      targetType: 'CASE',
      targetId: caseId,
      detail: { caseId, suggestionId, kind, length: text.length, model: s.model },
    });
  })();
  return { suggestionId, caseId, status: 'accepted', kind, kindZh, content: text };
}

/* ====================== AI-05 問卷開放意見分析（§4.5） ====================== */

function cfgFeedback(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.feedback.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
    lookbackDays: Number(getConfig(db, 'ai.feedback.lookback_days', 180)) || 180,
  };
}

function surveyForInsight(db, surveyId) {
  return db.prepare(
    `SELECT s.survey_id AS surveyId, s.case_id AS caseId, s.status, s.feedback, s.lang,
            s.submitted_at AS submittedAt, s.rating_overall AS overall, s.rating_response AS response,
            s.rating_attitude AS attitude, s.rating_resolution AS resolution,
            s.is_low_score AS isLowScore, c.estate_code AS estateCode, e.estate_name_zh AS estateNameZh
       FROM satisfaction_survey s
       JOIN \`case\` c ON c.case_id = s.case_id
       LEFT JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE s.survey_id = ?`
  ).get(surveyId);
}

/** 分析單份已提交問卷之開放文字（主題＋情緒＋一句摘要），寫入 ai_feedback_insight */
async function analyzeSurveyFeedback(db, surveyId, user) {
  const cfgF = cfgFeedback(db);
  if (!cfgF.enabled) {
    throw new ApiError(ERR.VALIDATION, 'AI-05 意見分析未啟用（請於系統參數開啟 AI 總開關與「AI-05 問卷意見分析」）');
  }
  const row = surveyForInsight(db, surveyId);
  if (!row) throw new ApiError(ERR.VALIDATION, '問卷不存在', 404);
  assertScope(user, row.estateCode);
  if (row.status !== 'SUBMITTED') throw new ApiError(ERR.STATE_TRANSITION, '問卷尚未提交，無需分析');
  const text = maskPii(String(row.feedback || '')).trim();
  if (!text) return null;

  const started = Date.now();
  let res;
  let model = 'rules';
  if (cfgF.provider === 'rules' || cfgF.provider === 'none') {
    res = analyzeFeedbackWithRules(text);
  } else {
    try {
      res = await analyzeFeedbackRemote(cfgF.provider, text, remoteApiOptions(db));
      model = res.model || cfgF.provider;
    } catch (e) {
      logger.warn('aiService', `AI-05 遠端分析失敗 survey=${surveyId}，回落規則：${e.message}`);
      usageLog(db, row.caseId, cfgF.provider, Date.now() - started, false, String(e.message).slice(0, 300), 'feedback');
      res = analyzeFeedbackWithRules(text);
      model = 'rules-fallback';
    }
  }
  usageLog(db, row.caseId, model, Date.now() - started, true, null, 'feedback');
  db.prepare(
    "INSERT OR REPLACE INTO ai_feedback_insight (survey_id, case_id, estate_code, topics, sentiment, summary, confidence, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
  ).run(surveyId, row.caseId, row.estateCode, JSON.stringify(res.topics), res.sentiment, res.summary || null, res.confidence != null ? res.confidence : null, model);
  return {
    surveyId, caseId: row.caseId, estateCode: row.estateCode, estateNameZh: row.estateNameZh,
    topics: res.topics, sentiment: res.sentiment, summary: res.summary,
    confidence: res.confidence, model,
    ratings: { overall: row.overall, response: row.response, attitude: row.attitude, resolution: row.resolution },
    isLowScore: !!row.isLowScore, submittedAt: row.submittedAt,
  };
}

/** 批次處理尚未分析之已提交問卷（排程／手動觸發；審計只記批次層面） */
async function processFeedbackQueue(db, { limit = 5 } = {}) {
  const cfgF = cfgFeedback(db);
  if (!cfgF.enabled) return { processed: 0 };
  const n = Math.max(1, Math.min(Number(limit) || 5, 50));
  const rows = db.prepare(
    `SELECT s.survey_id AS surveyId
       FROM satisfaction_survey s
      WHERE s.status = 'SUBMITTED' AND s.feedback IS NOT NULL AND TRIM(s.feedback) <> ''
        AND NOT EXISTS (SELECT 1 FROM ai_feedback_insight i WHERE i.survey_id = s.survey_id)
      ORDER BY s.submitted_at DESC LIMIT ?`
  ).all(n);
  let processed = 0;
  for (const r of rows) {
    try {
      const out = await analyzeSurveyFeedback(db, r.surveyId, null);
      if (out) processed += 1;
    } catch (e) {
      logger.warn('aiService', `AI-05 分析失敗 survey=${r.surveyId}: ${e.message}`);
    }
  }
  if (processed > 0) {
    writeAudit(db, {
      userId: SYSTEM_USER_ID,
      username: 'SYSTEM',
      action: 'AI_FEEDBACK_ANALYZE',
      targetType: 'SURVEY',
      targetId: `batch:${processed}`,
      detail: { processed, provider: cfgF.provider },
    });
  }
  return { processed };
}

/** 彙總意見分析結果（管理層／屋苑主管：主題分佈、情緒、逐份明細） */
function listFeedbackInsights(db, { from, to, estate } = {}, user) {
  const where = [];
  const args = [];
  if (from) { where.push('s.submitted_at >= ?'); args.push(String(from)); }
  if (to) { where.push('s.submitted_at <= ?'); args.push(String(to)); }
  const sc = estateInClause('i.estate_code', user && user.estateCode);
  if (sc.clause) {
    where.push(sc.clause);
    args.push(...sc.params);
  } else if (estate) {
    where.push('i.estate_code = ?');
    args.push(estate);
  }
  const sql = `SELECT i.survey_id AS surveyId, i.case_id AS caseId, i.estate_code AS estateCode,
      e.estate_name_zh AS estateNameZh, i.topics, i.sentiment, i.summary, i.confidence, i.model,
      i.created_at AS createdAt, s.submitted_at AS submittedAt, s.rating_overall AS overall,
      s.rating_response AS response, s.rating_attitude AS attitude, s.rating_resolution AS resolution,
      s.is_low_score AS isLowScore, s.lang
   FROM ai_feedback_insight i
   JOIN satisfaction_survey s ON s.survey_id = i.survey_id
   LEFT JOIN sys_estate e ON e.estate_code = i.estate_code
   ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
   ORDER BY s.submitted_at DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...args);
  const items = rows.map((r) => ({ ...r, topics: r.topics ? JSON.parse(r.topics) : [] }));

  const map = new Map();
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const it of items) {
    if (sentiment[it.sentiment] != null) sentiment[it.sentiment] += 1;
    for (const t of it.topics) {
      const cur = map.get(t) || { topic: t, count: 0, sumOverall: 0, nOverall: 0, negative: 0 };
      cur.count += 1;
      if (it.overall != null) { cur.sumOverall += it.overall; cur.nOverall += 1; }
      if (it.sentiment === 'negative') cur.negative += 1;
      map.set(t, cur);
    }
  }
  const topics = [...map.values()]
    .map((t) => ({
      topic: t.topic,
      count: t.count,
      avgOverall: t.nOverall ? Number((t.sumOverall / t.nOverall).toFixed(2)) : null,
      negativeRate: t.count ? Number((t.negative / t.count).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  return { total: items.length, topics, sentiment, items, topicLabels: Object.keys(TOPIC_KEYWORDS) };
}

/** 單一個案之問卷意見分析（低分個案「可能成因摘要」） */
function caseFeedbackInsight(db, caseId, user) {
  const c = getCaseCore(db, caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const row = db.prepare(
    `SELECT i.survey_id AS surveyId, i.topics, i.sentiment, i.summary, i.model, i.confidence, i.created_at AS createdAt,
            s.rating_overall AS overall, s.is_low_score AS isLowScore, s.submitted_at AS submittedAt
       FROM ai_feedback_insight i JOIN satisfaction_survey s ON s.survey_id = i.survey_id
      WHERE i.case_id = ? ORDER BY i.created_at DESC LIMIT 1`
  ).get(caseId);
  if (!row) return null;
  return { ...row, topics: row.topics ? JSON.parse(row.topics) : [] };
}

/* ====================== AI-06 週報 AI 摘要（§4.6） ====================== */

function cfgWeekly(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.weekly_summary.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
    style: String(getConfig(db, 'ai.weekly_summary.style', '') || '').trim(),
  };
}

/**
 * 由週報彙總數字生成敘事摘要（「本週重點／值得關注／建議行動」三節）。
 * - 輸入為 analyticsService.summary + anomalies（已彙總，唔含個案原文／PII），故唔需 de-PII；
 * - rules provider：零依賴範本；遠端失敗自動回落範本（fallback）；
 * - model 回傳供 audit（週報列本身記錄 ai_summary_model，毋須逐句 audit）。
 * @returns {{ text:string, model:string, fallback?:boolean }}
 */
async function generateWeeklySummary(db, { summary, anomalies, topItems = [] }) {
  const cfgW = cfgWeekly(db);
  if (!cfgW.enabled) {
    throw new ApiError(ERR.VALIDATION, 'AI-06 週報摘要未啟用（請於系統參數開啟 AI 總開關與「AI-06 週報 AI 摘要」）');
  }
  const useRemote = cfgW.provider !== 'rules' && cfgW.provider !== 'none';
  const started = Date.now();
  if (useRemote) {
    try {
      const messages = buildWeeklySummaryMessages({ summary, anomalies, topItems, style: cfgW.style });
      const out = await generateRemote(cfgW.provider, messages, { ...remoteApiOptions(db), maxTokens: 700, temperature: 0.3 });
      const text = parseWeeklyOutput(out.text);
      if (!text) throw new Error('模型未回傳摘要內容');
      usageLog(db, null, out.model, Date.now() - started, true, null, 'weekly_summary');
      return { text, model: out.model };
    } catch (e) {
      logger.warn('aiService', `AI-06 遠端摘要失敗，回落規則範本：${e.message}`);
      usageLog(db, null, cfgW.provider, Date.now() - started, false, String(e.message).slice(0, 300), 'weekly_summary');
      const text = weeklySummaryWithRules({ summary, anomalies, topItems });
      return { text, model: 'rules-fallback', fallback: true };
    }
  }
  const text = weeklySummaryWithRules({ summary, anomalies, topItems });
  usageLog(db, null, 'rules', 0, true, null, 'weekly_summary');
  return { text, model: 'rules' };
}

/* ====================== AI-07 附件影像理解（§4.7） ====================== */

function cfgAttachment(db) {
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.attachment.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
    localOnly: !!getConfig(db, 'ai.vision.local_only', true),
  };
}

const VISION_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

/**
 * 分析個案附件（jpg/jpeg/png/pdf）：輸出影像類別＋OCR 文字＋一句描述。
 * - 結果寫入 ai_suggestion（ai_type='attachment_insight'；由既有 GET /cases/:id/ai-suggestions 讀取）
 *   ，OCR 文字另存 case_log_attachment.ocr_text；
 * - 權限沿用個案之屋苑 data_scope（與附件本身相同，case:view）；
 * - 私隱：ai.vision.local_only 預設 true，拒絕把影像外送雲端供應商。
 * @returns {Promise<object>} { suggestionId, attachmentId, category, categoryZh, ocrText, description, confidence, model, visionUsed }
 */
async function analyzeAttachment(db, caseId, attachmentId, user) {
  const c = getCaseCore(db, caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const cfgA = cfgAttachment(db);
  if (!cfgA.enabled) {
    throw new ApiError(ERR.VALIDATION, 'AI-07 附件影像理解未啟用（請於系統參數開啟 AI 總開關與「AI-07 附件影像理解」）');
  }

  const att = db.prepare(
    'SELECT attachment_id AS attachmentId, file_name AS fileName, file_type AS fileType, file_size AS fileSize, storage_key AS storageKey FROM case_log_attachment WHERE attachment_id = ? AND case_id = ?'
  ).get(Number(attachmentId), caseId);
  if (!att) throw new ApiError(ERR.CASE_NOT_FOUND, '附件不存在', 404);

  const useRemote = cfgA.provider !== 'rules' && cfgA.provider !== 'none';
  if (useRemote && cfgA.localOnly && cfgA.provider !== 'ollama') {
    throw new ApiError(ERR.VALIDATION, 'ai.vision.local_only=true：影像不可外送雲端，請改用本地模型（ollama）');
  }

  const started = Date.now();
  let result;
  if (useRemote) {
    try {
      const buf = fs.readFileSync(path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'), caseId, att.storageKey));
      result = await analyzeAttachmentRemote(cfgA.provider, {
        imageB64: buf.toString('base64'),
        mimeType: VISION_MIME[String(att.fileType || '').toLowerCase()] || 'image/jpeg',
      }, { ...remoteApiOptions(db), maxTokens: 400, temperature: 0.2 });
    } catch (e) {
      logger.warn('aiService', `AI-07 遠端影像分析失敗，回落規則結果：${e.message}`);
      usageLog(db, caseId, cfgA.provider, Date.now() - started, false, String(e.message).slice(0, 300), 'attachment_analyze');
      result = analyzeAttachmentWithRules({ fileName: att.fileName, fileType: att.fileType });
    }
  } else {
    result = analyzeAttachmentWithRules({ fileName: att.fileName, fileType: att.fileType });
  }

  db.prepare('UPDATE case_log_attachment SET ocr_text = ? WHERE attachment_id = ?')
    .run(String(result.ocrText || ''), att.attachmentId);

  const payload = {
    attachmentId: att.attachmentId,
    fileName: att.fileName,
    fileType: att.fileType,
    category: result.category,
    categoryZh: result.categoryZh,
    ocrText: result.ocrText,
    description: result.description,
    confidence: result.confidence,
    visionUsed: !!result.visionUsed,
  };
  const info = db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status, payload, confidence, model, created_by) VALUES (?, 'attachment_insight', 'shown', ?, ?, ?, ?)"
  ).run(caseId, JSON.stringify(payload), result.confidence, result.model, (user && user.userId) || SYSTEM_USER_ID);
  usageLog(db, caseId, result.model, Date.now() - started, true, null, 'attachment_analyze');

  writeAudit(db, {
    userId: (user && user.userId) || SYSTEM_USER_ID,
    username: (user && user.username) || 'SYSTEM',
    action: 'AI_ATTACHMENT_ANALYZE',
    targetType: 'CASE',
    targetId: caseId,
    // 只記 storage_key 供追溯，唔複製檔案內容（§4.7 私隱要求）
    detail: { attachmentId: att.attachmentId, storageKey: att.storageKey, model: result.model, visionUsed: !!result.visionUsed, category: result.category },
  });

  return { suggestionId: Number(info.lastInsertRowid), ...payload, model: result.model };
}

/* ====================== AI-08 逾期風險預警（§4.8） ====================== */

const HOUR = 60 * 60 * 1000;
const OPEN_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'REOPENED'];
const RISK_NOTIFY_DEFAULT = ['ESTATE_SUPERVISOR', 'CC_SUPERVISOR'];

function cfgRisk(db) {
  const roles = String(getConfig(db, 'ai.risk.notify_roles', RISK_NOTIFY_DEFAULT.join(',')) || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return {
    enabled: !!getConfig(db, 'ai.enabled', false) && !!getConfig(db, 'ai.risk.enabled', false),
    provider: getConfig(db, 'ai.provider', 'rules'),
    lookbackDays: Number(getConfig(db, 'ai.risk.lookback_days', 90)) || 90,
    notifyRoles: roles.length ? roles : RISK_NOTIFY_DEFAULT,
  };
}

/** 近 lookbackDays 日、同屋苑＋同類別之歷史處理時長分佈（首次回應 P75／結案 P75） */
function riskBaseline(db, estateCode, categoryCode, lookbackDays, nowMs) {
  const rows = db.prepare(
    `SELECT created_at AS createdAt, first_response_at AS firstResponseAt, closed_at AS closedAt
       FROM \`case\`
      WHERE estate_code = ? AND category_code = ?
        AND created_at >= ? AND created_at <= ?
        AND (first_response_at IS NOT NULL OR closed_at IS NOT NULL)
      ORDER BY created_at DESC LIMIT 500`
  ).all(estateCode, categoryCode, toDb(new Date(nowMs - lookbackDays * 24 * HOUR)), toDb(new Date(nowMs)));
  const resp = [];
  const clos = [];
  for (const r of rows) {
    const c = parseDb(r.createdAt);
    if (!c) continue;
    const f = r.firstResponseAt ? parseDb(r.firstResponseAt) : null;
    const k = r.closedAt ? parseDb(r.closedAt) : null;
    if (f && f.getTime() >= c.getTime()) resp.push(f.getTime() - c.getTime());
    if (k && k.getTime() >= c.getTime()) clos.push(k.getTime() - c.getTime());
  }
  const p75 = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1)];
  };
  return { responseP75: p75(resp), closureP75: p75(clos), sampleSize: rows.length };
}

/** 風險分＝歷史所需時間 ÷ 剩餘時間（0~1；已逾期直接 1） */
function riskScoreOf(requiredMs, remainingMs, overdue) {
  if (overdue) return 1;
  if (!requiredMs || requiredMs <= 0) return 0;
  return Math.min(1, Math.max(0, requiredMs / Math.max(remainingMs, 1)));
}

function riskLevelOf(score, overdue) {
  if (overdue || score >= 0.85) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  return 'LOW';
}

/**
 * 逾期風險掃描（級一純統計；高風險再走級二 LLM 產生一句理由＋建議動作）。
 * - UPSERT ai_case_risk（每案一列，保留 acknowledged 狀態）；
 * - 僅「新升為 HIGH」通知，避免重複轟炸（沿用 SLA 催辦收件角色）；
 * - 審計：每筆新預警寫 audit_log（AI_RISK_ALERT）。
 * @returns {Promise<{scanned:number, high:number, medium:number, low:number, notified:number, skipped?:boolean, reason?:string}>}
 */
async function scanCaseRisk(db, { nowMs = Date.now() } = {}) {
  const cfgR = cfgRisk(db);
  if (!cfgR.enabled) return { scanned: 0, high: 0, medium: 0, low: 0, notified: 0, skipped: true, reason: 'disabled' };
  const rows = db.prepare(
    `SELECT c.case_id AS caseId, c.estate_code AS estateCode, c.category_code AS categoryCode,
            c.event_type AS eventType, c.created_at AS createdAt, c.case_status AS status,
            c.first_response_at AS firstResponseAt, c.response_sla_due AS responseDue,
            c.closure_sla_due AS closureDue, e.estate_name_zh AS estateNameZh
       FROM \`case\` c JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE c.case_status IN (${OPEN_STATUSES.map(() => '?').join(',')})
        AND c.closed_at IS NULL
      ORDER BY c.created_at ASC`
  ).all(...OPEN_STATUSES);

  const summary = { scanned: rows.length, high: 0, medium: 0, low: 0, notified: 0 };
  const baseCache = new Map();
  const useRemote = cfgR.provider !== 'rules' && cfgR.provider !== 'none';

  for (const row of rows) {
    const createdMs = (parseDb(row.createdAt) || new Date(nowMs)).getTime();
    // 未首次回應 → 看首次回應期限；已回應 → 看關閉期限
    const phase = row.firstResponseAt ? 'CLOSURE' : 'RESPONSE';
    const dueRaw = phase === 'RESPONSE' ? row.responseDue : row.closureDue;
    if (!dueRaw) continue;
    const dueMs = (parseDb(dueRaw) || new Date(nowMs)).getTime();
    const remainingMs = dueMs - nowMs;
    const overdue = remainingMs <= 0;

    const key = `${row.estateCode}|${row.categoryCode}`;
    if (!baseCache.has(key)) baseCache.set(key, riskBaseline(db, row.estateCode, row.categoryCode, cfgR.lookbackDays, nowMs));
    const base = baseCache.get(key);
    // 無歷史樣本時，退化为「假設需要 75% 可用期限」嘅保守代理值
    const requiredMs = (phase === 'RESPONSE' ? base.responseP75 : base.closureP75)
      || (dueMs - createdMs) * 0.75;

    const score = riskScoreOf(requiredMs, remainingMs, overdue);
    const level = riskLevelOf(score, overdue);
    summary[level.toLowerCase()] += 1;

    const factHrs = (ms) => Math.max(0, Math.round(ms / HOUR));
    const facts = {
      category: row.categoryCode || '—',
      eventType: row.eventType || 'N/A',
      ageHours: factHrs(nowMs - createdMs),
      remainingHours: overdue ? 0 : factHrs(remainingMs),
      baselineHours: factHrs(requiredMs),
      riskLevel: level,
      alreadyOverdue: overdue,
    };

    let model = 'rules';
    let reason;
    let action;
    if (useRemote && level === 'HIGH') {
      try {
        const messages = buildRiskReasonMessages(facts);
        const out = await generateRemote(cfgR.provider, messages, { ...remoteApiOptions(db), json: true, maxTokens: 300, temperature: 0.2 });
        const p = parseJsonFence(out.text);
        if (!p || typeof p.reason !== 'string' || typeof p.suggested_action !== 'string') throw new Error('輸出格式不符');
        reason = String(p.reason).slice(0, 200);
        action = String(p.suggested_action).slice(0, 200);
        model = out.model;
      } catch (e) {
        logger.warn('aiService', `AI-08 級二理由生成失敗，回落規則語句：${e.message}`);
        const fb = riskReasonWithRules(facts);
        reason = fb.reason;
        action = fb.suggested_action;
        model = 'rules-fallback';
      }
    } else {
      const fb = riskReasonWithRules(facts);
      reason = fb.reason;
      action = fb.suggested_action;
    }

    const prev = db.prepare('SELECT risk_id, risk_level AS riskLevel FROM ai_case_risk WHERE case_id = ?').get(row.caseId);
    db.prepare(
      `INSERT INTO ai_case_risk (case_id, estate_code, risk_level, risk_score, reason, suggested_action, model, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id) DO UPDATE SET
         risk_level = excluded.risk_level, risk_score = excluded.risk_score,
         reason = excluded.reason, suggested_action = excluded.suggested_action,
         model = excluded.model, computed_at = excluded.computed_at`
    ).run(row.caseId, row.estateCode, level, score, reason, action, model, toDb(new Date(nowMs)));

    // 只响「新升為 HIGH」嗰陣通知，避免同 SLA 催辦重複轟炸
    if (level === 'HIGH' && (!prev || prev.riskLevel !== 'HIGH')) {
      const seen = new Set();
      for (const role of cfgR.notifyRoles) {
        const users = role === 'ESTATE_SUPERVISOR'
          ? usersByRole(db, role, row.estateCode)
          : usersByRole(db, role);
        for (const u of users) {
          if (seen.has(u.userId)) continue;
          seen.add(u.userId);
          notifyUser(db, {
            userId: u.userId,
            notifType: 'SYSTEM',
            title: `個案 ${row.caseId} 有逾期風險`,
            body: `${row.estateNameZh}｜${reason} 建議：${action}`,
            refType: 'CASE',
            refId: row.caseId,
            email: false,
          });
        }
      }
      summary.notified += 1;
      writeAudit(db, {
        userId: SYSTEM_USER_ID, username: 'SYSTEM', action: 'AI_RISK_ALERT',
        targetType: 'CASE', targetId: row.caseId,
        detail: { caseId: row.caseId, estateCode: row.estateCode, riskLevel: level, riskScore: Number(score.toFixed(3)), model },
      });
    }
  }

  usageLog(db, null, useRemote ? cfgR.provider : 'rules', 0, true, null, 'risk_scan');
  logger.info('aiService', `AI_RISK_SCAN scanned=${summary.scanned} high=${summary.high} medium=${summary.medium} low=${summary.low} notified=${summary.notified}`);
  return summary;
}

/** Dashboard「風險個案」清單（dashboard:view；沿用屋苑 data_scope 過濾） */
function listCaseRisks(db, user, { limit = 20, level } = {}) {
  const params = [];
  const where = [];
  if (level) { where.push('r.risk_level = ?'); params.push(String(level).toUpperCase()); }
  {
    const sc = estateInClause('r.estate_code', user && user.estateCode);
    if (sc.clause) { where.push(sc.clause); params.push(...sc.params); }
  }
  const rows = db.prepare(
    `SELECT r.case_id AS caseId, r.estate_code AS estateCode, r.risk_level AS riskLevel, r.risk_score AS riskScore,
            r.reason, r.suggested_action AS suggestedAction, r.model,
            r.computed_at AS computedAt, r.notified_at AS notifiedAt,
            r.acknowledged_by AS acknowledgedBy, r.acknowledged_at AS acknowledgedAt,
            u.full_name AS acknowledgedByName,
            c.case_status AS caseStatus, c.category_code AS categoryCode,
            c.event_type AS eventType, c.created_at AS createdAt,
            c.first_response_at AS firstResponseAt,
            c.response_sla_due AS responseDue, c.closure_sla_due AS closureDue,
            e.estate_name_zh AS estateNameZh
       FROM ai_case_risk r
       JOIN \`case\` c ON c.case_id = r.case_id
       JOIN sys_estate e ON e.estate_code = r.estate_code
       LEFT JOIN sys_user u ON u.user_id = r.acknowledged_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE r.risk_level WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, r.risk_score DESC
      LIMIT ?`
  ).all(...params, Math.min(Math.max(limit, 1), 100));
  const nowMs = Date.now();
  return rows.map((r) => {
    const dueRaw = r.firstResponseAt ? r.closureDue : r.responseDue;
    const remainingMs = dueRaw ? (parseDb(dueRaw) || new Date()).getTime() - nowMs : null;
    return {
      caseId: r.caseId,
      estateCode: r.estateCode,
      estateNameZh: r.estateNameZh,
      riskLevel: r.riskLevel,
      riskScore: Number(Number(r.riskScore).toFixed(3)),
      reason: r.reason,
      suggestedAction: r.suggestedAction,
      model: r.model,
      computedAt: dbToIso8(r.computedAt),
      notifiedAt: r.notifiedAt ? dbToIso8(r.notifiedAt) : null,
      acknowledgedAt: r.acknowledgedAt ? dbToIso8(r.acknowledgedAt) : null,
      acknowledgedByName: r.acknowledgedByName || null,
      caseStatus: r.caseStatus,
      categoryCode: r.categoryCode,
      eventType: r.eventType,
      dueAt: dueRaw ? dbToIso8(dueRaw) : null,
      remainingHours: remainingMs == null ? null : Math.round(remainingMs / HOUR),
      overdue: remainingMs != null && remainingMs <= 0,
    };
  });
}

/** 主管確認風險預警（case:update／主管操作；寫 audit AI_RISK_ACK） */
function ackCaseRisk(db, caseId, user) {
  const c = db.prepare('SELECT case_id AS caseId, estate_code AS estateCode FROM `case` WHERE case_id = ?').get(caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estateCode);
  const row = db.prepare('SELECT risk_level AS riskLevel FROM ai_case_risk WHERE case_id = ?').get(caseId);
  if (!row) throw new ApiError(ERR.VALIDATION, '該個案暫無風險預警記錄', 404);
  const atDb = toDb(new Date());
  db.prepare('UPDATE ai_case_risk SET acknowledged_by = ?, acknowledged_at = ? WHERE case_id = ?')
    .run((user && user.userId) || SYSTEM_USER_ID, atDb, caseId);
  writeAudit(db, {
    userId: (user && user.userId) || SYSTEM_USER_ID,
    username: (user && user.username) || 'SYSTEM',
    action: 'AI_RISK_ACK',
    targetType: 'CASE',
    targetId: caseId,
    detail: { caseId, riskLevel: row.riskLevel },
  });
  return { caseId, riskLevel: row.riskLevel, acknowledgedAt: dbToIso8(atDb) };
}

/** 該個案各附件最新之 AI-07 分析結果（供附件清單顯示；沿用 GET /cases/:id/ai-suggestions 之資料來源） */
function attachmentInsights(db, caseId, user) {
  const c = db.prepare('SELECT estate_code FROM `case` WHERE case_id = ?').get(caseId);
  if (!c) throw new ApiError(ERR.CASE_NOT_FOUND, null, 404);
  assertScope(user, c.estate_code);
  const rows = db.prepare(
    "SELECT suggestion_id AS suggestionId, payload, confidence, model, created_at AS createdAt FROM ai_suggestion WHERE case_id = ? AND ai_type = 'attachment_insight' ORDER BY suggestion_id DESC LIMIT 50"
  ).all(caseId);
  const latest = new Map();
  for (const r of rows) {
    let p = null;
    try { p = r.payload ? JSON.parse(r.payload) : null; } catch { p = null; }
    if (!p || !p.attachmentId) continue;
    if (latest.has(p.attachmentId)) continue; // 已由新至舊，第一筆即最新
    latest.set(p.attachmentId, { ...p, suggestionId: r.suggestionId, confidence: r.confidence, model: r.model, createdAt: dbToIso8(r.createdAt) });
  }
  return [...latest.values()];
}
module.exports = {
  enqueueClassify,
  enqueueSimilar,
  createDraft,
  useDraft,
  analyzeSurveyFeedback,
  processFeedbackQueue,
  listFeedbackInsights,
  caseFeedbackInsight,
  generateWeeklySummary,
  analyzeAttachment,
  attachmentInsights,
  scanCaseRisk,
  listCaseRisks,
  ackCaseRisk,
  scanAiFeedback: processFeedbackQueue,
  processClassifyQueue,
  listAiSuggestions,
  decideAiSuggestion,
  linkSimilarCase,
  findSimilarCases,
  suggestAssignee,
  aiStatus,
  testAiConnection,
  saveAiApiKey,
  reanalyzeCase,
  scanAiQueue: processClassifyQueue,
  maskSecret,
  remoteApiOptions,
  AI_PROVIDERS,
};
