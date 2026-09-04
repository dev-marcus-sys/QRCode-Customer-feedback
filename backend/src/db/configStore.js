/**
 * sys_config 讀取：config_value 存 JSON 字串。
 */
'use strict';

/** 讀取單一配置；鍵不存在回傳 defaultVal */
function getConfig(db, key, defaultVal) {
  const row = db.prepare('SELECT config_value FROM sys_config WHERE config_key = ?').get(key);
  if (!row) return defaultVal;
  try {
    return JSON.parse(row.config_value);
  } catch {
    return row.config_value;
  }
}

module.exports = { getConfig };
