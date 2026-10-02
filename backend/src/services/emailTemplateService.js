'use strict';
/**
 * 郵件範本服務（F-007 輔助；「Email 內容可編輯」需求）。
 * - 內建寫死字串作為 fallback（與原 surveyService 行為一致，未設定範本時無回歸）。
 * - 若 sys_config 有對應 key（email.template.<tpl>.<lang>，value = {subject, body} JSON），
 *   則優先套用，讓管理頁可維護未來郵件內容。
 * - 支援佔位符：{{case_id}} {{estate_name}} {{survey_link}} {{expires}}。
 */
const { getConfig } = require('../db/configStore');
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');

const MAX_BODY_LEN = 64 * 1024; // 64KB

/** 輕量 XSS 清理：移除 <script> 區塊與 on* 事件屬性（管理頁預覽與郵件皆受益） */
function sanitizeHtml(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
}

const TEMPLATE_KEYS = {
  satisfaction_survey: {
    zh: 'email.template.satisfaction_survey.zh',
    en: 'email.template.satisfaction_survey.en',
  },
  satisfaction_survey_reminder: {
    zh: 'email.template.satisfaction_survey_reminder.zh',
    en: 'email.template.satisfaction_survey_reminder.en',
  },
};

const BUILT_IN = {
  satisfaction_survey: {
    zh: {
      subject: '[{{estate_name}}] 客戶意見處理滿意度調查 — 個案 {{case_id}}',
      body:
        '感謝您提交客戶意見。\n個案編號：{{case_id}}\n請於 {{expires}} 前填寫匿名滿意度問卷：\n{{survey_link}}\n\n問卷為匿名統計，僅用於改善服務。',
    },
    en: {
      subject: '[{{estate_name}}] Feedback Survey - Case {{case_id}}',
      body:
        'Thank you for your feedback.\nCase No.: {{case_id}}\nPlease complete our anonymous satisfaction survey before {{expires}}:\n{{survey_link}}\n\nAll replies are anonymous and used for service improvement only.',
    },
  },
  satisfaction_survey_reminder: {
    zh: {
      subject: '[{{estate_name}}] 客戶意見處理滿意度調查（提醒）— 個案 {{case_id}}',
      body:
        '提醒：個案 {{case_id}} 的匿名滿意度問卷尚未填寫。\n請於 {{expires}} 前完成：\n{{survey_link}}\n\n問卷為匿名統計。',
    },
    en: {
      subject: '[{{estate_name}}] Reminder: Feedback Survey - Case {{case_id}}',
      body:
        'This is a reminder for case {{case_id}}.\nPlease complete the survey before {{expires}}:\n{{survey_link}}\n\nReplies are anonymous.',
    },
  },
};

/** 語系正規化：en* → 'en'，其餘 → 'zh' */
function normalizeLang(lang) {
  return /^en/i.test(lang || '') ? 'en' : 'zh';
}

/** 內建寫死範本（fallback） */
function getBuiltInTemplate(key, lang) {
  const l = normalizeLang(lang);
  return BUILT_IN[key] ? BUILT_IN[key][l] : { subject: '', body: '' };
}

/** 有效範本（config 優先，否則內建）；不做變數替換，供管理頁編輯顯示 */
function getEffectiveTemplate(db, key, lang) {
  const l = normalizeLang(lang);
  const cfgKey = TEMPLATE_KEYS[key] && TEMPLATE_KEYS[key][l];
  if (!cfgKey) return getBuiltInTemplate(key, l);
  const cfg = getConfig(db, cfgKey, null);
  if (cfg && typeof cfg.subject === 'string' && typeof cfg.body === 'string') {
    return { subject: cfg.subject, body: cfg.body };
  }
  return getBuiltInTemplate(key, l);
}

/** 佔位符替換：{{ name }} → vars[name]；未知變數保留原樣 */
function replaceVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars || {}, name) ? String(vars[name]) : `{{${name}}}`
  );
}

/** 渲染範本：套用 config/內建 並替換變數，回傳最終 {subject, body} */
function renderEmailTemplate(db, key, lang, vars) {
  const tpl = getEffectiveTemplate(db, key, lang);
  return {
    subject: replaceVars(tpl.subject, vars),
    body: replaceVars(tpl.body, vars),
  };
}

/**
 * 編輯單封郵件內容（發送管理頁「編輯」按鈕）。
 * 規則：郵件須存在；已 SENT 不可改；subject/body 皆必填字串；body ≤ 64KB；
 * 寫入前以 sanitizeHtml 清理 script/on*。回傳儲存後的 {outboxId, subject, body}。
 */
function updateOutboxContent(db, id, { subject, body } = {}) {
  const row = db.prepare('SELECT outbox_id, status FROM email_outbox WHERE outbox_id = ?').get(Number(id));
  if (!row) throw new ApiError(ERR.VALIDATION, '郵件不存在', 404);
  if (row.status === 'SENT') throw new ApiError(ERR.VALIDATION, '已寄出的郵件不可編輯內容');
  if (typeof subject !== 'string' || typeof body !== 'string') {
    throw new ApiError(ERR.VALIDATION, 'subject 與 body 皆為必填字串');
  }
  if (body.length > MAX_BODY_LEN) throw new ApiError(ERR.VALIDATION, '內文過長（上限 64KB）');
  const safeSubject = sanitizeHtml(subject);
  const safeBody = sanitizeHtml(body);
  db.prepare('UPDATE email_outbox SET subject = ?, body = ? WHERE outbox_id = ?').run(safeSubject, safeBody, Number(id));
  return { outboxId: Number(id), subject: safeSubject, body: safeBody };
}

module.exports = {
  TEMPLATE_KEYS,
  MAX_BODY_LEN,
  sanitizeHtml,
  getBuiltInTemplate,
  getEffectiveTemplate,
  renderEmailTemplate,
  updateOutboxContent,
};
