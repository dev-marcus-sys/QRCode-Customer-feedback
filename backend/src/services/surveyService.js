/**
 * 滿意度調查服務（F-007，規格書 5.7 / 7.3.2）。
 * - 匿名一次性 Token（公開端點不帶任何身份）
 * - 14 天有效期；到期由 SLA 排程掃描標 EXPIRED
 * - 提交後計算平均分；任一題 ≤ 2 分 → is_low_score 並通知相關主管
 * - SMTP 電郵仍為 stub（落 email_outbox）
 */
'use strict';
const crypto = require('crypto');
const { getConfig } = require('../db/configStore');
const { ERR } = require('../config/constants');
const { ApiError } = require('../middlewares/error');
const { toDb, now, parseDb, dbToIso8 } = require('../utils/time');
const { enqueueEmail, notifyUser, reviewersForCase } = require('./notificationService');
const { renderEmailTemplate } = require('./emailTemplateService');
const logger = require('../utils/logger');
const { estateInClause } = require('../utils/estateScope');

const RATING_KEYS = ['overall', 'response', 'attitude', 'resolution'];
const LOW_SCORE = 2;

function dbNow() {
  return toDb(new Date());
}

/** 表單主機：site_base_url（F-009 可設定）優先，否則以目前訪問主機構成 */
function resolveBaseUrl(db, origin) {
  const configured = String(getConfig(db, 'form.site_base_url', '') || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

function getQuestions(db, lang) {
  const all = getConfig(db, 'survey.questions', { zh: [], en: [] });
  const list = (lang === 'en' ? all.en : all.zh) || all.zh || [];
  return list.length ? list : RATING_KEYS.map((k) => ({ key: k, label: k }));
}

/** 送出問卷電郵＋落表（FR-007-01；個案經審核關閉時觸發）。回傳 survey row 或 null。 */
function createSurveyOnClose(db, caseRow, { origin = '', lang = 'zh-Hant' } = {}) {
  if (!caseRow.customer_email || !caseRow.satisfaction_consent) return null;
  const existing = db.prepare('SELECT survey_id AS id FROM satisfaction_survey WHERE case_id = ? LIMIT 1').get(caseRow.case_id);
  if (existing) return null; // 每個個案只發一次
  const expiryDays = Number(getConfig(db, 'survey.expiry_days', 14)) || 14;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const expiresDb = toDb(expiresAt);
  const atDb = dbNow();
  const base = resolveBaseUrl(db, origin);
  const token = crypto.randomBytes(24).toString('hex');
  const info = db.prepare(
    'INSERT INTO satisfaction_survey (case_id, survey_token, lang, sent_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(caseRow.case_id, token, lang, atDb, expiresDb, 'SENT');
  const estateName = lang === 'en' ? caseRow.estate_name_en : caseRow.estate_name_zh;
  const tpl = renderEmailTemplate(db, 'satisfaction_survey', lang, {
    case_id: String(caseRow.case_id),
    estate_name: estateName,
    survey_link: `${base}/survey/${token}`,
    expires: dbToIso8(expiresDb),
  });
  enqueueEmail(db, { caseId: caseRow.case_id, template: 'satisfaction_survey', recipient: caseRow.customer_email, lang, subject: tpl.subject, body: tpl.body });
  logger.info('surveyService', `SURVEY_CREATE ${caseRow.case_id} surveyId=${info.lastInsertRowid} expires=${expiresDb}`);
  return { surveyId: info.lastInsertRowid, caseId: caseRow.case_id, token, expiresAt: dbToIso8(expiresDb), status: 'SENT' };
}

function findSurveyByToken(db, token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{40,}$/.test(token)) return null;
  return db.prepare(
    `SELECT s.survey_id AS surveyId, s.case_id AS caseId, s.survey_token AS token, s.lang AS lang,
            s.status, s.expires_at AS expiresAt, s.submitted_at AS submittedAt,
            s.rating_overall AS ratingOverall, s.rating_response AS ratingResponse,
            s.rating_attitude AS ratingAttitude, s.rating_resolution AS ratingResolution,
            s.feedback AS feedback, s.is_low_score AS isLowScore,
            e.estate_code AS estateCode, e.estate_name_zh AS estateNameZh, e.estate_name_en AS estateNameEn
       FROM satisfaction_survey s
       JOIN \`case\` c ON c.case_id = s.case_id
       JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE s.survey_token = ?`
  ).get(token);
}

/** 公開端點：取得問卷（不帶客戶個資） */
function getPublicSurvey(db, token, lang = '') {
  const s = findSurveyByToken(db, token);
  if (!s) throw new ApiError(ERR.SURVEY_NOT_FOUND, null, 404);
  const effectiveLang = lang === 'en' ? 'en' : 'zh-Hant';
  return {
    caseId: s.caseId,
    estateCode: s.estateCode,
    estateNameZh: s.estateNameZh,
    estateNameEn: s.estateNameEn,
    status: s.status,
    lang: s.lang,
    questions: getQuestions(db, effectiveLang),
    expiresAt: dbToIso8(s.expiresAt),
    submittedAt: dbToIso8(s.submittedAt),
    isLowScore: !!s.isLowScore,
    ratings: s.status === 'SUBMITTED'
      ? { overall: s.ratingOverall, response: s.ratingResponse, attitude: s.ratingAttitude, resolution: s.ratingResolution }
      : null,
    feedback: s.status === 'SUBMITTED' ? s.feedback : null,
  };
}

/** 公開端點：提交問卷（FR-007-02/03/04） */
function submitPublicSurvey(db, token, body) {
  const s = findSurveyByToken(db, token);
  if (!s) throw new ApiError(ERR.SURVEY_NOT_FOUND, null, 404);
  if (s.status === 'SUBMITTED') throw new ApiError(ERR.SURVEY_ALREADY, null, 409);
  const nowDate = now();
  if (s.status !== 'SENT' || (parseDb(s.expiresAt) && nowDate.getTime() > parseDb(s.expiresAt).getTime())) {
    db.prepare("UPDATE satisfaction_survey SET status = 'EXPIRED' WHERE survey_id = ?").run(s.surveyId);
    throw new ApiError(ERR.SURVEY_EXPIRED, null, 410);
  }
  const ratings = body.ratings || {};
  const values = {};
  for (const key of RATING_KEYS) {
    const v = ratings[key];
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new ApiError(ERR.VALIDATION, '請對每一題進行 1~5 分評分');
    }
    values[key] = v;
  }
  const feedback = String(body.feedback || '').trim().slice(0, 2000);
  const sum = RATING_KEYS.reduce((acc, k) => acc + values[k], 0);
  const isLow = RATING_KEYS.some((k) => values[k] <= LOW_SCORE);
  const atDb = dbNow();
  const avg = Math.round((sum / 4) * 10) / 10;
  db.prepare(
    `UPDATE satisfaction_survey
        SET status = 'SUBMITTED', submitted_at = ?, rating_overall = ?, rating_response = ?,
            rating_attitude = ?, rating_resolution = ?, feedback = ?, is_low_score = ?
      WHERE survey_id = ?`
  ).run(atDb, values.overall, values.response, values.attitude, values.resolution, feedback || null, isLow ? 1 : 0, s.surveyId);
  logger.info('surveyService', `SURVEY_SUBMIT ${s.caseId} avg=${avg} low=${isLow}`);
  if (isLow) {
    // 低分 → 通知相關主管（6.6 SURVEY 類型：屋苑主管／客服主管／管理員）
    const reviewers = reviewersForCase(db, s.estateCode, null);
    const ratingLine = RATING_KEYS.map((k) => `${k}=${values[k]}`).join(' ');
    for (const r of reviewers) {
      notifyUser(db, {
        userId: r.userId,
        notifType: 'SURVEY',
        title: `滿意度調查低分提醒 — 個案 ${s.caseId}`,
        body: `個案 ${s.caseId}（屋苑 ${s.estateNameZh}）滿意度調查獲低分（${ratingLine}），請跟進了解。${feedback ? `\n意見：${feedback}` : ''}`,
        refId: s.caseId,
      });
    }
    db.prepare(
      'INSERT INTO case_log (case_id, log_type, log_content, action_by, action_at) VALUES (?, ?, ?, 0, ?)'
    ).run(s.caseId, 'OTHER', `滿意度調查低分（平均 ${avg} 分）：${ratingLine}${feedback ? `；意見：${feedback}` : ''}`, atDb);
  }
  return { submitted: true, caseId: s.caseId, average: avg, isLowScore: isLow };
}

/** 到期掃描：SENT 且過期 → EXPIRED（回傳處理筆數） */
function expireSurveys(db, nowMs = Date.now()) {
  const nowDb = toDb(new Date(nowMs));
  const info = db.prepare(
    "UPDATE satisfaction_survey SET status = 'EXPIRED' WHERE status = 'SENT' AND expires_at < ?"
  ).run(nowDb);
  if (info.changes) logger.info('surveyService', `SURVEY_EXPIRE ${info.changes} surveys`);
  return info.changes;
}

/** 重發問卷電郵（FR-007-06：限未填寫、未過期，最多補發一次） */
function resendSurvey(db, surveyId, user, { origin = '', lang = '' } = {}) {
  const s = db.prepare(
    `SELECT s.survey_id AS surveyId, s.case_id AS caseId, s.status, s.lang AS lang, s.resend_count AS resendCount,
            s.sent_at AS sentAt, s.expires_at AS expiresAt, s.survey_token AS token,
            c.customer_email AS customerEmail, c.estate_code AS estateCode,
            e.estate_name_zh AS estateNameZh, e.estate_name_en AS estateNameEn
       FROM satisfaction_survey s
       JOIN \`case\` c ON c.case_id = s.case_id
       JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE s.survey_id = ?`
  ).get(Number(surveyId));
  if (!s) throw new ApiError(ERR.SURVEY_NOT_FOUND, null, 404);
  if (s.status !== 'SENT') throw new ApiError(ERR.VALIDATION, '問卷已提交或已過期，不能重發');
  if (parseDb(s.expiresAt) && Date.now() > parseDb(s.expiresAt).getTime()) {
    throw new ApiError(ERR.SURVEY_EXPIRED, null, 410);
  }
  if (s.resendCount >= 1) throw new ApiError(ERR.VALIDATION, '問卷電郵只能補發一次');
  const l = lang === 'en' ? 'en' : s.lang === 'en' ? 'en' : 'zh-Hant';
  const base = resolveBaseUrl(db, origin);
  const tpl = renderEmailTemplate(db, 'satisfaction_survey_reminder', l, {
    case_id: String(s.caseId),
    estate_name: l === 'en' ? s.estateNameEn : s.estateNameZh,
    survey_link: `${base}/survey/${s.token}`,
    expires: dbToIso8(s.expiresAt),
  });
  db.prepare(
    "UPDATE satisfaction_survey SET resend_count = resend_count + 1, sent_at = ? WHERE survey_id = ?"
  ).run(dbNow(), s.surveyId);
  enqueueEmail(db, { caseId: s.caseId, template: 'satisfaction_survey_reminder', recipient: s.customerEmail, lang: l, subject: tpl.subject, body: tpl.body });
  audit(db, user, 'SURVEY_RESEND', s.caseId, { surveyId: s.surveyId });
  return { surveyId: s.surveyId, resendCount: s.resendCount + 1, sentAt: dbToIso8(dbNow()) };
}

function audit(db, user, action, targetId, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user ? user.userId : 0, user ? user.username || 'USER' : 'SYSTEM', action, 'SURVEY', targetId, detail ? JSON.stringify(detail) : null);
}

/** 問卷統計（FR-007-07；範圍依操作者屋苑） */
function surveyStats(db, user, filters = {}) {
  const scopeWhere = [];
  const scopeParams = [];
  {
    const sc = estateInClause('c.estate_code', user && user.estateCode);
    if (sc.clause) { scopeWhere.push(sc.clause); scopeParams.push(...sc.params); }
  }
  if (filters.estate) {
    scopeWhere.push('c.estate_code = ?');
    scopeParams.push(filters.estate);
  }
  const scope = scopeWhere.length ? `AND ${scopeWhere.join(' AND ')}` : '';
  const base = `FROM satisfaction_survey s JOIN \`case\` c ON c.case_id = s.case_id WHERE 1=1 ${scope}`;
  const overall = db.prepare(
    `SELECT COUNT(*) AS sent,
            COALESCE(SUM(CASE WHEN s.status = 'SUBMITTED' THEN 1 ELSE 0 END), 0) AS submitted,
            COALESCE(SUM(CASE WHEN s.status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired,
            COALESCE(SUM(s.is_low_score), 0) AS lowScoreCount,
            AVG(CASE WHEN s.status = 'SUBMITTED' THEN s.rating_overall END) AS avgOverall,
            AVG(CASE WHEN s.status = 'SUBMITTED' THEN s.rating_response END) AS avgResponse,
            AVG(CASE WHEN s.status = 'SUBMITTED' THEN s.rating_attitude END) AS avgAttitude,
            AVG(CASE WHEN s.status = 'SUBMITTED' THEN s.rating_resolution END) AS avgResolution
       ${base}`
  ).get(...scopeParams);
  const byEstateBase = `FROM satisfaction_survey s JOIN \`case\` c ON c.case_id = s.case_id JOIN sys_estate e ON e.estate_code = c.estate_code WHERE 1=1 ${scope}`;
  const byEstate = db.prepare(
    `SELECT c.estate_code AS estateCode, e.estate_name_zh AS estateNameZh,
            COUNT(*) AS sent,
            COALESCE(SUM(CASE WHEN s.status = 'SUBMITTED' THEN 1 ELSE 0 END), 0) AS submitted,
            COALESCE(SUM(CASE WHEN s.status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired,
            COALESCE(SUM(s.is_low_score), 0) AS lowScoreCount,
            AVG(CASE WHEN s.status = 'SUBMITTED' THEN s.rating_overall END) AS avgOverall
       ${byEstateBase} GROUP BY c.estate_code`
  ).all(...scopeParams);
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const sent = Number(overall.sent || 0);
  const submitted = Number(overall.submitted || 0);
  return {
    overall: {
      sent,
      submitted,
      expired: Number(overall.expired || 0),
      pending: sent - submitted - Number(overall.expired || 0),
      replyRate: sent ? Math.round((submitted / sent) * 1000) / 10 : 0,
      lowScoreCount: Number(overall.lowScoreCount || 0),
      avg: {
        overall: round1(overall.avgOverall),
        response: round1(overall.avgResponse),
        attitude: round1(overall.avgAttitude),
        resolution: round1(overall.avgResolution),
      },
    },
    byEstate: byEstate.map((r) => ({
      estateCode: r.estateCode,
      estateNameZh: r.estateNameZh,
      sent: Number(r.sent),
      submitted: Number(r.submitted),
      expired: Number(r.expired),
      lowScoreCount: Number(r.lowScoreCount),
      replyRate: r.sent ? Math.round((Number(r.submitted) / Number(r.sent)) * 1000) / 10 : 0,
      avgOverall: round1(r.avgOverall),
    })),
  };
}

module.exports = {
  createSurveyOnClose,
  getPublicSurvey,
  submitPublicSurvey,
  expireSurveys,
  resendSurvey,
  surveyStats,
};
