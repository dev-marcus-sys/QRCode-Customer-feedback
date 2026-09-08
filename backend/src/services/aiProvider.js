/**
 * M0 AI 供應商抽象層（AI-01 內容自動分類／緊急度評估；docs/AI_利用方案.md §4.1/§5/§6）。
 * - 'rules'：內建規則基線，零外部依賴、與 sla.js 判定一致（先導／離線適用）；
 * - 'openai' / 'ollama'：OpenAI-compatible Chat Completions 與 Ollama 本地 API（需環境變數 AI_BASE_URL / AI_API_KEY / AI_MODEL）。
 * - de-PII：送往遠端前一律先 mask（email／香港電話／身份證），見 §5 雲端去 PII 路線。
 * 統一輸出：{ category, intent, urgency, eventType, confidence, reason, model, changed }
 */
'use strict';
const { normalizeContent } = require('../utils/hash');
const { computeEvent, guessIntent } = require('./sla');

const CATEGORY_ORDER = ['SECURITY', 'MAINTENANCE', 'CLEANLINESS', 'NUISANCE', 'MO_SERVICE', 'OTHER'];
const URGENTABLE = ['SECURITY', 'MAINTENANCE', 'CLEANLINESS', 'NUISANCE'];
const INTENT_ORDER = ['COMPLAINT', 'FEEDBACK', 'INQUIRY', 'COMPLIMENT'];
const EVENT_ORDER = ['URGENT', 'NORMAL', 'COMPLEX', 'INSTANT', 'N/A'];

const CATEGORY_LABEL_ZH = {
  MO_SERVICE: '管理處人員服務',
  SECURITY: '保安人員服務',
  MAINTENANCE: '維修事宜',
  CLEANLINESS: '衞生事宜',
  NUISANCE: '滋擾事宜',
  OTHER: '其他',
};

/** v0 規則基線類別關鍵字（繁中/簡中/英文；版本化後可遷往 sys_config） */
const CATEGORY_KEYWORDS = {
  SECURITY: ['保安', '小偷', '賊', '爆竊', '鎖', '警鐘', '陌生人', '可疑', '閉路', '監控', 'security', 'intruder', 'burglar', 'break in'],
  MAINTENANCE: ['漏水', '滲水', '水龍頭', '電梯', '𨋢', '維修', '天花', '爆喉', '爆渠', '裂', '剝落', '保養', '跳掣', '電制', '電力', 'maintenance', 'lift', 'leak', 'crack'],
  CLEANLINESS: ['垃圾', '污糟', '清潔', '鼠', '曱甴', '蟑螂', '蟲', '蒼蠅', '臭味', '衞生', '衛生', 'rubbish', 'clean', 'smell', 'rat', 'cockroach'],
  NUISANCE: ['噪音', '滋擾', '油煙', '氣味', '狗吠', '通宵', '大聲', 'nuisance', 'noise', 'barking'],
  MO_SERVICE: ['態度', '管理處', '前台', '職員', '回覆', '客服', '跟進', '不禮貌', '拖延', 'rude', 'attitude', 'reception', 'staff'],
};

/**
 * 判斷事件類型（建議對應；與 sla.computeEvent 之優先次序一致）。
 * 用於遠端模型輸出（其 urgency 欄位直接參與判定）。
 */
function eventTypeOfSuggestion({ category, intent, urgency, isSecondComplaint }, mapping) {
  if (intent === 'COMPLIMENT') return 'N/A';
  if (intent === 'INQUIRY') return 'INSTANT';
  if (urgency === 'URGENT' && URGENTABLE.includes(category)) return 'URGENT';
  if (isSecondComplaint) return 'COMPLEX';
  return (mapping[category] && mapping[category].base) || 'NORMAL';
}

/** de-PII：email／香港電話／身份證遮罩（雲端路線出外前必需；本地亦套用於輸入摘要） */
function maskPii(text) {
  return String(text || '')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi, '[EMAIL]')
    .replace(/(?<![0-9])[2-9][0-9]{7}(?![0-9])/g, '[PHONE]')
    .replace(/\b[A-Z]{1,2}[0-9]{6}\([0-9A]\)\b/gi, '[ID]');
}

/** 規則基線分類（同步、零依賴）。rules/mapping 由呼叫方由 sys_config 讀取。 */
function classifyWithRules({ content, category, isSecondComplaint }, rules, mapping) {
  const text = normalizeContent(content).toLowerCase();
  const current = CATEGORY_ORDER.includes(category) ? category : 'OTHER';
  const intent = guessIntent(content, rules);

  let bestCat = null;
  let bestScore = 0;
  let hitWords = [];
  for (const code of Object.keys(CATEGORY_KEYWORDS)) {
    const hits = CATEGORY_KEYWORDS[code].filter((w) => text.includes(String(w).toLowerCase()));
    if (hits.length > bestScore) {
      bestScore = hits.length;
      bestCat = code;
      hitWords = hits;
    }
  }
  const suggested = bestCat && bestScore > 0 ? bestCat : current;
  const ev = computeEvent({ categories: [suggested], content, isSecondComplaint }, rules, mapping);
  const baseEv = computeEvent({ categories: [current], content, isSecondComplaint }, rules, mapping);
  const changed = suggested !== current || ev.eventType !== baseEv.eventType;

  const fromCat = CATEGORY_LABEL_ZH[current] || current;
  const toCat = CATEGORY_LABEL_ZH[suggested] || suggested;
  let reason;
  if (suggested !== current) {
    reason = `偵測到關鍵字「${hitWords.slice(0, 3).join('、')}」，建議由「${fromCat}」改列「${toCat}」；事件類型 ${baseEv.eventType} → ${ev.eventType}。`;
  } else if (ev.eventType !== baseEv.eventType) {
    reason = `緊急度評核：事件類型由 ${baseEv.eventType} 調整為 ${ev.eventType}（${ev.eventType === 'URGENT' ? '命中緊急關鍵字' : '符合對應類別基線'}）。`;
  } else {
    reason = '與現行規則判定一致，無需調整。';
  }

  return {
    category: suggested,
    intent,
    urgency: ev.eventType === 'URGENT' ? 'URGENT' : 'NORMAL',
    eventType: ev.eventType,
    confidence: changed ? (suggested !== current ? 0.72 : 0.85) : 0.95,
    reason,
    model: 'rules',
    changed,
  };
}

function isClassification(o) {
  return !!o
    && CATEGORY_ORDER.includes(o.category)
    && INTENT_ORDER.includes(o.intent)
    && (o.urgency === 'URGENT' || o.urgency === 'NORMAL')
    && typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1
    && typeof o.reason === 'string' && o.reason.length <= 300;
}

/** 剝離 markdown code fence 後解析模型 JSON 輸出 */
function parseJsonFence(content) {
  if (!content || typeof content !== 'string') return null;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function buildPrompt(text) {
  const labels = Object.entries(CATEGORY_LABEL_ZH)
    .map(([k, v]) => `${k}（${v}）`).join('、');
  return [
    { role: 'system', content: `你係屋苑管理客戶意見分類助理。輸入客戶意見後，請判斷：\n1. category：意見類別，由以下其一：${labels}（CATEGORY 碼為準，唔好用中文）；\n2. intent：COMPLAINT（投訴）/ FEEDBACK（意見）/ INQUIRY（查詢）/ COMPLIMENT（讚揚）；\n3. urgency：URGENT（涉安全/衞生/結構／明顯緊急）/ NORMAL；\n4. confidence：0~1 之信心值；\n5. reason：以繁體中文 40 字內扼要理由。\n只輸出一個 JSON 物件，唔好加任何其他文字。` },
    { role: 'user', content: `請分類以下客戶意見：\n${text}` },
  ];
}

/**
 * 呼叫遠端模型（OpenAI-compatible / Ollama）。
 * 連線設定來源優先序：opts（可由系統參數 ai.api.* 傳入）→ 環境變數 → provider 預設值。
 * 環境變數：AI_BASE_URL、AI_API_KEY（Ollama 可省略）、AI_MODEL。
 * @returns {Promise<{category:intent:urgency:confidence:reason:model:}>}
 */
async function classifyRemote(provider, text, opts = {}) {
  const isOllama = provider === 'ollama';
  const baseUrl = String(opts.baseUrl || process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '')
    || (isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.AI_API_KEY || '');
  if (!isOllama && !apiKey) throw new Error('AI_API_KEY 未設定');
  const model = opts.model || process.env.AI_MODEL || (isOllama ? 'qwen2.5:7b' : 'gpt-4o-mini');

  const messages = buildPrompt(text);
  const endpoint = isOllama ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
  const body = isOllama
    ? { model, messages, stream: false, format: 'json', options: { temperature: 0 } }
    : { model, messages, temperature: 0, response_format: { type: 'json_object' } };
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${provider} HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const content = isOllama
    ? data.message && data.message.content
    : data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const raw = parseJsonFence(content);
  if (!isClassification(raw)) throw new Error('模型輸出格式不符，無法解析為分類建議');
  return { ...raw, model };
}

module.exports = {
  CATEGORY_ORDER,
  EVENT_ORDER,
  INTENT_ORDER,
  URGENTABLE,
  classifyWithRules,
  classifyRemote,
  eventTypeOfSuggestion,
  maskPii,
};
