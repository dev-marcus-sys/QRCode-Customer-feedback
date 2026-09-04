/**
 * 錯誤訊息字典（zh-Hant / en）。配合 Accept-Language 回傳。
 */
'use strict';
const { ERR } = require('./constants');

const MESSAGES = {
  [ERR.OK]: { zh: 'success', en: 'success' },
  [ERR.DUPLICATE]: { zh: '閣下於 10 分鐘內已提交相同意見', en: 'You have submitted the same feedback within 10 minutes' },
  [ERR.VALIDATION]: { zh: '表單驗證失敗', en: 'Form validation failed' },
  [ERR.FORM_TOKEN]: { zh: '表單已過期，請重新載入後再提交', en: 'The form has expired. Please reload and try again.' },
  [ERR.ESTATE_NOT_FOUND]: { zh: '屋苑或表單設定不存在或已停用', en: 'Estate or form configuration not found or disabled' },
  [ERR.QR_NOT_FOUND]: { zh: 'QR Code 不存在', en: 'QR Code not found' },
  [ERR.UNAUTH]: { zh: '未登入或登入已過期', en: 'Not authenticated or session expired' },
  [ERR.BAD_CREDENTIALS]: { zh: '帳號或密碼錯誤', en: 'Incorrect username or password' },
  [ERR.ACCOUNT_LOCKED]: { zh: '帳戶已鎖定，請稍後再試', en: 'Account locked, please try again later' },
  [ERR.ACCOUNT_DISABLED]: { zh: '帳戶已停用', en: 'Account is disabled' },
  [ERR.PERMISSION]: { zh: '權限不足，無法執行此操作', en: 'Insufficient permission' },
  [ERR.MUST_CHANGE_PWD]: { zh: '必須先變更密碼後方能繼續', en: 'You must change your password before continuing' },
  [ERR.CASE_NOT_FOUND]: { zh: '個案不存在', en: 'Case not found' },
  [ERR.STATE_TRANSITION]: { zh: '狀態流轉不允許', en: 'Status transition not allowed' },
  [ERR.DATA_SCOPE]: { zh: '數據範圍不符，無法操作非所屬屋苑之個案', en: 'Data scope violation: cannot operate on cases outside your estate' },
  [ERR.SURVEY_NOT_FOUND]: { zh: '問卷不存在或連結無效', en: 'Survey not found or link is invalid' },
  [ERR.SURVEY_EXPIRED]: { zh: '問卷已過期，未能提交', en: 'Survey has expired' },
  [ERR.SURVEY_ALREADY]: { zh: '問卷已提交', en: 'Survey already submitted' },
  [ERR.ATTACH_INVALID]: { zh: '附件不合法（僅支援 jpg/png/pdf，單一 ≤ 10MB）', en: 'Invalid attachment (jpg/png/pdf only, max 10MB)' },
  [ERR.INTERNAL]: { zh: '伺服器內部錯誤', en: 'Internal server error' },
  [ERR.RATE_LIMIT]: { zh: '請求過於頻繁，請稍後再試', en: 'Too many requests, please try again later' },
};

const DEFAULT_MESSAGE = { zh: '未知錯誤', en: 'Unknown error' };

function pickLang(accept) {
  if (!accept) return 'zh-Hant';
  return accept.toLowerCase().includes('en') ? 'en' : 'zh-Hant';
}

/** 依錯誤碼取得訊息（回傳可讀文字）。 */
function messageFor(code, lang) {
  const m = MESSAGES[code] || DEFAULT_MESSAGE;
  return (lang === 'en' ? m.en : m.zh) || m.zh;
}

module.exports = { messageFor, pickLang };
