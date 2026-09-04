/**
 * 記憶體簡易固定窗口限流（stub，適用單一實例；投產應換 Redis/共用儲存）。
 */
'use strict';
const { ERR } = require('../config/constants');
const { messageFor } = require('../config/i18n');
const { ApiError } = require('../middlewares/error');

function createLimiter({ windowMs = 60 * 1000, max = 10 } = {}) {
  const buckets = new Map();
  function prune(now) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }
  return {
    /** 未超過上限回傳 true；超過則擲出 5001 */
    assert(key, lang = 'zh-Hant') {
      const now = Date.now();
      prune(now);
      const cur = buckets.get(key);
      if (!cur || cur.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      cur.count += 1;
      if (cur.count > max) {
        throw new ApiError(ERR.RATE_LIMIT, messageFor(ERR.RATE_LIMIT, lang), 429);
      }
      return true;
    },
  };
}

module.exports = { createLimiter };
