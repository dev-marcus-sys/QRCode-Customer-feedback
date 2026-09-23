/**
 * 屋苑數據範圍輔助（支援「所屬屋苑」多選）。
 * sys_user.estate_code 以逗號分隔多個屋苑代碼（例：'CHNG,CWC'）。
 * 特例：'ALL'（或空）＝ 全屋苑，代表不受限。
 */
'use strict';

/** 解析屋苑輸入（逗號字串或陣列）→ 去重陣列（'CHNG, CWC' → ['CHNG','CWC']） */
function parseEstates(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))];
}

/** 是否為「全屋苑」範圍（空 或 清單含 ALL） */
function isAllEstates(value) {
  const list = parseEstates(value);
  return list.length === 0 || list.includes('ALL');
}

/** 取得受限屋苑代碼陣列；null 表示不限（全屋苑） */
function estateScope(value) {
  return isAllEstates(value) ? null : parseEstates(value);
}

/** 判斷某屋苑代碼是否落在範圍內（範圍為 ALL/空 時一律 true） */
function inEstates(value, code) {
  if (isAllEstates(value)) return true;
  return parseEstates(value).includes(String(code || '').trim());
}

/**
 * SQL：將「單值屋苑欄位」（如 c.estate_code）收斂到範圍。
 * 回傳 { clause, params }；clause 不含前綴 AND，無範圍時為 ''。
 */
function estateInClause(column, value) {
  const codes = estateScope(value);
  if (!codes) return { clause: '', params: [] };
  return { clause: `${column} IN (${codes.map(() => '?').join(', ')})`, params: codes };
}

/**
 * SQL：判斷「多值屋苑欄位」（sys_user.estate_code 逗號清單）是否包含指定屋苑。
 * 回傳 { clause, params }；clause 例：`(',' || u.estate_code || ',') LIKE ?`。
 */
function estateListMatch(column, code) {
  return { clause: `(',' || ${column} || ',') LIKE ?`, params: [`%,${String(code || '').trim()},%`] };
}

/** 正規化屋苑輸入為 DB 儲存字串（ALL 與其他互斥）；未提供回傳 null */
function normalizeEstateValue(input) {
  if (input === undefined || input === null) return null;
  let list = parseEstates(input);
  if (!list.length) list = ['ALL'];
  if (list.includes('ALL')) list = ['ALL'];
  return list.join(',');
}

module.exports = {
  parseEstates,
  isAllEstates,
  estateScope,
  inEstates,
  estateInClause,
  estateListMatch,
  normalizeEstateValue,
};
