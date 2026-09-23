'use strict';
process.env.DB_PATH = ':memory:';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase } = require('../src/db/connection');
const { createCaseFromFeedback } = require('../src/services/caseService');
const aiService = require('../src/services/aiService');
const weekly = require('../src/services/weeklyReportService');
const { maskPii, classifyWithRules } = require('../src/services/aiProvider');
const configService = require('../src/services/configService');
const { getConfig } = require('../src/db/configStore');
const { ApiError } = require('../src/middlewares/error');
const { ERR } = require('../src/config/constants');

const db = initDatabase();
const rules = getConfig(db, 'sla.rules', {});
const mapping = getConfig(db, 'category.event_mapping', {});

function setAi(key, value) {
  db.prepare('UPDATE sys_config SET config_value = ? WHERE config_key = ?').run(JSON.stringify(value), key);
}

function submitCase(content, { category = ['OTHER'], estate = 'CHNG', email } = {}) {
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = createCaseFromFeedback(db, {
    estate,
    title: '先生',
    name: '測試員',
    email: email || `ai_${uniq}@example.com`,
    phone: '',
    incidentDate: '2026-09-03',
    incidentTime: '10:00',
    categories: category,
    content,
    surveyConsent: true,
  });
  assert.equal(res.isDuplicate, false);
  return res.caseId;
}

function latestSuggestion(caseId) {
  return db.prepare(
    'SELECT * FROM ai_suggestion WHERE case_id = ? ORDER BY suggestion_id DESC LIMIT 1'
  ).get(caseId);
}

function userOf(estateCode = 'ALL') {
  return { userId: 2, username: 'tester', fullName: '測試員', estateCode };
}

/** 隔離：清掉個案相關表（FK 開啟，須先清子表），令 AI-02/03 測試唔受前序測試殘留個案影響 */
function clearCases() {
  db.prepare('UPDATE `case` SET original_case_id = NULL').run();
  db.prepare('DELETE FROM case_log_attachment').run();
  db.prepare('DELETE FROM ai_feedback_insight').run();
  db.prepare('DELETE FROM satisfaction_survey').run();
  db.prepare('DELETE FROM email_outbox').run();
  db.prepare('DELETE FROM ai_embedding').run();
  db.prepare('DELETE FROM ai_usage_log').run();
  db.prepare('DELETE FROM ai_suggestion').run();
  db.prepare('DELETE FROM case_log').run();
  db.prepare('DELETE FROM `case`').run();
}

/** 插入屋苑（避免 FK 報錯；AI-02/03 測試隔離用） */
function seedEstate(code) {
  db.prepare("INSERT OR IGNORE INTO sys_estate (estate_code, estate_name_zh, estate_name_en, company_code, is_active) VALUES (?, ?, ?, 'SIM', 1)").run(code, code, code);
}

/** 於指定屋苑插入一名用戶並授予角色（AI-03 測試隔離用，避免受 CHNG 既有用戶影響） */
function seedEstateUser(userId, username, fullName, email, estate, roleCode) {
  seedEstate(estate);
  db.prepare(
    'INSERT OR IGNORE INTO sys_user (user_id, username, full_name, email, estate_code, is_active, failed_attempts, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, datetime(\'now\'))'
  ).run(userId, username, fullName, email, estate);
  const role = db.prepare('SELECT role_id FROM sys_role WHERE role_code = ?').get(roleCode);
  if (role) db.prepare('INSERT OR IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)').run(userId, role.role_id);
  return userId;
}

const CONTENT_LEAK = '廁所天花爆喉漏水，好危險，請盡快維修。';

// AI-01/02/03 共用同一 db 與 sys_config，node:test 預設並發執行會令 config 互相競爭；
// 故包入單一 concurrency:1 describe（含上方 AI-01 頂層測試），確保全部串列執行、設定互不干擾。
describe('AI 全部（串行）', { concurrency: 1 }, () => {
test('maskPii 遮罩電郵／香港電話；分類規則偵測維修+緊急', () => {
  const masked = maskPii('聯絡 a@b.com，電話 91234567。');
  assert.ok(!masked.includes('a@b.com'));
  assert.ok(!masked.includes('91234567'));
  assert.ok(masked.includes('[EMAIL]'));
  assert.ok(masked.includes('[PHONE]'));

  const r = classifyWithRules(
    { content: CONTENT_LEAK, category: 'OTHER', isSecondComplaint: 0 },
    rules,
    mapping
  );
  assert.equal(r.category, 'MAINTENANCE');
  assert.equal(r.eventType, 'URGENT');
  assert.equal(r.urgency, 'URGENT');
  assert.equal(r.changed, true);
  assert.equal(r.model, 'rules');
});

test('AI 群組配置入目錄：boolean/enum 可編輯並帶 options；驗證擋無效值', () => {
  const admin = userOf('ALL');
  const list = configService.listConfigs(db);
  const aiGroup = list.groups.find((g) => g.key === 'AI');
  assert.ok(aiGroup, '目錄應含 AI 群組');
  const enabled = aiGroup.items.find((i) => i.key === 'ai.enabled');
  const provider = aiGroup.items.find((i) => i.key === 'ai.provider');
  assert.equal(enabled.editable, true);
  assert.equal(enabled.type, 'boolean');
  assert.equal(provider.editable, true);
  assert.equal(provider.type, 'enum');
  assert.deepEqual(provider.options, ['none', 'rules', 'openai', 'ollama']);

  assert.throws(() => configService.updateConfig(db, 'ai.enabled', 'yes', admin), (e) => e.code === ERR.VALIDATION);
  assert.throws(() => configService.updateConfig(db, 'ai.provider', 'gemini', admin), (e) => e.code === ERR.VALIDATION);
  assert.throws(() => configService.updateConfig(db, 'ai.enabled', 1, admin), (e) => e.code === ERR.VALIDATION);
});

test('預設 ai.enabled=false → 建案不產生 AI 建議', () => {
  setAi('ai.enabled', false);
  const caseId = submitCase(CONTENT_LEAK);
  const row = latestSuggestion(caseId);
  assert.equal(row, undefined);
});

test('開啟 AI-01 影子模式 → 建案即分類；有差異顯示建議但不改個案', () => {
  setAi('ai.enabled', true);
  setAi('ai.provider', 'rules');
  const caseId = submitCase(CONTENT_LEAK);
  const row = latestSuggestion(caseId);
  assert.ok(row, '應產生分類建議');
  assert.equal(row.status, 'shown');
  assert.equal(row.model, 'rules');
  const payload = JSON.parse(row.payload);
  assert.equal(payload.category, 'MAINTENANCE');
  assert.equal(payload.eventType, 'URGENT');
  assert.equal(payload.withDiff, true);
  assert.equal(payload.baseline.category, 'OTHER');

  // 影子模式：建議唔會自動套用
  const c = db.prepare('SELECT category_code, event_type FROM `case` WHERE case_id = ?').get(caseId);
  assert.equal(c.category_code, 'OTHER');
  assert.equal(c.event_type, 'NORMAL');

  // 同規則一致之個案 → skipped，避免噪音
  const okCase = submitCase('純粹測試意見，冇特別內容。', { category: ['OTHER'] });
  assert.equal(latestSuggestion(okCase).status, 'skipped');
});

test('採納建議 → 套用類別/事件並重算 SLA，寫時間軸與審計', () => {
  setAi('ai.enabled', true);
  setAi('ai.provider', 'rules');
  const caseId = submitCase(CONTENT_LEAK);
  const s = latestSuggestion(caseId);
  assert.equal(s.status, 'shown');
  const before = db.prepare('SELECT category_code, event_type, response_sla_due FROM `case` WHERE case_id = ?').get(caseId);
  assert.equal(before.category_code, 'OTHER');
  assert.equal(before.event_type, 'NORMAL');
  assert.ok(before.response_sla_due, 'NORMAL 已有首次回應 SLA 到期');

  const out = aiService.decideAiSuggestion(db, s.suggestion_id, userOf('ALL'), { accept: true });
  assert.equal(out.status, 'accepted');
  assert.ok(out.changes.length >= 2, `應含類別與事件變更：${out.changes.join('|')}`);

  const after = db.prepare('SELECT category_code, event_type, intent_type, response_sla_due FROM `case` WHERE case_id = ?').get(caseId);
  assert.equal(after.category_code, 'MAINTENANCE');
  assert.equal(after.event_type, 'URGENT');
  assert.ok(after.response_sla_due !== before.response_sla_due, '事件類型有變應按新事件重算首次回應 SLA');

  const updated = latestSuggestion(caseId);
  assert.equal(updated.status, 'accepted');
  assert.equal(updated.decided_by, 2);

  const log = db.prepare("SELECT log_content FROM case_log WHERE case_id = ? AND log_type = 'UPDATE' ORDER BY log_id DESC LIMIT 1").get(caseId);
  assert.ok(log.log_content.includes('採納 AI 分類建議'));
  const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target_id = ? AND action = 'AI_SUGGEST_ACCEPT'").get(caseId);
  assert.equal(audit.n, 1);
});

test('忽略建議 → 標 rejected，個案欄位不變；重複操作拒絕', () => {
  setAi('ai.enabled', true);
  setAi('ai.provider', 'rules');
  const caseId = submitCase(CONTENT_LEAK);
  const s = latestSuggestion(caseId);
  const out = aiService.decideAiSuggestion(db, s.suggestion_id, userOf('ALL'), { accept: false, note: '人工覆核後判斷不需要' });
  assert.equal(out.status, 'rejected');
  const c = db.prepare('SELECT category_code, event_type FROM `case` WHERE case_id = ?').get(caseId);
  assert.equal(c.category_code, 'OTHER');
  assert.throws(() => aiService.decideAiSuggestion(db, s.suggestion_id, userOf('ALL'), { accept: true }),
    (e) => e.code === ERR.STATE_TRANSITION);
  const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target_id = ? AND action = 'AI_SUGGEST_REJECT'").get(caseId);
  assert.equal(audit.n, 1);
});

test('屋苑範圍：非 ALL 用戶不可操作他屬建議', () => {
  setAi('ai.enabled', true);
  setAi('ai.provider', 'rules');
  const caseId = submitCase(CONTENT_LEAK, { estate: 'CHNG' });
  const s = latestSuggestion(caseId);
  assert.throws(() => aiService.decideAiSuggestion(db, s.suggestion_id, userOf('YPR'), { accept: false }),
    (e) => e.code === ERR.DATA_SCOPE);
});

test('關閉開關 → 排程掃描將 pending 標 skipped（disabled）', async () => {
  setAi('ai.enabled', false);
  const caseId = submitCase(CONTENT_LEAK);
  const info = db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status) VALUES (?, 'classify', 'pending')"
  ).run(caseId);
  const out = await aiService.processClassifyQueue(db, { limit: 10 });
  assert.equal(out.processed, 1);
  const row = db.prepare('SELECT status, error FROM ai_suggestion WHERE suggestion_id = ?').get(info.lastInsertRowid);
  assert.equal(row.status, 'skipped');
  assert.equal(row.error, 'disabled');
});

test('aiStatus 回傳設定現況與環境變數就緒度；只回「是否已設定」不回金鑰值', () => {
  setAi('ai.enabled', true);
  setAi('ai.classify.enabled', true);
  setAi('ai.provider', 'rules');
  const s = aiService.aiStatus(db);
  assert.equal(s.provider, 'rules');
  assert.equal(s.effective, true);
  assert.deepEqual(s.providers, ['none', 'rules', 'openai', 'ollama']);
  assert.equal(typeof s.env.apiKeySet, 'boolean');
  assert.equal(typeof s.env.baseUrlSet, 'boolean');
  assert.ok(s.env.baseUrl, '應回解析後之 baseUrl（預設值）');
  assert.ok(!JSON.stringify(s).includes(process.env.AI_API_KEY || '##no-key##'),
    '不得回傳金鑰內容');

  setAi('ai.provider', 'none');
  assert.equal(aiService.aiStatus(db).effective, false, 'provider=none 時應為未生效');
  setAi('ai.provider', 'rules');
});

test('連線測試：rules 本機即測並寫審計；provider=none 回「已停用」', async () => {
  setAi('ai.provider', 'rules');
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'AI_TEST'").get().n;
  const out = await aiService.testAiConnection(db, userOf('ALL'), {});
  assert.equal(out.provider, 'rules');
  assert.equal(out.ok, true);
  assert.equal(out.local, true);
  assert.equal(out.skipped, false);
  assert.equal(out.model, 'rules');
  assert.equal(out.result.category, 'MAINTENANCE');
  assert.equal(out.result.eventType, 'URGENT');
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'AI_TEST'").get().n;
  assert.equal(after, before + 1);

  const none = await aiService.testAiConnection(db, userOf('ALL'), { provider: 'none' });
  assert.equal(none.ok, false);
  assert.equal(none.skipped, true);
  assert.match(none.message, /停用/);
});

test('連線測試：openai 缺 AI_API_KEY → ok=false，錯誤入 ai_usage_log(task=test)', async () => {
  const prev = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    const out = await aiService.testAiConnection(db, userOf('ALL'), { provider: 'openai' });
    assert.equal(out.ok, false);
    assert.equal(out.local, false);
    assert.match(out.error, /AI_API_KEY/);
    assert.equal(out.result, null);
  } finally {
    if (prev === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = prev;
  }
  const row = db.prepare("SELECT * FROM ai_usage_log WHERE task = 'test' ORDER BY usage_id DESC LIMIT 1").get();
  assert.ok(row, '應寫入測試用量日誌');
  assert.equal(row.ok, 0);
  assert.match(row.error, /AI_API_KEY/);
});

test('AI API 設定：base_url／model 入系統參數，優先於環境變數', () => {
  setAi('ai.api.base_url', 'https://db.example.com/v1');
  setAi('ai.api.model', 'db-model');
  process.env.AI_BASE_URL = 'https://env.example.com/v1';
  process.env.AI_MODEL = 'env-model';
  try {
    const s = aiService.aiStatus(db);
    assert.equal(s.env.baseUrl, 'https://db.example.com/v1');
    assert.equal(s.env.baseUrlSource, 'db');
    assert.equal(s.env.model, 'db-model');
    assert.equal(s.env.modelSource, 'db');
    const opts = aiService.remoteApiOptions(db);
    assert.equal(opts.baseUrl, 'https://db.example.com/v1');
    assert.equal(opts.model, 'db-model');
  } finally {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
  }

  // 清空系統參數 → 回落環境變數
  setAi('ai.api.base_url', '');
  setAi('ai.api.model', '');
  const s2 = aiService.aiStatus(db);
  assert.equal(s2.env.baseUrlSource, 'default');
  assert.equal(s2.env.modelSource, 'default');
});

test('系統參數 ai.api.* 為可編輯 string 且驗證 URL 格式', () => {
  const admin = userOf('ALL');
  const list = configService.listConfigs(db);
  const aiGroup = list.groups.find((g) => g.key === 'AI');
  const baseUrl = aiGroup.items.find((i) => i.key === 'ai.api.base_url');
  assert.equal(baseUrl.editable, true);
  assert.equal(baseUrl.type, 'string');

  assert.throws(() => configService.updateConfig(db, 'ai.api.base_url', 'ftp://bad', admin),
    (e) => e.code === ERR.VALIDATION);
  assert.throws(() => configService.updateConfig(db, 'ai.api.base_url', 123, admin),
    (e) => e.code === ERR.VALIDATION);
  const r = configService.updateConfig(db, 'ai.api.base_url', '', admin);
  assert.equal(r.value, '', '空白（用環境變數）應允許');
});

test('saveAiApiKey：寫入 .env、即時更新 process.env、遮罩回傳、審計不記值', () => {
  const tmp = path.join(os.tmpdir(), `ai_env_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.env`);
  fs.writeFileSync(tmp, 'PORT=3000\nAI_MODEL=keep-me\n');
  const prevFile = process.env.AI_ENV_FILE;
  const prevKey = process.env.AI_API_KEY;
  process.env.AI_ENV_FILE = tmp;
  try {
    const out = aiService.saveAiApiKey(db, userOf('ALL'), { apiKey: 'sk-secret-abcdef1234' });
    assert.equal(out.apiKeySet, true);
    assert.equal(out.persisted, true);
    assert.equal(out.apiKeyMasked, 'sk-****1234');
    assert.equal(process.env.AI_API_KEY, 'sk-secret-abcdef1234', '應即時生效');
    const text = fs.readFileSync(tmp, 'utf8');
    assert.ok(text.includes('AI_API_KEY=sk-secret-abcdef1234'), '.env 應含新金鑰');
    assert.ok(text.includes('AI_MODEL=keep-me'), '既有設定應保留');

    const audit = db.prepare("SELECT detail FROM audit_log WHERE action = 'AI_APIKEY_UPDATE' ORDER BY audit_id DESC LIMIT 1").get();
    assert.ok(audit, '應寫審計');
    assert.ok(!audit.detail.includes('sk-secret'), '審計不得含金鑰明文');

    // 清除
    const cleared = aiService.saveAiApiKey(db, userOf('ALL'), { apiKey: '' });
    assert.equal(cleared.apiKeySet, false);
    assert.equal(cleared.apiKeyMasked, null);
    assert.equal(process.env.AI_API_KEY, undefined);
    assert.ok(fs.readFileSync(tmp, 'utf8').includes('AI_API_KEY='));

    // 上限 500 字：500 可接受，501 應拒絕
    const ok500 = aiService.saveAiApiKey(db, userOf('ALL'), { apiKey: 'x'.repeat(500) });
    assert.equal(ok500.apiKeySet, true);
    assert.throws(() => aiService.saveAiApiKey(db, userOf('ALL'), { apiKey: 'x'.repeat(501) }),
      (e) => e.code === ERR.VALIDATION);
  } finally {
    if (prevFile === undefined) delete process.env.AI_ENV_FILE;
    else process.env.AI_ENV_FILE = prevFile;
    if (prevKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = prevKey;
    try { fs.unlinkSync(tmp); } catch { /* 清理失敗不影響測試 */ }
  }
});

test('reanalyzeCase：為現有個案補跑建議（開關開啟前／後台建案亦可）', async () => {
  setAi('ai.enabled', true);
  setAi('ai.provider', 'rules');
  // 先關閉開關建案 → 不應有建議
  setAi('ai.enabled', false);
  const caseId = submitCase(CONTENT_LEAK);
  assert.equal(latestSuggestion(caseId), undefined, '開關關閉時建案不產生建議');
  // 開啟後重新分析 → 應產生 shown 建議
  setAi('ai.enabled', true);
  const rows = await aiService.reanalyzeCase(db, caseId, userOf('ALL'));
  assert.ok(rows.length >= 1);
  const top = rows[0];
  assert.equal(top.status, 'shown');
  assert.equal(top.payload.category, 'MAINTENANCE');
  const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target_id = ? AND action = 'AI_REANALYZE'").get(caseId);
  assert.equal(audit.n, 1);

  // AI 未啟用時重新分析 → 明確報錯
  setAi('ai.provider', 'none');
  await assert.rejects(() => aiService.reanalyzeCase(db, caseId, userOf('ALL')),
    (e) => e.code === ERR.VALIDATION);
  setAi('ai.provider', 'rules');
});

test('連線測試：自訂文字生效；過長文字於路由層以外亦截斷至 1000 字', async () => {
  setAi('ai.provider', 'rules');
  const out = await aiService.testAiConnection(db, userOf('ALL'), { text: '垃圾房好臭，有曱甴，請清潔。' });
  assert.equal(out.ok, true);
  assert.equal(out.result.category, 'CLEANLINESS');

  const long = await aiService.testAiConnection(db, userOf('ALL'), { text: '漏水'.repeat(800) });
  assert.equal(long.ok, true, '截斷後仍可分類，不應拋錯');
});

/* ====================== AI-02 語意防重 ====================== */

test('lexicalEmbed／cosine／sharedEntities 基本性質', () => {
  const { lexicalEmbed, cosine, sharedEntities } = require('../src/services/aiProvider');
  const a = lexicalEmbed('廁所天花爆喉漏水，請維修。');
  const b = lexicalEmbed('廁所天花爆喉漏水，請維修。');
  const c = lexicalEmbed('垃圾房好臭有曱甴。');
  assert.equal(a.length, 256);
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-6, '相同文字餘弦≈1');
  assert.ok(cosine(a, c) < cosine(a, b), '相似度應低於自身');
  const sh = sharedEntities('廁所天花爆喉漏水 3座', '廁所天花爆喉漏水 3座請快啲');
  assert.ok(sh.includes('漏水') || sh.some((x) => x.includes('漏水')));
});

test('AI-02：建案入隊相似個案；rules 本地向量比對同內容個案', async () => {
  clearCases();
  seedEstate('SIM21');
  setAi('ai.enabled', true);
  setAi('ai.classify.enabled', true);
  setAi('ai.provider', 'rules');
  setAi('ai.similar.enabled', true);
  // 專屬屋苑，避免與其他測試既有個案互相污染
  const first = submitCase('廁所天花爆喉漏水，好危險，請盡快維修。', { estate: 'SIM21' });
  const second = submitCase('廁所天花爆喉漏水，好危險，請盡快維修，麻煩快啲。', { estate: 'SIM21' });
  const sim = db.prepare(
    "SELECT * FROM ai_suggestion WHERE case_id = ? AND ai_type = 'similar_case' ORDER BY suggestion_id DESC LIMIT 1"
  ).get(second);
  assert.ok(sim, '應入隊 similar_case');
  assert.equal(sim.status, 'shown');
  const payload = JSON.parse(sim.payload);
  assert.ok(payload.matches.length >= 1, '應命中至少一宗相似個案');
  assert.ok(payload.matches.some((m) => m.caseId === first), '應關聯到第一宗');
  assert.ok(payload.matches[0].score >= 0.82, '相似度應達門檻');
});

test('AI-02：關聯相似個案 → 設定 original_case_id 並寫審計；未啟用則不入隊', async () => {
  clearCases();
  seedEstate('SIM22');
  setAi('ai.enabled', true);
  setAi('ai.provider', 'rules');
  setAi('ai.similar.enabled', true);
  const first = submitCase('電梯壞咗唔郁，好危險。', { estate: 'SIM22' });
  const second = submitCase('電梯壞咗唔郁，好危險，快啲整。', { estate: 'SIM22' });
  // 以服務確認相似度並注入 shown 建議，避免與自動入隊時序耦合
  const res = await aiService.findSimilarCases(db, second);
  assert.ok(res.enabled, 'AI-02 應啟用');
  assert.ok(res.matches.some((m) => m.caseId === first), '應偵測到第一宗為相似個案');
  db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status, payload, model, created_by) VALUES (?, 'similar_case', 'shown', ?, ?, 'TEST')"
  ).run(second, JSON.stringify({
    matches: res.matches, threshold: res.threshold, lookbackDays: res.lookbackDays,
  }), res.model);
  const sim = db.prepare(
    "SELECT * FROM ai_suggestion WHERE case_id = ? AND ai_type = 'similar_case' ORDER BY suggestion_id DESC LIMIT 1"
  ).get(second);
  assert.equal(sim.status, 'shown');
  const out = aiService.linkSimilarCase(db, sim.suggestion_id, userOf('ALL'), { targetCaseId: first });
  assert.equal(out.status, 'accepted');
  assert.equal(out.originalCaseId, first);
  const c = db.prepare('SELECT original_case_id, is_second_complaint FROM `case` WHERE case_id = ?').get(second);
  assert.equal(c.original_case_id, first);
  assert.equal(c.is_second_complaint, 1);
  const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'CASE_LINK_SIMILAR' AND target_id = ?").get(second);
  assert.equal(audit.n, 1);
  // 關聯自身應被拒（用一筆仍為 shown 的建議測試，避免被前次 accepted 狀態擋下 STATE_TRANSITION）
  db.prepare(
    "INSERT INTO ai_suggestion (case_id, ai_type, status, payload, model, created_by) VALUES (?, 'similar_case', 'shown', ?, ?, 'TEST')"
  ).run(second, JSON.stringify({ matches: [], threshold: 0.82, lookbackDays: 30 }), 'rules');
  const selfSim = db.prepare(
    "SELECT * FROM ai_suggestion WHERE case_id = ? AND ai_type = 'similar_case' ORDER BY suggestion_id DESC LIMIT 1"
  ).get(second);
  assert.equal(selfSim.status, 'shown');
  assert.throws(() => aiService.linkSimilarCase(db, selfSim.suggestion_id, userOf('ALL'), { targetCaseId: second }),
    (e) => e.code === ERR.VALIDATION);
  // 未啟用 → 建案不入隊；findSimilarCases 回 enabled=false
  setAi('ai.similar.enabled', false);
  const caseId3 = submitCase('噪音好大，半夜都聽到狗吠。', { estate: 'SIM22' });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM ai_suggestion WHERE case_id = ? AND ai_type = 'similar_case'").get(caseId3).n,
    0
  );
  const res2 = await aiService.findSimilarCases(db, caseId3);
  assert.equal(res2.enabled, false);
});

/* ====================== AI-03 智能分派建議 ====================== */

test('AI-03：依類別＋歷史統計輸出建議分派人選與理由；未啟用則回 enabled=false 且無候選', () => {
  clearCases();
  setAi('ai.enabled', true);
  setAi('ai.assign.enabled', true);
  setAi('ai.assign.lookback_days', 90);
  // 沿用已種子之 CHNG 主管／職員，避免自行插用戶觸發 FK
  const sup = db.prepare(
    "SELECT u.user_id AS userId FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.user_id JOIN sys_role r ON r.role_id=ur.role_id WHERE r.role_code='ESTATE_SUPERVISOR' AND (r.data_scope='ALL' OR u.estate_code='CHNG') LIMIT 1"
  ).get();
  assert.ok(sup, '測試資料應含 CHNG 主管');
  const caseId = submitCase('有陌生人喺地下大堂徘徊，懷疑爆竊，請保安跟進。', { category: ['SECURITY'], estate: 'CHNG' });
  const out = aiService.suggestAssignee(db, caseId, userOf('ALL'));
  assert.equal(out.enabled, true);
  assert.equal(out.category, 'SECURITY');
  assert.equal(out.preferredRole, 'ESTATE_SUPERVISOR');
  assert.ok(out.candidates.length >= 1);
  const supInCand = out.candidates.find((x) => x.userId === sup.userId);
  assert.ok(supInCand, 'CHNG 主管應為候選');
  assert.equal(supInCand.isPreferredRole, true);
  // 建議人選應為得分最高者
  const top = out.candidates.reduce((a, b) => (b.score > a.score ? b : a));
  assert.equal(out.suggestedUserId, top.userId);
  // 未啟用 → 回 enabled=false 且無候選（禁用分支在讀取類別前短路）
  setAi('ai.assign.enabled', false);
  const out2 = aiService.suggestAssignee(db, caseId, userOf('ALL'));
  assert.equal(out2.enabled, false);
  assert.deepEqual(out2.candidates, []);
});

test('configService：AI-02/03 新參數入目錄且 number/json 類型驗證生效', () => {
  const admin = userOf('ALL');
  const list = configService.listConfigs(db);
  const aiGroup = list.groups.find((g) => g.key === 'AI');
  const th = aiGroup.items.find((i) => i.key === 'ai.similar.threshold');
  const cr = aiGroup.items.find((i) => i.key === 'ai.assign.category_role');
  assert.equal(th.editable, true);
  assert.equal(th.type, 'number');
  assert.equal(cr.editable, true);
  assert.equal(cr.type, 'json');
  // number 類型越界應拒
  assert.throws(() => configService.updateConfig(db, 'ai.similar.threshold', 1.5, admin), (e) => e.code === ERR.VALIDATION);
  assert.throws(() => configService.updateConfig(db, 'ai.similar.threshold', '0.9', admin), (e) => e.code === ERR.VALIDATION);
  // json 類型非物件應拒
  assert.throws(() => configService.updateConfig(db, 'ai.assign.category_role', [1, 2], admin), (e) => e.code === ERR.VALIDATION);
  const ok = configService.updateConfig(db, 'ai.assign.category_role', { SECURITY: 'ESTATE_SUPERVISOR' }, admin);
  assert.deepEqual(ok.value, { SECURITY: 'ESTATE_SUPERVISOR' });
});
  /* ---------------- AI-04 草擬回覆／個案摘要（§4.4） ---------------- */

  /** 直接插入已提交問卷（AI-05 用；status=SUBMITTED 且具開放文字） */
  function seedSubmittedSurvey(caseId, feedback, { overall = 2 } = {}) {
    const token = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const info = db.prepare(
      `INSERT INTO satisfaction_survey (case_id, survey_token, lang, sent_at, expires_at, submitted_at,
         rating_overall, rating_response, rating_attitude, rating_resolution, feedback, status, is_low_score)
       VALUES (?, ?, 'zh-Hant', datetime('now'), datetime('now', '+14 day'), datetime('now'), ?, ?, ?, ?, ?, 'SUBMITTED', ?)`
    ).run(caseId, token, overall, overall, overall, overall, feedback, overall <= 2 ? 1 : 0);
    return Number(info.lastInsertRowid);
  }

  /** 插入未提交問卷（AI-05 狀態檢核用） */
  function seedDraftSurvey(caseId) {
    const token = `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const info = db.prepare(
      "INSERT INTO satisfaction_survey (case_id, survey_token, lang, sent_at, expires_at, status) VALUES (?, ?, 'zh-Hant', datetime('now'), datetime('now', '+14 day'), 'SENT')"
    ).run(caseId, token);
    return Number(info.lastInsertRowid);
  }

  test('AI-04 未啟用時拒絕產生草稿；啟用後產生摘要與回覆草稿（rules 範本、de-PII）', async () => {
    clearCases();
    setAi('ai.enabled', true);
    setAi('ai.provider', 'rules');
    setAi('ai.draft.enabled', false);
    const caseId = submitCase('廁所天花爆喉漏水，好危險，請盡快派師傅維修。聯絡電話 91234567。', { category: ['MAINTENANCE'], estate: 'CHNG' });
    await assert.rejects(() => aiService.createDraft(db, caseId, userOf('ALL'), { kind: 'summary' }), (e) => e.code === ERR.VALIDATION);

    setAi('ai.draft.enabled', true);
    const sum = await aiService.createDraft(db, caseId, userOf('ALL'), { kind: 'summary' });
    assert.equal(sum.aiType, 'draft');
    assert.equal(sum.status, 'shown');
    assert.equal(sum.kind, 'summary');
    assert.ok(sum.payload.points.length >= 3, '摘要應至少 3 點');
    assert.ok(sum.payload.points.some((pt) => pt.label === '問題'));
    assert.ok(!sum.payload.text.includes('91234567'), '草稿不得含客戶電話（de-PII）');

    const rep = await aiService.createDraft(db, caseId, userOf('ALL'), { kind: 'reply' });
    assert.equal(rep.kind, 'reply');
    assert.ok(rep.payload.text.includes(caseId), '回覆草稿應含個案編號');
    assert.ok(rep.payload.text.includes('測試員'), '稱呼應於伺服器端合併');
    assert.ok(!rep.payload.text.includes('91234567'), '回覆草稿不得含客戶電話');

    const row = latestSuggestion(caseId);
    assert.equal(row.ai_type, 'draft');
    const audits = db.prepare("SELECT * FROM audit_log WHERE action = 'AI_DRAFT_CREATED' AND target_id = ?").all(caseId);
    assert.ok(audits.length >= 1, '應寫入 AI_DRAFT_CREATED 審計');
    setAi('ai.draft.enabled', false);
  });

  test('AI-04 採納草稿：存入 case_log（NOTE）＋AI_DRAFT_USED；空內容／跨個案／越 scope 應拒', async () => {
    clearCases();
    setAi('ai.enabled', true);
    setAi('ai.draft.enabled', true);
    const caseId = submitCase('走廊燈長期失靈，晚上很危險，請安排維修。', { category: ['MAINTENANCE'], estate: 'CHNG' });
    const d = await aiService.createDraft(db, caseId, userOf('ALL'), { kind: 'reply' });

    assert.throws(
      () => aiService.useDraft(db, caseId, d.suggestionId, userOf('ALL'), { content: '   ' }),
      (e) => e.code === ERR.VALIDATION
    );

    const finalText = '感謝反映，我們已安排師傅於兩日內更換走廊燈。';
    const used = aiService.useDraft(db, caseId, d.suggestionId, userOf('ALL'), { content: finalText });
    assert.equal(used.status, 'accepted');
    assert.equal(used.kind, 'reply');
    const log = db.prepare("SELECT * FROM case_log WHERE case_id = ? AND log_type = 'NOTE' ORDER BY log_id DESC LIMIT 1").get(caseId);
    assert.ok(log && log.log_content.includes(finalText), '人手編輯後內容應存入 case_log');
    assert.ok(log.log_content.includes('經人手編輯後採用'));
    const sug = db.prepare('SELECT status FROM ai_suggestion WHERE suggestion_id = ?').get(d.suggestionId);
    assert.equal(sug.status, 'accepted');
    const usedAudits = db.prepare("SELECT * FROM audit_log WHERE action = 'AI_DRAFT_USED' AND target_id = ?").all(caseId);
    assert.equal(usedAudits.length, 1, '應寫入 AI_DRAFT_USED 審計');

    // 跨個案不可採用
    const other = submitCase('另一個案內容完全唔同嘅事項。', { category: ['OTHER'], estate: 'CHNG' });
    assert.throws(
      () => aiService.useDraft(db, other, d.suggestionId, userOf('ALL'), { content: 'x' }),
      (e) => e.code === ERR.VALIDATION
    );
    // 屋苑範圍外
    assert.throws(
      () => aiService.useDraft(db, caseId, d.suggestionId, userOf('OTH'), { content: 'x' }),
      (e) => e.code === ERR.DATA_SCOPE
    );
    setAi('ai.draft.enabled', false);
  });

  /* ---------------- AI-05 問卷開放意見分析（§4.5） ---------------- */

  test('AI-05 意見分析：未啟用拒絕；啟用後分析已提交問卷並彙總主題／情緒', async () => {
    clearCases();
    setAi('ai.enabled', true);
    setAi('ai.provider', 'rules');
    setAi('ai.feedback.enabled', false);
    const caseId = submitCase('升降機經常故障，維修很慢，非常不滿。', { category: ['MAINTENANCE'], estate: 'CHNG' });
    const surveyId = seedSubmittedSurvey(caseId, '升降機成日壞，維修又慢，等咗好耐都冇人跟進，非常不滿。', { overall: 2 });
    await assert.rejects(() => aiService.analyzeSurveyFeedback(db, surveyId, userOf('ALL')), (e) => e.code === ERR.VALIDATION);

    setAi('ai.feedback.enabled', true);
    const ins = await aiService.analyzeSurveyFeedback(db, surveyId, userOf('ALL'));
    assert.equal(ins.caseId, caseId);
    assert.ok(ins.topics.includes('維修') || ins.topics.includes('電梯'), '應標出主題');
    assert.equal(ins.sentiment, 'negative');
    assert.ok(ins.summary.length > 0);
    const row = db.prepare('SELECT * FROM ai_feedback_insight WHERE survey_id = ?').get(surveyId);
    assert.ok(row, '應寫入 ai_feedback_insight');
    assert.equal(row.sentiment, 'negative');

    const agg = aiService.listFeedbackInsights(db, {}, userOf('ALL'));
    assert.ok(agg.total >= 1);
    assert.ok(agg.topics.some((t) => t.topic === '維修' || t.topic === '電梯'));
    assert.ok(agg.sentiment.negative >= 1);
    // 屋苑範圍外應看不到
    const otherScope = aiService.listFeedbackInsights(db, {}, userOf('OTH'));
    assert.equal(otherScope.items.length, 0);
    // 個案層級（低分「可能成因摘要」）
    const one = aiService.caseFeedbackInsight(db, caseId, userOf('ALL'));
    assert.ok(one && one.surveyId === surveyId);
    setAi('ai.feedback.enabled', false);
  });

  test('AI-05 批次佇列：處理未分析問卷且不重複；未提交問卷應拒', async () => {
    clearCases();
    setAi('ai.enabled', true);
    setAi('ai.feedback.enabled', true);
    const caseId = submitCase('垃圾房臭味嚴重，清潔不足。', { category: ['CLEANLINESS'], estate: 'CHNG' });
    seedSubmittedSurvey(caseId, '垃圾房好臭，清潔唔夠，鼠患嚴重。', { overall: 3 });
    const first = await aiService.processFeedbackQueue(db, { limit: 10 });
    assert.equal(first.processed, 1);
    const again = await aiService.processFeedbackQueue(db, { limit: 10 });
    assert.equal(again.processed, 0, '已分析問卷不應重複處理');
    const audits = db.prepare("SELECT * FROM audit_log WHERE action = 'AI_FEEDBACK_ANALYZE'").all();
    assert.ok(audits.length >= 1, '批次層面應寫入 AI_FEEDBACK_ANALYZE');
    // 未提交之問卷應拒
    const s2 = seedDraftSurvey(caseId);
    await assert.rejects(() => aiService.analyzeSurveyFeedback(db, s2, userOf('ALL')), (e) => e.code === ERR.STATE_TRANSITION);
    setAi('ai.feedback.enabled', false);
  });

  test('AI-06 週報摘要：未啟用拒絕；啟用後由彙總數字生成三節敘事（rules）', async () => {
    setAi('ai.enabled', true);
    setAi('ai.provider', 'rules');
    setAi('ai.weekly_summary.enabled', false);
    const summary = {
      range: { from: '2026-09-01', to: '2026-09-07' },
      kpi: [
        { key: 'KPI_01', labelZh: '新接獲意見', value: 34, unit: '宗', delta: 8 },
        { key: 'KPI_03', labelZh: '結案', value: 29, unit: '宗', delta: 2 },
        { key: 'KPI_11', labelZh: '逾期', value: 3, unit: '宗', delta: null },
        { key: 'KPI_09', labelZh: '平均整體滿意度', value: 3.4, unit: '分', delta: -0.2 },
      ],
    };
    const anomalies = { counts: { OVERDUE: 3, LOW_SCORE: 2, SECOND: 1 }, items: [] };
    await assert.rejects(
      () => aiService.generateWeeklySummary(db, { summary, anomalies }),
      (e) => e.code === ERR.VALIDATION
    );

    setAi('ai.weekly_summary.enabled', true);
    const res = await aiService.generateWeeklySummary(db, { summary, anomalies });
    assert.equal(res.model, 'rules');
    assert.ok(res.text.includes('本週重點'), '應含「本週重點」');
    assert.ok(res.text.includes('值得關注'), '應含「值得關注」');
    assert.ok(res.text.includes('建議行動'), '應含「建議行動」');
    assert.ok(res.text.includes('逾期'), '應反映逾期異常');

    // 整合：既有週報重算 AI 摘要（開關開啟後補跑舊報表）
    const ins = db.prepare(
      "INSERT INTO weekly_report (period_start, period_end, period_key, summary_json, anomaly_json, generated_by, generated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run('2026-09-01', '2026-09-07', '2026-09-01', JSON.stringify(summary), JSON.stringify(anomalies.items), 0, );
    const reportId = Number(ins.lastInsertRowid);
    const r = await weekly.regenerateWeeklyAiSummary(db, reportId);
    assert.ok(r.aiSummary && r.aiSummary.includes('本週重點'), '重算後應寫入 aiSummary');
    const listed = weekly.listWeeklyReports(db, { limit: 5 });
    const found = listed.find((x) => x.reportId === reportId);
    assert.ok(found && found.aiSummary, 'list 應回傳 aiSummary');
    db.prepare('DELETE FROM weekly_report WHERE report_id = ?').run(reportId);
    setAi('ai.weekly_summary.enabled', false);
  });

  test('AI-07 附件影像理解：未啟用拒絕；rules 模式標示「未使用視覺模型」並寫入 ai_suggestion', async () => {
    const caseId = submitCase('天花滴水，麻煩盡快派人處理。（9123-4567）');
    const all = userOf('ALL');
    // 建立附件 meta（rules 模式唔讀檔，故只需 DB 記錄）
    const logRow = db.prepare('SELECT log_id AS logId FROM case_log WHERE case_id = ? ORDER BY log_id LIMIT 1').get(caseId);
    const info = db.prepare(
      "INSERT INTO case_log_attachment (log_id, case_id, file_name, file_size, file_type, storage_key, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(logRow.logId, caseId, 'leak.jpg', 123456, 'jpg', 'stub_key.jpg', 0);
    const attachmentId = Number(info.lastInsertRowid);

    setAi('ai.enabled', true);
    setAi('ai.attachment.enabled', false);
    await assert.rejects(() => aiService.analyzeAttachment(db, caseId, attachmentId, all), (e) => e.code === ERR.VALIDATION);

    setAi('ai.attachment.enabled', true);
    setAi('ai.provider', 'rules');
    const r = await aiService.analyzeAttachment(db, caseId, attachmentId, all);
    assert.equal(r.visionUsed, false, '規則模式唔應聲稱用咗視覺模型');
    assert.equal(r.model, 'rules');
    assert.equal(r.category, 'OTHER');
    assert.ok(r.description.includes('規則模式'), '應明確說明 rules 無影像理解能力');

    // 結果寫入 ai_suggestion(attachment_insight)，並可由既有 ai-suggestions 讀取
    const row = db.prepare('SELECT ai_type, status, payload FROM ai_suggestion WHERE suggestion_id = ?').get(r.suggestionId);
    assert.equal(row.ai_type, 'attachment_insight');
    assert.equal(row.status, 'shown');
    assert.equal(JSON.parse(row.payload).attachmentId, attachmentId);
    assert.ok(aiService.listAiSuggestions(db, caseId, all).some((x) => x.aiType === 'attachment_insight'));
    const insights = aiService.attachmentInsights(db, caseId, all);
    assert.equal(insights.length, 1);
    assert.equal(insights[0].attachmentId, attachmentId);

    // 私隱保護：local_only=true 時拒絕雲端供應商（影像含人樣／車牌）
    setAi('ai.provider', 'openai');
    setAi('ai.vision.local_only', true);
    await assert.rejects(
      () => aiService.analyzeAttachment(db, caseId, attachmentId, all),
      (e) => e.code === ERR.VALIDATION && /local_only/.test(e.message)
    );

    setAi('ai.provider', 'rules');
    setAi('ai.attachment.enabled', false);
    setAi('ai.vision.local_only', true);
  });


});
