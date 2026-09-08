'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase } = require('../src/db/connection');
const { createCaseFromFeedback } = require('../src/services/caseService');
const aiService = require('../src/services/aiService');
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

const CONTENT_LEAK = '廁所天花爆喉漏水，好危險，請盡快維修。';

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
