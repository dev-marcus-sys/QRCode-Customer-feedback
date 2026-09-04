/**
 * 時間工具。
 * - 資料庫一律存 UTC 字串 'YYYY-MM-DD HH:mm:ss'
 * - 對外輸出一律 'YYYY-MM-DDTHH:mm:ss+08:00'（香港 UTC+8）
 */
'use strict';

const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Date → DB UTC 字串 'YYYY-MM-DD HH:mm:ss' */
function toDb(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** 現在（UTC Date） */
function now() {
  return new Date();
}

/** 解析 DB UTC 字串 → Date（如無效回傳 null） */
function parseDb(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → 對外 ISO +08:00 */
function toIso8(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const hk = new Date(d.getTime() + HK_OFFSET_MS);
  return `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}-${pad(hk.getUTCDate())}T${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}:${pad(hk.getUTCSeconds())}+08:00`;
}

/** DB UTC 字串 → 對外 ISO +08:00（無值回傳 null） */
function dbToIso8(s) {
  const d = parseDb(s);
  return d ? toIso8(d) : null;
}

/** 香港時區之 YYMMDD 鍵（編號用） */
function hkYymmdd(d) {
  const hk = new Date(d.getTime() + HK_OFFSET_MS);
  return `${pad(hk.getUTCFullYear() % 100)}${pad(hk.getUTCMonth() + 1)}${pad(hk.getUTCDate())}`;
}

/** 香港時區當日 'YYYY-MM-DD'（日期欄位預設/比較用） */
function hkToday() {
  const hk = new Date(Date.now() + HK_OFFSET_MS);
  return `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}-${pad(hk.getUTCDate())}`;
}

/** 'YYYY-MM-DD'（本地輸入之日期，視為香港日期）→ UTC 起訖 DB 字串 */
function dateRangeUtc(dateStr, endOfDay) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  // 以香港當日 00:00 = UTC 前一日 16:00 計算
  const hkStart = Date.UTC(y, m - 1, d, 0, 0, 0) - HK_OFFSET_MS;
  if (endOfDay) return toDb(new Date(hkStart + 24 * 60 * 60 * 1000 - 1));
  return toDb(new Date(hkStart));
}

/** 未來日期檢查：dateStr('YYYY-MM-DD') 是否晚於香港當日 */
function isFutureDate(dateStr) {
  if (!dateStr) return false;
  return dateStr > hkToday();
}

module.exports = { toDb, now, parseDb, toIso8, dbToIso8, hkYymmdd, hkToday, dateRangeUtc, isFutureDate };
