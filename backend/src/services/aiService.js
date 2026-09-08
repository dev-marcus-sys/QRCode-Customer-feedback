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
const { dbToIso8, toIso8 } = require('../utils/time');
const { writeAudit } = require('../utils/audit');
const { computeDueDates } = require('./sla');
const { classifyRemote, classifyWithRules, eventTypeOfSuggestion, maskPii, EVENT_ORDER } = require('./aiProvider');
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

function getCaseCore(db, caseId) {
  return db.prepare(
    'SELECT case_id, estate_code, category_code, event_type, intent_type, is_second_complaint, case_status, comment_content AS content FROM `case` WHERE case_id = ?'
  ).get(caseId);
}

function loadSuggestion(db, suggestionId) {
  return db.prepare('SELECT * FROM ai_suggestion WHERE suggestion_id = ?').get(suggestionId);
}

function assertScope(user, estateCode) {
  if (user && user.estateCode && user.estateCode !== 'ALL' && estateCode !== user.estateCode) {
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

/** 排程掃描：處理未分類建議（開關已關 → 標 skipped；rules 即時；遠端 await） */
async function processClassifyQueue(db, { limit = 5 } = {}) {
  const { enabled, provider } = cfg(db);
  const n = Math.max(1, Math.min(Number(limit) || 5, 50));
  const pending = db.prepare(
    "SELECT suggestion_id, case_id, ai_type FROM ai_suggestion WHERE ai_type = 'classify' AND status = 'pending' ORDER BY created_at, suggestion_id LIMIT ?"
  ).all(n);
  let processed = 0;
  for (const s of pending) {
    if (!enabled || provider === 'none') {
      db.prepare("UPDATE ai_suggestion SET status = 'skipped', error = 'disabled' WHERE suggestion_id = ?").run(s.suggestion_id);
    } else if (provider === 'rules') {
      applyClassify(db, s.suggestion_id);
    } else {
      await applyRemote(db, s.suggestion_id);
    }
    processed += 1;
  }
  return { processed };
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

module.exports = {
  enqueueClassify,
  processClassifyQueue,
  listAiSuggestions,
  decideAiSuggestion,
  aiStatus,
  testAiConnection,
  saveAiApiKey,
  reanalyzeCase,
  scanAiQueue: processClassifyQueue,
  maskSecret,
  remoteApiOptions,
  AI_PROVIDERS,
};
