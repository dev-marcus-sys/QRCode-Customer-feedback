/**
 * 統一錯誤模型與錯誤處理中間件。
 * 信封：{ code, message, data }；錯誤碼對應規格書 8.5。
 */
'use strict';
const { ERR } = require('../config/constants');
const { messageFor, pickLang } = require('../config/i18n');
const logger = require('../utils/logger');

class ApiError extends Error {
  constructor(code, message, httpStatus, data) {
    super(message || String(code));
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus || httpForCode(code);
    this.data = data;
  }
}

function httpForCode(code) {
  const map = {
    [ERR.OK]: 200,
    [ERR.DUPLICATE]: 200,
    [ERR.VALIDATION]: 400,
    [ERR.FORM_TOKEN]: 400,
    [ERR.ESTATE_NOT_FOUND]: 404,
    [ERR.QR_NOT_FOUND]: 404,
    [ERR.UNAUTH]: 401,
    [ERR.BAD_CREDENTIALS]: 401,
    [ERR.ACCOUNT_LOCKED]: 403,
    [ERR.ACCOUNT_DISABLED]: 403,
    [ERR.PERMISSION]: 403,
    [ERR.MUST_CHANGE_PWD]: 401,
    [ERR.CASE_NOT_FOUND]: 404,
    [ERR.STATE_TRANSITION]: 409,
    [ERR.DATA_SCOPE]: 403,
    [ERR.SURVEY_NOT_FOUND]: 404,
    [ERR.SURVEY_EXPIRED]: 410,
    [ERR.SURVEY_ALREADY]: 409,
    [ERR.ATTACH_INVALID]: 400,
    [ERR.INTERNAL]: 500,
    [ERR.RATE_LIMIT]: 429,
  };
  return map[code] || 500;
}

/** 成功信封 */
function ok(res, data, http = 200) {
  res.status(http).json({ code: 0, message: 'success', data });
}

function errorHandler(err, req, res, next) {
  const lang = pickLang(req.headers['accept-language']);
  if (err instanceof ApiError) {
    const message = err.message || messageFor(err.code, lang);
    return res.status(err.httpStatus).json({ code: err.code, message, data: err.data || null });
  }
  logger.error('http', `unhandled: ${err && err.stack ? err.stack : err}`);
  return res.status(500).json({ code: ERR.INTERNAL, message: messageFor(ERR.INTERNAL, lang), data: null });
}

function notFound(req, res) {
  const lang = pickLang(req.headers['accept-language']);
  res.status(404).json({ code: 404, message: lang === 'en' ? 'Not found' : '找不到資源', data: null });
}

module.exports = { ApiError, ok, errorHandler, notFound, httpForCode };
