/**
 * 後台 QR Code 管理路由（規格書 FR-009-03）：
 * GET  /api/v1/qr/overview           總覽（每屋苑一列）          — qr:view
 * POST /api/v1/qr/generate           生成/重新生成 QR            — qr:generate
 * PUT  /api/v1/qr/site-url           設定表單網站主機            — qr:generate
 * POST /api/v1/qr/:qrId/status       停用/啟用                  — qr:generate
 * PUT  /api/v1/qr/:qrId/valid-until  設定有效日期（空值=永不）    — qr:generate
 * GET  /api/v1/qr/:qrId/image        即時輸出 PNG/SVG 圖像       — qr:view
 * 所有變更動作寫入 audit_log（FR-010-05）。
 */
'use strict';
const express = require('express');
const { ERR } = require('../config/constants');
const { messageFor, pickLang } = require('../config/i18n');
const { ApiError, ok } = require('../middlewares/error');
const { requireAuth, requirePerm } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const qrService = require('../services/qrService');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

/** 目前請求所見的主機前綴（未設定 site_base_url 時的退回值） */
function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function audit(db, user, action, targetId, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(user.userId, user.username, action, 'QR', targetId, JSON.stringify(detail), user.ip || null);
}

router.get('/overview', requirePerm('qr:view'), (req, res) => {
  const db = getDb();
  qrService.applyExpiry(db); // 已逾有效日期者自動停用（懶執行，確保總覽狀態即時正確）
  const data = qrService.overview(db);
  ok(res, { siteBaseUrl: data.siteBaseUrl, effectiveBaseUrl: qrService.resolveBaseUrl(db, requestOrigin(req)), items: data.items });
});

router.post('/generate', requirePerm('qr:generate'), (req, res) => {
  const db = getDb();
  const estateCode = (req.body && req.body.estateCode) || '';
  const lang = pickLang(req.headers['accept-language']);
  if (!estateCode) {
    throw new ApiError(ERR.VALIDATION, messageFor(ERR.VALIDATION, lang), 400);
  }
  const base = qrService.resolveBaseUrl(db, requestOrigin(req));
  const validUntil = req.body && req.body.validUntil !== undefined ? req.body.validUntil : null;
  const qr = qrService.generate(db, { estateCode, base, validUntil }, req.user.userId);
  audit(db, req.user, 'QR_GENERATE', String(qr.qrId), { estateCode, qrContent: qr.qrContent, validUntil: qr.validUntil });
  logger.info('qr', `QR_GENERATE ${qr.qrId} ${qr.estateCode} until=${qr.validUntil || '(never)'} by ${req.user.username}`);
  ok(res, { qrId: qr.qrId, estateCode: qr.estateCode, qrContent: qr.qrContent, active: Boolean(qr.active), generatedAt: qr.generatedAt, validUntil: qr.validUntil }, 201);
});

router.put('/site-url', requirePerm('qr:generate'), (req, res) => {
  const db = getDb();
  const clean = qrService.saveSiteBaseUrl(db, req.body && req.body.siteBaseUrl);
  audit(db, req.user, 'QR_CONFIG', null, { siteBaseUrl: clean });
  logger.info('qr', `QR_CONFIG site-base-url=${clean || '(auto)'} by ${req.user.username}`);
  ok(res, { siteBaseUrl: clean });
});

router.post('/:qrId/status', requirePerm('qr:generate'), (req, res) => {
  const db = getDb();
  const wantActive = Boolean(req.body && req.body.active);
  const qr = qrService.setActive(db, req.params.qrId, wantActive);
  audit(db, req.user, wantActive ? 'QR_REACTIVATE' : 'QR_DEACTIVATE', String(qr.qrId), { estateCode: qr.estateCode });
  logger.info('qr', `${wantActive ? 'QR_REACTIVATE' : 'QR_DEACTIVATE'} ${qr.qrId} ${qr.estateCode} by ${req.user.username}`);
  ok(res, { qrId: qr.qrId, estateCode: qr.estateCode, active: Boolean(qr.active), generatedAt: qr.generatedAt, invalidatedAt: qr.invalidatedAt });
});

router.put('/:qrId/valid-until', requirePerm('qr:generate'), (req, res) => {
  const db = getDb();
  const raw = req.body && req.body.validUntil !== undefined ? req.body.validUntil : '';
  const qr = qrService.setValidUntil(db, req.params.qrId, raw);
  const deactivated = qrService.applyExpiry(db); // 若設定之日期已過，立即停用
  audit(db, req.user, 'QR_VALID_UNTIL', String(qr.qrId), { estateCode: qr.estateCode, validUntil: qr.validUntil });
  logger.info('qr', `QR_VALID_UNTIL ${qr.qrId} ${qr.estateCode} until=${qr.validUntil || '(never)'} by ${req.user.username}`);
  ok(res, {
    qrId: qr.qrId,
    estateCode: qr.estateCode,
    active: Boolean(qr.active),
    generatedAt: qr.generatedAt,
    validUntil: qr.validUntil,
    invalidatedAt: qr.invalidatedAt,
    autoDeactivated: deactivated,
  });
});

router.get('/:qrId/image', requirePerm('qr:view'), async (req, res, next) => {
  const db = getDb();
  try {
    const qr = qrService.assertQr(db, req.params.qrId);
    const format = String(req.query.format || 'png').toLowerCase() === 'svg' ? 'svg' : 'png';
    const size = Number(req.query.size) || 1024;
    const body = await qrService.renderQr(qr.qrContent, format, size);
    res.set('Cache-Control', 'private, max-age=3600');
    if (format === 'svg') {
      res.set('Content-Type', 'image/svg+xml; charset=utf-8');
      return res.send(body);
    }
    res.set('Content-Type', 'image/png');
    return res.send(body);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
