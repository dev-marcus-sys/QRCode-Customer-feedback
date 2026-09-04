/**
 * QR Code 管理服務層（規格書 FR-009-03 / 9.3.6）。
 * - 每屋苑同時僅一張啟用碼（生成/啟用時自動停用同苑其他碼）。
 * - QR 內容為表單 URL + estate 參數，網址主機取自 form.site_base_url（未設定時由路由層退回目前訪問主機）。
 * - 圖像不落盤，由 GET /api/v1/qr/:qrId/image 即時產生（見 routes/qr.js）。
 */
'use strict';
const QRCode = require('qrcode');
const { ERR } = require('../config/constants');
const { ApiError } = require('../middlewares/error');
const { getConfig } = require('../db/configStore');

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

function getEstate(db, code) {
  return db.prepare(
    'SELECT estate_code AS estateCode, estate_name_zh AS estateNameZh, is_active AS isActive FROM sys_estate WHERE estate_code = ?'
  ).get(String(code || '').toUpperCase());
}

function getQr(db, qrId) {
  return db.prepare(
    `SELECT qr_id AS qrId, estate_code AS estateCode, qr_type AS qrType, qr_content AS qrContent,
            is_active AS active, generated_by AS generatedBy, generated_at AS generatedAt, invalidated_at AS invalidatedAt
       FROM qr_code WHERE qr_id = ?`
  ).get(Number(qrId));
}

function assertQr(db, qrId) {
  const qr = getQr(db, qrId);
  if (!qr) throw new ApiError(ERR.QR_NOT_FOUND, null, 404);
  return qr;
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
            q.invalidated_at AS invalidatedAt
       FROM sys_estate e
       LEFT JOIN qr_code q ON q.qr_id = (
         SELECT q2.qr_id FROM qr_code q2
          WHERE q2.estate_code = e.estate_code
          ORDER BY q2.generated_at DESC, q2.qr_id DESC
          LIMIT 1
       )
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
    })),
  };
}

/**
 * 生成新 QR：
 * 1. 停用同苑所有啟用碼（記錄停用時間）；
 * 2. 插入新碼（內容 = base + estate 參數）；
 * 3. 回傳新記錄。全程單一事務。
 */
function generate(db, { estateCode, base }, userId) {
  const code = String(estateCode || '').toUpperCase();
  if (!getEstate(db, code)) {
    throw new ApiError(ERR.ESTATE_NOT_FOUND, null, 404);
  }
  const content = composeQrContent(base, code);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE qr_code
          SET is_active = 0, invalidated_at = COALESCE(invalidated_at, datetime('now'))
        WHERE estate_code = ? AND is_active = 1`
    ).run(code);
    const info = db.prepare(
      "INSERT INTO qr_code (estate_code, qr_type, qr_content, file_url, generated_by) VALUES (?, 'FORM', ?, '', ?)"
    ).run(code, content, userId);
    return getQr(db, Number(info.lastInsertRowid));
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
  getQr,
  assertQr,
  saveSiteBaseUrl,
  sanitizeSiteBaseUrl,
  resolveBaseUrl,
  composeQrContent,
  renderQr,
};
