/**
 * QR Code 管理服務層（規格書 FR-009-03 / 9.3.6）。
 * - 每屋苑同時僅一張啟用碼（生成/啟用時自動停用同苑其他碼）。
 * - QR 內容為表單 URL + estate 參數，網址主機取自 form.site_base_url（未設定時由路由層退回目前訪問主機）。
 * - 圖像不落盤，由 GET /api/v1/qr/:qrId/image 即時產生（見 routes/qr.js）。
 */
'use strict';
const crypto = require('crypto');
const QRCode = require('qrcode');
const { ERR } = require('../config/constants');
const { ApiError } = require('../middlewares/error');
const { getConfig } = require('../db/configStore');
const { toDb, parseDb, dateRangeUtc } = require('../utils/time');

/** sys_config 鍵：表單網站主機（空字串 = 自動採用目前訪問主機） */
const SITE_BASE_URL_KEY = 'form.site_base_url';

function getSiteBaseUrl(db) {
  const v = getConfig(db, SITE_BASE_URL_KEY, '');
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 校驗並正規化 site_base_url：
 * - 空字串合法（表示清除設定，退回自動偵測）；
 * - 非空必須為 http/https 且含主機名；去除尾斜線與空白。
 * 非法輸入拋 VALIDATION。
 */
function sanitizeSiteBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) {
    throw new ApiError(ERR.VALIDATION, '網址須以 http:// 或 https:// 開頭', 400, { field: 'siteBaseUrl' });
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(ERR.VALIDATION, '網址格式不正確', 400, { field: 'siteBaseUrl' });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new ApiError(ERR.VALIDATION, '網址格式不正確', 400, { field: 'siteBaseUrl' });
  }
  // 只保留主機部分（協定 + host[:port]），忽略其後路徑
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${url.hostname}${port}`;
}

/** 決定 QR 內容所用的主機前綴：已設定值優先，否則退回 protocol://host */
function resolveBaseUrl(db, protocolHost) {
  const configured = getSiteBaseUrl(db);
  if (configured) return configured;
  if (!protocolHost || !/^https?:\/\//i.test(protocolHost)) {
    throw new ApiError(ERR.INTERNAL, '無法決定表單網址主機', 500);
  }
  return protocolHost.replace(/\/+$/, '');
}

/** 組成 QR 內容：表單 URL + estate 參數（不帶語言，表單自動依瀏覽器語言顯示） */
function composeQrContent(base, estateCode) {
  return `${String(base).replace(/\/+$/, '')}/?estate=${encodeURIComponent(estateCode)}`;
}

/**
 * 產生短亂數連結令牌（16 hex = 64-bit，不可猜測）。用於 QR 連結 ?t=<token>，
 * 取代明文 qr_id / 簽章，讓連結更短、更易掃描，且無法被偽造或枚舉。
 */
function genLinkToken() {
  return crypto.randomBytes(8).toString('hex');
}

/** 組成 QR 內容：表單 URL + estate + 短亂數 t（不帶語言，表單自動依瀏覽器語言顯示） */
function composeLink(base, estate, token) {
  return `${String(base).replace(/\/+$/, '')}/?estate=${encodeURIComponent(estate)}&t=${encodeURIComponent(token)}`;
}

/** 依 link_token 查詢 QR（連結驗證用） */
function getQrByToken(db, token) {
  return db.prepare(
    `SELECT qr_id AS qrId, estate_code AS estateCode, qr_content AS qrContent,
            is_active AS active, generated_by AS generatedBy, generated_at AS generatedAt,
            invalidated_at AS invalidatedAt, valid_until AS validUntil
       FROM qr_code WHERE link_token = ?`
  ).get(String(token || ''));
}

function getEstate(db, code) {
  return db.prepare(
    'SELECT estate_code AS estateCode, estate_name_zh AS estateNameZh, is_active AS isActive FROM sys_estate WHERE estate_code = ?'
  ).get(String(code || '').toUpperCase());
}

/**
 * 正規化「有效日期」輸入：
 * - 空值（null / ''）→ null，代表永不自動停用（預設行為）；
 * - 'YYYY-MM-DD' 視為香港日期，存為該日 23:59:59（UTC）；
 * - 其他可解析之時間字串 → 轉為 DB 格式。無法解析拋 VALIDATION。
 */
function normalizeValidUntil(value) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === null || raw === undefined || raw === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return dateRangeUtc(raw, true);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(ERR.VALIDATION, '有效日期格式不正確（須為 YYYY-MM-DD）', 400, { field: 'validUntil' });
  }
  return toDb(d);
}

/** 是否已逾有效日期（validUntil 為 null 代表永不自動停用） */
function isExpired(validUntil) {
  const d = parseDb(validUntil);
  if (!d) return false;
  return Date.now() > d.getTime();
}

function getQr(db, qrId) {
  return db.prepare(
    `SELECT qr_id AS qrId, estate_code AS estateCode, qr_type AS qrType, qr_content AS qrContent,
            is_active AS active, generated_by AS generatedBy, generated_at AS generatedAt,
            invalidated_at AS invalidatedAt, valid_until AS validUntil
       FROM qr_code WHERE qr_id = ?`
  ).get(Number(qrId));
}

function assertQr(db, qrId) {
  const qr = getQr(db, qrId);
  if (!qr) throw new ApiError(ERR.QR_NOT_FOUND, null, 404);
  return qr;
}

/**
 * 取得屋苑目前「可用」的 QR（啟用中且未逾有效日期）；無則回 null。
 * 有效日期以查詢當下判斷（valid_until IS NULL = 永不自動停用），
 * 供公眾表單入口即時阻擋已停用／已過期之 QR 連結。
 */
function getUsableQr(db, estateCode) {
  const row = db.prepare(
    `SELECT qr_id AS qrId, qr_content AS qrContent, valid_until AS validUntil
       FROM qr_code
      WHERE estate_code = ?
        AND is_active = 1
        AND (valid_until IS NULL OR valid_until >= datetime('now'))
      ORDER BY generated_at DESC, qr_id DESC
      LIMIT 1`
  ).get(String(estateCode || '').toUpperCase());
  return row || null;
}

/** 總覽：每個屋苑一列，附其最新一張 QR（未生成時 qrId 為 null） */
function overview(db) {
  const siteBaseUrl = getSiteBaseUrl(db);
  const rows = db.prepare(
    `SELECT e.estate_code AS estateCode,
            e.estate_name_zh AS estateNameZh,
            e.estate_name_en AS estateNameEn,
            q.qr_id AS qrId,
            q.qr_content AS qrContent,
            q.is_active AS active,
            q.generated_at AS generatedAt,
            q.invalidated_at AS invalidatedAt,
            q.valid_until AS validUntil
       FROM sys_estate e
       LEFT JOIN qr_code q ON q.qr_id = (
         SELECT q2.qr_id FROM qr_code q2
          WHERE q2.estate_code = e.estate_code
          ORDER BY q2.generated_at DESC, q2.qr_id DESC
          LIMIT 1
       )
      WHERE e.is_active = 1
      ORDER BY e.estate_code`
  ).all();
  return {
    siteBaseUrl,
    items: rows.map((r) => ({
      estateCode: r.estateCode,
      estateNameZh: r.estateNameZh,
      estateNameEn: r.estateNameEn,
      qrId: r.qrId || null,
      qrContent: r.qrContent || null,
      active: r.qrId ? Boolean(r.active) : null,
      generatedAt: r.generatedAt || null,
      invalidatedAt: r.invalidatedAt || null,
      validUntil: r.validUntil || null,
      expired: isExpired(r.validUntil),
    })),
  };
}

/**
 * 生成新 QR：
 * 1. 停用同苑所有啟用碼（記錄停用時間）；
 * 2. 插入新碼（內容 = base + estate 參數）；
 * 3. 回傳新記錄。全程單一事務。
 */
function generate(db, { estateCode, base, validUntil }, userId) {
  const code = String(estateCode || '').toUpperCase();
  const estate = getEstate(db, code);
  if (!estate || !estate.isActive) {
    throw new ApiError(ERR.ESTATE_NOT_FOUND, null, 404);
  }
  const until = normalizeValidUntil(validUntil === undefined ? null : validUntil);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE qr_code
          SET is_active = 0, invalidated_at = COALESCE(invalidated_at, datetime('now'))
        WHERE estate_code = ? AND is_active = 1`
    ).run(code);
    const info = db.prepare(
      "INSERT INTO qr_code (estate_code, qr_type, qr_content, file_url, generated_by, valid_until) VALUES (?, 'FORM', '', '', ?, ?)"
    ).run(code, userId, until);
    const qrId = Number(info.lastInsertRowid);
    // 產生唯一短亂數 link_token，寫入連結內容與欄位
    let token = genLinkToken();
    while (getQrByToken(db, token)) token = genLinkToken();
    const content = composeLink(base, code, token);
    db.prepare('UPDATE qr_code SET qr_content = ?, link_token = ? WHERE qr_id = ?').run(content, token, qrId);
    return getQr(db, qrId);
  });
  return tx();
}

/**
 * 停用 / 啟用指定 QR。
 * - 啟用：先停用同屋苑其他啟用碼（維持每苑單一啟用），再啟用此碼並清空停用時間；
 * - 停用：僅停用此碼並寫入停用時間。
 */
function setActive(db, qrId, active) {
  const qr = assertQr(db, qrId);
  const wantActive = Boolean(active);
  if (qr.active === wantActive) return qr;
  const tx = db.transaction(() => {
    if (wantActive) {
      db.prepare(
        `UPDATE qr_code
            SET is_active = 0, invalidated_at = COALESCE(invalidated_at, datetime('now'))
          WHERE estate_code = ? AND qr_id <> ? AND is_active = 1`
      ).run(qr.estateCode, qr.qrId);
      db.prepare('UPDATE qr_code SET is_active = 1, invalidated_at = NULL WHERE qr_id = ?').run(qr.qrId);
    } else {
      db.prepare("UPDATE qr_code SET is_active = 0, invalidated_at = datetime('now') WHERE qr_id = ?").run(qr.qrId);
    }
    return getQr(db, qr.qrId);
  });
  return tx();
}

/**
 * 設定有效日期（null / '' = 永不自動停用，為預設值）。
 * 若設定之日期已過，該 QR 即視為已過期（實際停用作業由 applyExpiry 執行）。
 * 若設為永遠有效（null）且該 QR 因到期而被自動停用，則一併重新啟用。
 */
function setValidUntil(db, qrId, value) {
  const qr = assertQr(db, qrId);
  const until = normalizeValidUntil(value);
  const tx = db.transaction(() => {
    db.prepare('UPDATE qr_code SET valid_until = ? WHERE qr_id = ?').run(until, qr.qrId);
    // 清空有效日期（永遠有效）時，若 QR 處於停用狀態則一併啟用
    if (until === null && !qr.active) {
      db.prepare('UPDATE qr_code SET is_active = 1, invalidated_at = NULL WHERE qr_id = ?').run(qr.qrId);
    }
    return getQr(db, qr.qrId);
  });
  return tx();
}

/**
 * 自動到期：將已逾有效日期且仍啟用之 QR 停用並寫入停用時間。
 * 回傳自動停用筆數。供排程定時呼叫，並於總覽查詢前懶執行一次。
 */
function applyExpiry(db) {
  const info = db.prepare(
    `UPDATE qr_code
        SET is_active = 0, invalidated_at = COALESCE(invalidated_at, datetime('now'))
      WHERE is_active = 1
        AND valid_until IS NOT NULL
        AND valid_until < datetime('now')`
  ).run();
  return info.changes || 0;
}

/** 儲存表單網站主機設定（空字串 = 清除，退回自動偵測） */
function saveSiteBaseUrl(db, value) {
  const clean = sanitizeSiteBaseUrl(value);
  db.prepare(
    `INSERT INTO sys_config (config_key, config_value, config_type, updated_by, updated_at)
     VALUES (?, ?, 'FORM_STYLE', ?, datetime('now'))
     ON CONFLICT(config_key) DO UPDATE SET
       config_value = excluded.config_value,
       config_type = excluded.config_type,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).run(SITE_BASE_URL_KEY, JSON.stringify(clean), null);
  return clean;
}

/** 產生 QR 圖像內容（不落盤）。format: png | svg；size 僅對 png 生效。 */
async function renderQr(qrContent, format, size) {
  const isSvg = format === 'svg';
  const width = Math.min(Math.max(Math.round(size) || 1024, 128), 2048);
  const opts = { errorCorrectionLevel: 'M', margin: 2 };
  if (isSvg) return QRCode.toString(qrContent, { ...opts, type: 'svg' });
  return QRCode.toBuffer(qrContent, { ...opts, type: 'png', width });
}

module.exports = {
  SITE_BASE_URL_KEY,
  overview,
  generate,
  setActive,
  setValidUntil,
  applyExpiry,
  normalizeValidUntil,
  isExpired,
  getQr,
  assertQr,
  getUsableQr,
  saveSiteBaseUrl,
  sanitizeSiteBaseUrl,
  resolveBaseUrl,
  composeQrContent,
  renderQr,
  getQrByToken,
};
