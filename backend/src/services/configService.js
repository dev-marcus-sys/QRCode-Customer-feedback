/**
 * F-009 系統參數配置（FR-009-01/02/06）：
 * - 目錄服務：可編輯白名單＋meta（型態、驗證、群組、labelZh）
 * - 更新：白名單驗證 → UPSERT → sys_config_audit → audit_log(CONFIG_CHANGE) → 站內通知 ADMIN/CC_SUPERVISOR
 * - 骨架採「直接修改即時生效＋完整審計」；兩段「建議→審批」流程為規格書擴充（sys_config_audit.action 已預留）
 */
'use strict';
const { getConfig } = require('../db/configStore');
const { ApiError } = require('../middlewares/error');
const { ERR, EVENT_TYPE } = require('../config/constants');
const { dbToIso8 } = require('../utils/time');
const { usersByRole, notifyUser } = require('./notificationService');

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const CATEGORY_KEYS = ['MO_SERVICE', 'SECURITY', 'MAINTENANCE', 'CLEANLINESS', 'NUISANCE', 'OTHER'];
const RESPONSE_KEYS = ['URGENT', 'NORMAL', 'COMPLEX', 'INSTANT'];

/** 可編輯白名單（不可編輯鍵僅供讀取顯示，見 §3.2 目錄） */
const CATALOG = [
  {
    key: 'sla.response', group: 'SLA', labelZh: '首次回應時限（分鐘）',
    kind: 'minutesMap', fields: RESPONSE_KEYS,
  },
  {
    key: 'sla.closure_days', group: 'SLA', labelZh: '關閉期限（天）',
    kind: 'int', min: 1, max: 30,
  },
  {
    key: 'sla.reminder', group: 'SLA', labelZh: 'SLA 提醒提前量',
    kind: 'reminder',
  },
  {
    key: 'category.event_mapping', group: 'CATEGORY', labelZh: '意見種類→事件類型對應',
    kind: 'eventMapping',
  },
  {
    key: 'survey.expiry_days', group: 'SURVEY', labelZh: '問卷調查有效期（天）',
    kind: 'int', min: 1, max: 90,
  },
  {
    key: 'weekly_report.schedule', group: 'WEEKLY', labelZh: '週報自動產生排程',
    kind: 'weeklySchedule',
  },
  {
    key: 'form.style', group: 'FORM', labelZh: '公眾表單樣式',
    kind: 'formStyle',
  },
  // ===== AI 參數（順序＝AI-00 總覽 → AI-01…AI-07；subGroup 供前端分節顯示） =====
  // --- AI-00 總覽與連線（§6.3 橫向服務層）---
  {
    key: 'ai.enabled', group: 'AI', labelZh: 'AI 總開關（關閉＝所有 AI 功能停用）',
    subGroup: 'AI-00 總覽與連線', kind: 'boolean',
  },
  {
    key: 'ai.provider', group: 'AI', labelZh: 'AI 供應商（rules＝本機規則基線）',
    subGroup: 'AI-00 總覽與連線', kind: 'enum', options: ['none', 'rules', 'openai', 'ollama'],
  },
  {
    key: 'ai.pii.mode', group: 'AI', labelZh: 'de-PII 模式（local＝出外前先遮罩）',
    subGroup: 'AI-00 總覽與連線', kind: 'enum', options: ['local', 'cloud'],
  },
  {
    key: 'ai.api.base_url', group: 'AI', labelZh: 'AI API 端點 Base URL（空白＝環境變數）',
    subGroup: 'AI-00 總覽與連線', kind: 'string', maxLength: 300, url: true, allowEmpty: true,
  },
  {
    key: 'ai.api.model', group: 'AI', labelZh: 'AI 模型名稱（空白＝環境變數）',
    subGroup: 'AI-00 總覽與連線', kind: 'string', maxLength: 120, allowEmpty: true,
  },
  // --- AI-01 內容分類建議（§4.1）---
  {
    key: 'ai.classify.enabled', group: 'AI', labelZh: 'AI-01 內容分類建議（影子模式）',
    subGroup: 'AI-01 內容分類', kind: 'boolean',
  },
  // --- AI-02 語意防重（§4.2）---
  {
    key: 'ai.similar.enabled', group: 'AI', labelZh: 'AI-02 語意防重（相似個案建議）',
    subGroup: 'AI-02 語意防重', kind: 'boolean',
  },
  {
    key: 'ai.similar.lookback_days', group: 'AI', labelZh: 'AI-02 比對回溯期（天）',
    subGroup: 'AI-02 語意防重', kind: 'int', min: 1, max: 365,
  },
  {
    key: 'ai.similar.threshold', group: 'AI', labelZh: 'AI-02 相似度門檻（0.3~0.99）',
    subGroup: 'AI-02 語意防重', kind: 'number', min: 0.3, max: 0.99,
  },
  {
    key: 'ai.similar.max_matches', group: 'AI', labelZh: 'AI-02 最多建議關聯個案數',
    subGroup: 'AI-02 語意防重', kind: 'int', min: 1, max: 10,
  },
  // --- AI-03 智能分派建議（§4.3）---
  {
    key: 'ai.assign.enabled', group: 'AI', labelZh: 'AI-03 智能分派建議',
    subGroup: 'AI-03 智能分派', kind: 'boolean',
  },
  {
    key: 'ai.assign.category_role', group: 'AI', labelZh: 'AI-03 類別→偏好角色對照（JSON）',
    subGroup: 'AI-03 智能分派', kind: 'json',
  },
  {
    key: 'ai.assign.lookback_days', group: 'AI', labelZh: 'AI-03 統計回溯期（天）',
    subGroup: 'AI-03 智能分派', kind: 'int', min: 7, max: 365,
  },
  // --- AI-04 草擬回覆與個案摘要（§4.4）---
  {
    key: 'ai.draft.enabled', group: 'AI', labelZh: 'AI-04 草擬回覆／個案摘要',
    subGroup: 'AI-04 回覆草稿', kind: 'boolean',
  },
  {
    key: 'ai.draft.style_guide', group: 'AI', labelZh: 'AI-04 回覆風格指引',
    subGroup: 'AI-04 回覆草稿', kind: 'string', maxLength: 500, allowEmpty: true,
  },
  // --- AI-05 問卷開放意見分析（§4.5）---
  {
    key: 'ai.feedback.enabled', group: 'AI', labelZh: 'AI-05 問卷開放意見分析',
    subGroup: 'AI-05 問卷分析', kind: 'boolean',
  },
  {
    key: 'ai.feedback.lookback_days', group: 'AI', labelZh: 'AI-05 分析回溯期（天）',
    subGroup: 'AI-05 問卷分析', kind: 'int', min: 7, max: 365,
  },
  // --- AI-06 週報 AI 摘要（§4.6；輸入為彙總數字，私隱風險最低）---
  {
    key: 'ai.weekly_summary.enabled', group: 'AI', labelZh: 'AI-06 週報 AI 摘要',
    subGroup: 'AI-06 週報摘要', kind: 'boolean',
  },
  {
    key: 'ai.weekly_summary.style', group: 'AI', labelZh: 'AI-06 週報摘要風格指引',
    subGroup: 'AI-06 週報摘要', kind: 'string', maxLength: 500, allowEmpty: true,
  },
  // --- AI-07 附件影像理解（§4.7；影像含人樣／車牌，私隱敏感度高）---
  {
    key: 'ai.attachment.enabled', group: 'AI', labelZh: 'AI-07 附件影像理解（OCR／描述）',
    subGroup: 'AI-07 附件影像', kind: 'boolean',
  },
  {
    key: 'ai.vision.local_only', group: 'AI', labelZh: 'AI-07 影像只走本地模型（不外送雲端）',
    subGroup: 'AI-07 附件影像', kind: 'boolean',
  },
  // --- AI-08 逾期風險預警（§4.8；級一純統計，輸入只係系統內數字）---
  {
    key: 'ai.risk.enabled', group: 'AI', labelZh: 'AI-08 逾期風險預警',
    subGroup: 'AI-08 逾期風險', kind: 'boolean',
  },
  {
    key: 'ai.risk.lookback_days', group: 'AI', labelZh: 'AI-08 歷史基線回溯期（天）',
    subGroup: 'AI-08 逾期風險', kind: 'int', min: 7, max: 365,
  },
  {
    key: 'ai.risk.notify_roles', group: 'AI', labelZh: 'AI-08 預警通知角色（逗號分隔）',
    subGroup: 'AI-08 逾期風險', kind: 'string', maxLength: 200, allowEmpty: true,
  },
  // --- AI-09 RAG 知識庫（§4.9；讀取入口與管理）---
  {
    key: 'ai.kb.enabled', group: 'AI', labelZh: 'AI-09 知識庫檢索開關',
    subGroup: 'AI-09 知識庫 (RAG)', kind: 'boolean',
  },
  {
    key: 'ai.kb.top_k', group: 'AI', labelZh: 'AI-09 檢索返回塊數（top-k）',
    subGroup: 'AI-09 知識庫 (RAG)', kind: 'int', min: 1, max: 20,
  },
  {
    key: 'ai.kb.threshold', group: 'AI', labelZh: 'AI-09 最低相似度（0~1）',
    subGroup: 'AI-09 知識庫 (RAG)', kind: 'number', min: 0, max: 1,
  },
  {
    key: 'ai.kb.answer_enabled', group: 'AI', labelZh: 'AI-09 以 LLM 生成附引用答案（需雲端/ollama）',
    subGroup: 'AI-09 知識庫 (RAG)', kind: 'boolean',
  },
];

const GROUP_ORDER = [
  { key: 'SLA', labelZh: 'SLA 時限' },
  { key: 'CATEGORY', labelZh: '意見種類對應' },
  { key: 'SURVEY', labelZh: '問卷' },
  { key: 'WEEKLY', labelZh: '週報' },
  { key: 'FORM', labelZh: '表單樣式' },
  { key: 'AI', labelZh: 'AI 參數' },
  { key: 'FORM_TYPE', labelZh: '表單與規則（唯讀）' },
  { key: 'NUMBERING', labelZh: '編號規則（唯讀）' },
  { key: 'SYSTEM', labelZh: '其他（唯讀）' },
];

function bad(msg) {
  return new ApiError(ERR.VALIDATION, msg);
}

const isInt = (v) => Number.isInteger(v) && typeof v !== 'boolean';

function assertIntRange(v, min, max, name) {
  if (!isInt(v) || v < min || v > max) throw bad(`${name} 須為 ${min}~${max} 之整數`);
}

const VALUE_ERROR = (name) => bad(`${name} 數值不合法`);

function validate(key, value) {
  const def = CATALOG.find((c) => c.key === key);
  if (!def) return;
  const kind = def.kind;
  if (kind === 'int') {
    assertIntRange(value, def.min, def.max, def.labelZh);
  } else if (kind === 'minutesMap') {
    if (!value || typeof value !== 'object') throw VALUE_ERROR(def.labelZh);
    for (const k of def.fields) {
      if (!RESPONSE_KEYS.includes(k)) throw VALUE_ERROR(def.labelZh);
      assertIntRange(value[k], 1, 1440, `${def.labelZh}（${k}）`);
    }
  } else if (kind === 'reminder') {
    if (!value || typeof value !== 'object') throw VALUE_ERROR(def.labelZh);
    const rl = value.responseLeadMinutes;
    if (!rl || typeof rl !== 'object') throw VALUE_ERROR(def.labelZh);
    for (const k of RESPONSE_KEYS) {
      if (!RESPONSE_KEYS.includes(k)) throw VALUE_ERROR(def.labelZh);
      assertIntRange(rl[k], 1, 1440, `${def.labelZh} 回應（${k}）`);
    }
    assertIntRange(value.closureLeadDays, 1, 7, `${def.labelZh} 關閉`);
  } else if (kind === 'eventMapping') {
    if (!value || typeof value !== 'object') throw VALUE_ERROR(def.labelZh);
    for (const k of CATEGORY_KEYS) {
      const v = value[k];
      if (v == null) throw bad(`缺少事項類別 ${k} 之對應`);
      if (!v.base || !EVENT_TYPE.includes(v.base)) throw bad(`事項類別 ${k} 的 base 須為 ${EVENT_TYPE.join(' / ')} 之一`);
    }
  } else if (kind === 'weeklySchedule') {
    if (!value || typeof value !== 'object') throw VALUE_ERROR(def.labelZh);
    const day = String(value.dayOfWeek || '').toUpperCase();
    if (!WEEKDAYS.includes(day)) throw bad('週報 dayOfWeek 須為 MON~SUN');
    const time = String(value.time || '');
    if (!/^\d{2}:\d{2}$/.test(time)) throw bad('週報 time 須為 HH:mm');
    const h = Number(time.slice(0, 2));
    const mm = Number(time.slice(3));
    if (h > 23 || mm > 59) throw bad('週報 time 不合法');
  } else if (kind === 'formStyle') {
    if (!value || typeof value !== 'object') throw VALUE_ERROR(def.labelZh);
    if (!/^#[0-9a-fA-F]{6}$/.test(value.primaryColor || '')) throw bad('主色須為 #RRGGBB 格式');
    for (const f of ['sloganZh', 'sloganEn']) {
      const t = String(value[f] == null ? '' : value[f]);
      if (t.length > 80) throw bad(`標語（${f}）不得超過 80 字`);
    }
  } else if (kind === 'boolean') {
    if (typeof value !== 'boolean') throw bad(`${def.labelZh} 須為 true / false`);
  } else if (kind === 'enum') {
    const opts = def.options || [];
    if (!opts.includes(value)) throw bad(`${def.labelZh} 須為 ${opts.join(' / ')} 之一`);
  } else if (kind === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) throw bad(`${def.labelZh} 須為數字`);
    assertIntRange(value, def.min, def.max, def.labelZh);
  } else if (kind === 'json') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad(`${def.labelZh} 須為 JSON 物件`);
  } else if (kind === 'string') {
    if (typeof value !== 'string') throw bad(`${def.labelZh} 須為字串`);
    const v = value.trim();
    if (!v && def.allowEmpty) return;
    if (def.maxLength && value.length > def.maxLength) throw bad(`${def.labelZh} 不得超過 ${def.maxLength} 字`);
    if (def.url && !/^https?:\/\/\S+$/i.test(v)) throw bad(`${def.labelZh} 須為 http(s):// 開頭之網址`);
  }
}

function configTypeOf(key) {
  const def = CATALOG.find((c) => c.key === key);
  if (def) return def.group;
  return 'SYSTEM';
}

function plainOf(key, value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** 全量目錄（含 meta 與每鍵更新資訊）；readOnly 之 form/numbering 亦列出 */
function listConfigs(db) {
  const rows = db.prepare(
    `SELECT c.config_key AS configKey, c.config_value AS configValue, c.config_type AS configType,
            c.updated_by AS updatedBy, c.updated_at AS updatedAt, u.full_name AS updatedByName
       FROM sys_config c LEFT JOIN sys_user u ON u.user_id = c.updated_by`
  ).all();
  // 群組內順序依 CATALOG 定義（AI-00→AI-01…AI-07），未列於目錄之唯讀鍵排於最後
  const catalogIndex = new Map(CATALOG.map((c, i) => [c.key, i]));
  const byGroup = new Map(GROUP_ORDER.map((g) => [g.key, { ...g, items: [] }]));
  const editable = new Set(CATALOG.map((c) => c.key));
  for (const r of rows) {
    let parsed;
    try { parsed = r.configValue == null ? null : JSON.parse(r.configValue); } catch { parsed = r.configValue; }
    const def = CATALOG.find((c) => c.key === r.configKey);
    const groupKey = def ? def.group : r.configType || 'SYSTEM';
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, { key: groupKey, labelZh: groupKey, items: [] });
    byGroup.get(groupKey).items.push({
      key: r.configKey,
      labelZh: def ? def.labelZh : r.configKey,
      // 未列於目錄之唯讀鍵（沿用既有 config_type）統一歸到「其他」分節，避免散落於末尾
      subGroup: def ? def.subGroup : (groupKey === 'AI' ? '其他 AI 參數（唯讀）' : undefined),
      type: def ? def.kind : 'readonly',
      editable: editable.has(r.configKey),
      value: parsed,
      updatedBy: r.updatedByName || null,
      updatedAt: r.updatedAt ? dbToIso8(r.updatedAt) : null,
      options: def && Array.isArray(def.options) ? def.options : undefined,
    });
  }
  const rank = (key) => (catalogIndex.has(key) ? catalogIndex.get(key) : Number.MAX_SAFE_INTEGER);
  const groups = [...byGroup.values()].filter((g) => g.items.length || g.key === 'SLA');
  for (const g of groups) g.items.sort((a, b) => (rank(a.key) !== rank(b.key) ? rank(a.key) - rank(b.key) : a.key.localeCompare(b.key)));
  return { groups, editableOnly: true };
}

function getOne(db, key) {
  const row = db.prepare(
    'SELECT config_key AS key, config_value AS value, config_type AS type FROM sys_config WHERE config_key = ?'
  ).get(key);
  if (!row) return null;
  let parsed;
  try { parsed = JSON.parse(row.value); } catch { parsed = row.value; }
  return { key: row.key, type: row.type, value: parsed };
}

function listAudit(db, { key, limit = 50 } = {}) {
  const where = key ? 'AND ca.config_key = ?' : '';
  const params = key ? [key] : [];
  const rows = db.prepare(
    `SELECT ca.audit_id AS auditId, ca.config_key AS configKey, ca.action, ca.old_value AS oldValue,
            ca.new_value AS newValue, ca.actor_id AS actorId, ca.actor_name AS actorName, ca.created_at AS createdAt
       FROM sys_config_audit ca
      WHERE 1 = 1 ${where}
      ORDER BY ca.audit_id DESC LIMIT ?`
  ).all(...params, Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({
    ...r,
    oldValue: r.oldValue == null ? null : parseOrRaw(r.oldValue),
    newValue: parseOrRaw(r.newValue),
    createdAt: dbToIso8(r.createdAt),
  }));
}

function parseOrRaw(s) {
  try { return JSON.parse(s); } catch { return s; }
}

/**
 * 更新配置（config:update；即時生效）。
 * @param {{ userId:number, username:string, fullName?:string }} user
 * @returns {Promise<object>} { key, labelZh, value, updatedAt }
 */
function updateConfig(db, key, value, user) {
  const def = CATALOG.find((c) => c.key === key);
  if (!def) throw new ApiError(ERR.VALIDATION, '該參數不支援直接編輯', 404);
  validate(key, value);
  const oldRaw = db.prepare('SELECT config_value AS v FROM sys_config WHERE config_key = ?').get(key);
  if (!oldRaw) throw new ApiError(ERR.VALIDATION, '參數不存在', 404);
  let oldValue;
  try { oldValue = JSON.parse(oldRaw.v); } catch { oldValue = oldRaw.v; }

  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO sys_config (config_key, config_type, config_value) VALUES (?, ?, ?)')
      .run(key, configTypeOf(key), plainOf(key, value));
    db.prepare(
      'UPDATE sys_config SET config_value = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE config_key = ?'
    ).run(plainOf(key, value), user.userId, key);
    db.prepare(
      'INSERT INTO sys_config_audit (config_key, action, old_value, new_value, actor_id, actor_name) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(key, 'UPDATE', plainOf(key, oldValue), plainOf(key, value), user.userId, user.fullName || user.username);
    db.prepare(
      'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.userId, user.username, 'CONFIG_CHANGE', 'CONFIG', key,
      JSON.stringify({ configKey: key, oldValue, newValue: value }));
  });
  tx();

  // 站內通知具 config:view 之 ADMIN / CC_SUPERVISOR
  const seen = new Set();
  const notified = [];
  for (const role of ['ADMIN', 'CC_SUPERVISOR']) {
    for (const u of usersByRole(db, role)) {
      if (seen.has(u.userId)) continue;
      seen.add(u.userId);
      notifyUser(db, {
        userId: u.userId,
        notifType: 'SYSTEM',
        title: `系統參數已更新：${def.labelZh}`,
        body: `新值：${plainOf(key, value)}`,
        refType: 'CONFIG',
        refId: key,
        email: false,
      });
      notified.push(u.userId);
    }
  }

  const updated = db.prepare(
    'SELECT config_value AS v, updated_at AS at FROM sys_config WHERE config_key = ?'
  ).get(key);
  return {
    key,
    labelZh: def.labelZh,
    value: getConfig(db, key),
    updatedAt: dbToIso8(updated.at),
    notified,
  };
}

module.exports = { listConfigs, getOne, listAudit, updateConfig, CATALOG };
