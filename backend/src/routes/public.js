/**
 * 公眾區路由：
 * GET  /api/v1/form/meta
 * POST /api/v1/form/token
 * POST /api/v1/feedback
 */
'use strict';
const express = require('express');
const { ERR } = require('../config/constants');
const { messageFor, pickLang } = require('../config/i18n');
const { ApiError, ok } = require('../middlewares/error');
const { getDb } = require('../db/connection');
const { getConfig } = require('../db/configStore');
const { createFormToken, hmacVerify } = require('../utils/hash');
const { validateFeedback } = require('../utils/validate');
const { createCaseFromFeedback } = require('../services/caseService');
const { createLimiter } = require('../utils/rateLimit');
const { jwtSecret } = require('../middlewares/auth');

const formRouter = express.Router();
const publicRouter = express.Router();
const tokenLimiter = createLimiter({ windowMs: 60 * 1000, max: 30 });
const feedbackLimiter = createLimiter({ windowMs: 60 * 1000, max: 10 });
const surveyLimiter = createLimiter({ windowMs: 60 * 1000, max: 30 });

function langOf(req) {
  // URL 顯式 lang 優先；否則依 Accept-Language 推斷
  if (req.query.lang) return pickLang(req.query.lang);
  return pickLang(req.headers['accept-language'] || '');
}

function estateOf(db, code, lang) {
  const row = db.prepare(
    'SELECT estate_code AS estate_code, estate_name_zh AS estate_name_zh, estate_name_en AS estate_name_en, company_code AS company_code, is_active AS is_active FROM sys_estate WHERE estate_code = ?'
  ).get(code);
  if (!row || !row.is_active) {
    throw new ApiError(ERR.ESTATE_NOT_FOUND, messageFor(ERR.ESTATE_NOT_FOUND, lang), 404);
  }
  return row;
}

/** 取得表單設定（8.4.1） */
formRouter.get('/meta', (req, res) => {
  const lang = langOf(req);
  const db = getDb();
  const estate = estateOf(db, req.query.estate, lang);
  const isEn = lang === 'en';
  const categoriesCfg = getConfig(db, 'form.categories', {});
  const titlesCfg = getConfig(db, 'form.titles', { zh: [], en: [] });
  const maxLength = getConfig(db, 'form.max_length', { name: 50, content: 1000, other: 50 });
  const promise = getConfig(db, 'form.promise', { zh: '', en: '' });
  const style = getConfig(db, 'form.style', { primaryColor: '#1a5aa6' });
  const fields = getConfig(db, 'form.fields', []);
  const titles = isEn ? titlesCfg.en : titlesCfg.zh;
  const categories = Object.entries(categoriesCfg).map(([code, v]) => ({
    code,
    labelZh: v.labelZh,
    labelEn: v.labelEn,
    label: isEn ? v.labelEn : v.labelZh,
  }));
  ok(res, {
    estateCode: estate.estate_code,
    estateNameZh: estate.estate_name_zh,
    estateNameEn: estate.estate_name_en,
    lang,
    fields,
    categories,
    titles,
    maxLength,
    promise: isEn ? promise.en : promise.zh,
    style,
    privacyPolicyUrl: getConfig(db, 'form.privacy_policy_url', ''),
  });
});

/** 取得一次性表單 token（8.2 防濫用） */
formRouter.post('/token', (req, res) => {
  const lang = langOf(req);
  const db = getDb();
  tokenLimiter.assert(`formToken:${req.ip}`, lang);
  const estateCode = req.body && req.body.estate;
  estateOf(db, estateCode, lang);
  const token = createFormToken({ estate: estateCode }, jwtSecret());
  ok(res, { token, expiresInSeconds: 300 });
});

/** 提交客戶意見（8.4.2 建案） */
publicRouter.post('/feedback', (req, res) => {
  const body = req.body || {};
  // 優先採提交體語言（前端語言切換會帶入 lang），其次 Accept-Language
  const lang = body.lang && (body.lang === 'zh-Hant' || body.lang === 'en') ? body.lang : langOf(req);
  const db = getDb();
  feedbackLimiter.assert(`feedback:${req.ip}`, lang);

  // formToken 驗證
  const tokenPayload = hmacVerify(body.formToken, jwtSecret());
  if (!tokenPayload || tokenPayload.estate !== body.estate) {
    throw new ApiError(ERR.FORM_TOKEN, messageFor(ERR.FORM_TOKEN, lang), 400);
  }

  const estate = estateOf(db, body.estate, lang);
  const titlesZh = getConfig(db, 'form.titles', {}).zh || [];
  const titlesEn = getConfig(db, 'form.titles', {}).en || [];
  const maxLength = getConfig(db, 'form.max_length', {});
  const errors = validateFeedback(body, { titles: [...titlesZh, ...titlesEn], maxLength });
  if (errors.length) {
    throw new ApiError(ERR.VALIDATION, messageFor(ERR.VALIDATION, lang), 400, {
      detail: errors.map((e) => ({ field: e.field, zh: e.zh, en: e.en })),
    });
  }

  const result = createCaseFromFeedback(db, body, lang);
  if (result.isDuplicate) {
    const message = messageFor(ERR.DUPLICATE, lang);
    return res.status(200).json({ code: ERR.DUPLICATE, message, data: { caseId: result.caseId, isDuplicate: true } });
  }
  return ok(res, result, 201);
});

/**
 * F-007 滿意度調查公開端點（匿名，僅持 token；不經認證）
 * GET  /api/v1/survey/:token
 * POST /api/v1/survey/:token/submit
 */
const { getPublicSurvey, submitPublicSurvey } = require('../services/surveyService');

publicRouter.get('/survey/:token', (req, res) => {
  const lang = pickLang(req.query.lang || req.headers['accept-language'] || '');
  ok(res, getPublicSurvey(getDb(), req.params.token, lang));
});

publicRouter.post('/survey/:token/submit', (req, res) => {
  const db = getDb();
  surveyLimiter.assert(`surveySubmit:${req.ip}`, 'zh-Hant');
  const result = submitPublicSurvey(db, req.params.token, req.body || {});
  ok(res, result);
});

module.exports = { formRouter, publicRouter };
