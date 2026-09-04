'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const surveyService = require('../src/services/surveyService');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  // eslint-disable-next-line global-require
  const { seed } = require('../db/seed');
  seed(db);
  ensureDefaults(db);
  return db;
}

let seq = 300;
function insertClosedCase(db, email = 'sur@example.com', consent = 1) {
  const caseId = `S${seq++}`;
  db.prepare(
    `INSERT INTO \`case\` (case_id, case_status, event_type, priority, intent_type, category_code,
       estate_code, customer_title, customer_name, customer_email, incident_date, comment_content,
       satisfaction_consent, closed_at, created_at, updated_at)
     VALUES (?, 'CLOSED', 'NORMAL', 'HIGH', 'COMPLAINT', 'CLEANLINESS', 'CHNG', '李', '客戶乙', ?, '2026-09-02', '垃圾清理',
        ?, datetime('now'), datetime('now'), datetime('now'))`
  ).run(caseId, email, consent ? 1 : 0);
  return caseId;
}

function createSurvey(db, caseId, origin = 'http://demo.test') {
  // 欄位命名貼齊 production 呼叫路徑（approveResolution 傳 SELECT_SQL 之底線欄名 row）
  const row = db.prepare(
    `SELECT c.case_id, c.customer_email, c.satisfaction_consent,
            e.estate_name_zh, e.estate_name_en
       FROM \`case\` c JOIN sys_estate e ON e.estate_code = c.estate_code WHERE c.case_id = ?`
  ).get(caseId);
  return surveyService.createSurveyOnClose(db, row, { origin });
}

const ALL = { userId: 1, username: 'admin', estateCode: 'ALL' };

test('建立問卷：每案只發一次、隨機 token、電郵落庫', () => {
  const db = freshDb();
  const caseId = insertClosedCase(db);
  const first = createSurvey(db, caseId);
  assert.ok(first.token && first.token.length >= 40);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM email_outbox WHERE template = ? AND case_id = ?').get('satisfaction_survey', caseId).c, 1);
  // 重複建立（如再次審核）不新增
  const second = createSurvey(db, caseId);
  assert.equal(second, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM satisfaction_survey WHERE case_id = ?').get(caseId).c, 1);
});

test('公開查詢：不洩漏客戶個資；無效 token 拋 4006', () => {
  const db = freshDb();
  const caseId = insertClosedCase(db);
  const { token } = createSurvey(db, caseId);
  const dto = surveyService.getPublicSurvey(db, token);
  assert.equal(dto.caseId, caseId);
  assert.ok(!('email' in dto) && !('customerEmail' in dto));
  assert.equal(dto.status, 'SENT');
  assert.ok(Array.isArray(dto.questions) && dto.questions.length === 4);
  assert.throws(() => surveyService.getPublicSurvey(db, 'deadbeef'.repeat(5)), (e) => e.code === 4006);
});

test('提交：成功→SUBMITTED；重複提交拋 4008；補發被拒', () => {
  const db = freshDb();
  const caseId = insertClosedCase(db);
  const { token } = createSurvey(db, caseId);
  const r = surveyService.submitPublicSurvey(db, token, { ratings: { overall: 5, response: 4, attitude: 5, resolution: 4 }, feedback: '滿意' });
  assert.equal(r.submitted, true);
  assert.equal(r.average, 4.5);
  const row = db.prepare('SELECT status, is_low_score AS low, feedback FROM satisfaction_survey WHERE case_id = ?').get(caseId);
  assert.equal(row.status, 'SUBMITTED');
  assert.equal(row.low, 0);
  assert.equal(row.feedback, '滿意');
  assert.throws(() => surveyService.submitPublicSurvey(db, token, { ratings: { overall: 1, response: 1, attitude: 1, resolution: 1 } }), (e) => e.code === 4008);
  const surveyId = db.prepare('SELECT survey_id AS id FROM satisfaction_survey WHERE case_id = ?').get(caseId).id;
  assert.throws(() => surveyService.resendSurvey(db, surveyId, ALL, { origin: 'http://demo.test' }), (e) => e.code === 1002);
});

test('缺評分提交被拒；低分（≤2）→ is_low_score + 通知主管 + 時間軸 OTHER', () => {
  const db = freshDb();
  const caseId = insertClosedCase(db);
  const { token } = createSurvey(db, caseId);
  assert.throws(
    () => surveyService.submitPublicSurvey(db, token, { ratings: { overall: 3, response: 2 } }),
    (e) => e.code === 1002
  );
  const r = surveyService.submitPublicSurvey(db, token, { ratings: { overall: 1, response: 2, attitude: 4, resolution: 3 }, feedback: '回應太慢' });
  assert.equal(r.isLowScore, true);
  const row = db.prepare('SELECT is_low_score AS low FROM satisfaction_survey WHERE case_id = ?').get(caseId);
  assert.equal(row.low, 1);
  const caseLog = db.prepare('SELECT COUNT(*) AS c FROM case_log WHERE case_id = ? AND log_type = ?').get(caseId, 'OTHER').c;
  assert.equal(caseLog, 1);
  const supNotif = db.prepare(
    'SELECT COUNT(*) AS c FROM notification n JOIN sys_user u ON u.user_id = n.user_id JOIN sys_user_role ur ON ur.user_id = u.user_id JOIN sys_role r ON r.role_id = ur.role_id WHERE n.notif_type = ? AND n.ref_id = ? AND r.role_code IN (?, ?)'
  ).get('SURVEY', caseId, 'ESTATE_SUPERVISOR', 'CC_SUPERVISOR').c;
  assert.ok(supNotif >= 2);
});

test('到期：expireSurveys 標 EXPIRED；過期提交拋 4007', () => {
  const db = freshDb();
  const caseId = insertClosedCase(db);
  const { token } = createSurvey(db, caseId);
  db.prepare("UPDATE satisfaction_survey SET expires_at = datetime('now', '-1 minute') WHERE case_id = ?").run(caseId);
  const n = surveyService.expireSurveys(db);
  assert.equal(n, 1);
  const row = db.prepare('SELECT status FROM satisfaction_survey WHERE case_id = ?').get(caseId);
  assert.equal(row.status, 'EXPIRED');
  assert.equal(surveyService.getPublicSurvey(db, token).status, 'EXPIRED');
  assert.throws(() => surveyService.submitPublicSurvey(db, token, { ratings: { overall: 5, response: 5, attitude: 5, resolution: 5 } }), (e) => e.code === 4007);
});

test('補發：未填且未過期可補發一次（含計數與電郵）；過期/二次補發被拒', () => {
  const db = freshDb();
  const caseId = insertClosedCase(db);
  const { token } = createSurvey(db, caseId);
  const surveyId = db.prepare('SELECT survey_id AS id FROM satisfaction_survey WHERE case_id = ?').get(caseId).id;
  const r = surveyService.resendSurvey(db, surveyId, ALL, { origin: 'http://demo.test', lang: 'en' });
  assert.equal(r.resendCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM email_outbox WHERE template = ? AND case_id = ?').get('satisfaction_survey_reminder', caseId).c, 1);
  assert.throws(() => surveyService.resendSurvey(db, surveyId, ALL, { origin: 'http://demo.test' }), (e) => e.code === 1002);
  db.prepare("UPDATE satisfaction_survey SET expires_at = datetime('now', '-1 minute') WHERE survey_id = ?").run(surveyId);
  assert.throws(() => surveyService.resendSurvey(db, surveyId, ALL, { origin: 'http://demo.test' }), (e) => e.code === 4007);
  assert.ok(token.length > 0);
});

test('統計：sent/submitted/expired/replyRate/低分數', () => {
  const db = freshDb();
  const c1 = insertClosedCase(db);
  const c2 = insertClosedCase(db);
  const c3 = insertClosedCase(db);
  const t1 = createSurvey(db, c1).token;
  createSurvey(db, c2);
  createSurvey(db, c3);
  surveyService.submitPublicSurvey(db, t1, { ratings: { overall: 5, response: 5, attitude: 5, resolution: 5 } });
  // c2 過期
  db.prepare("UPDATE satisfaction_survey SET expires_at = datetime('now', '-1 minute') WHERE case_id = ?").run(c2);
  surveyService.expireSurveys(db);
  const stats = surveyService.surveyStats(db, ALL, {});
  assert.equal(stats.overall.sent, 3);
  assert.equal(stats.overall.submitted, 1);
  assert.equal(stats.overall.expired, 1);
  assert.equal(stats.overall.pending, 1);
  assert.equal(stats.overall.replyRate, 33.3);
  assert.equal(stats.overall.avg.overall, 5);
  assert.equal(stats.byEstate.length, 1);
  assert.equal(stats.byEstate[0].estateCode, 'CHNG');
});
