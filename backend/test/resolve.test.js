'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const caseService = require('../src/services/caseService');

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

function uid(db, username) {
  return db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get(username).user_id;
}

let seq = 200;
function insertCase(db, overrides = {}) {
  const caseId = overrides.caseId || `R${seq++}`;
  db.prepare(
    `INSERT INTO \`case\` (case_id, case_status, event_type, priority, intent_type, category_code,
       estate_code, customer_title, customer_name, customer_email, incident_date, comment_content,
       satisfaction_consent, assigned_to, response_sla_due, closure_sla_due, created_at, updated_at)
     VALUES (?, ?, 'NORMAL', 'HIGH', 'COMPLAINT', 'MAINTENANCE', 'CHNG', '張', '客戶甲', ?, '2026-09-01', '冷氣漏水',
        ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(
    caseId,
    overrides.status || 'PENDING',
    overrides.email === null ? null : (overrides.email || 'cust@example.com'),
    overrides.consent == null ? 1 : overrides.consent,
    overrides.assignedTo || null,
    overrides.responseDue || null,
    overrides.closureDue || '2099-01-01 00:00:00'
  );
  return caseId;
}

function user(userId, username, estateCode) {
  return { userId, username, estateCode };
}

function outbox(db, template, caseId) {
  return db.prepare('SELECT * FROM email_outbox WHERE template = ? AND case_id = ?').all(template, caseId);
}

function notifFor(db, userId, caseId, type) {
  return db.prepare(
    'SELECT COUNT(*) AS c FROM notification WHERE user_id = ? AND ref_id = ? AND notif_type = ?'
  ).get(userId, caseId, type).c;
}

test('完結申請：IN_PROGRESS→RESOLVED，通知審核主管；無法解決需原因', () => {
  const db = freshDb();
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const supId = uid(db, 'chng_sup');
  const ccSupId = uid(db, 'cc_sup');
  const adminId = uid(db, 'admin');
  const id = insertCase(db, { status: 'IN_PROGRESS', assignedTo: staff.userId });
  assert.throws(
    () => caseService.submitResolution(db, id, staff, { result: 'UNRESOLVED', summary: '已聯絡業主' }),
    (e) => e.code === 1002
  );
  const r = caseService.submitResolution(db, id, staff, { result: 'RESOLVED_FULL', summary: '更換水泵完成', customerReply: '客戶確認修好' });
  assert.equal(r.caseStatus, 'RESOLVED');
  assert.equal(notifFor(db, supId, id, 'CASE'), 1);
  assert.equal(notifFor(db, ccSupId, id, 'CASE'), 1);
  assert.equal(notifFor(db, adminId, id, 'CASE'), 1);
});

test('審核通過：→CLOSED，計算 handling_days/closure_sla_met，寄感謝信＋建立問卷', () => {
  const db = freshDb();
  const chngSup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const id = insertCase(db, { status: 'RESOLVED', assignedTo: uid(db, 'chng_staff'), email: 'thanks@example.com', consent: 1 });
  const r = caseService.approveResolution(db, id, chngSup, { origin: 'http://demo.test' });
  assert.equal(r.caseStatus, 'CLOSED');
  assert.equal(r.closureSlaMet, 1);
  assert.equal(typeof r.handlingDays, 'number');
  const row = db.prepare('SELECT closed_at AS c, closure_sla_met AS m, handling_days AS h FROM `case` WHERE case_id = ?').get(id);
  assert.ok(row.c);
  assert.equal(row.m, 1);
  assert.equal(outbox(db, 'case_closed_thanks', id).length, 1);
  assert.equal(outbox(db, 'satisfaction_survey', id).length, 1);
  const survey = db.prepare('SELECT status, expires_at AS e, case_id AS cid FROM satisfaction_survey WHERE case_id = ?').get(id);
  assert.equal(survey.cid, id);
  assert.equal(survey.status, 'SENT');
  assert.ok(new Date(survey.e) > new Date());
});

test('無電郵或不同意問卷 → 不建問卷', () => {
  const db = freshDb();
  const chngSup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const noConsent = insertCase(db, { status: 'RESOLVED', consent: 0 });
  caseService.approveResolution(db, noConsent, chngSup, { origin: 'http://demo.test' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM satisfaction_survey WHERE case_id = ?').get(noConsent).c, 0);
  const noEmail = insertCase(db, { status: 'RESOLVED', email: null });
  caseService.approveResolution(db, noEmail, chngSup, { origin: 'http://demo.test' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM satisfaction_survey WHERE case_id = ?').get(noEmail).c, 0);
});

test('審核駁回：RESOLVED→IN_PROGRESS，需原因並通知處理人員', () => {
  const db = freshDb();
  const chngSup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staffId = uid(db, 'chng_staff');
  const id = insertCase(db, { status: 'RESOLVED', assignedTo: staffId });
  assert.throws(() => caseService.rejectResolution(db, id, chngSup, {}), (e) => e.code === 1002);
  const r = caseService.rejectResolution(db, id, chngSup, { reason: '缺少相片佐證' });
  assert.equal(r.caseStatus, 'IN_PROGRESS');
  assert.equal(notifFor(db, staffId, id, 'CASE'), 1);
});

test('授權重開：CLOSED→REOPENED 需原因；重算關閉期限並重設標記，之後可再分派', () => {
  const db = freshDb();
  const chngSup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staffId = uid(db, 'chng_staff');
  const id = insertCase(db, { status: 'CLOSED', assignedTo: staffId, closureDue: '2026-09-08 00:00:00' });
  db.prepare('UPDATE `case` SET closure_escalated_at = datetime(\'now\') WHERE case_id = ?').run(id);
  assert.throws(() => caseService.reopenCase(db, id, chngSup, {}), (e) => e.code === 1002);
  const r = caseService.reopenCase(db, id, chngSup, { reason: '客戶再投訴同一問題', reopenType: 'SECOND_COMPLAINT' });
  assert.equal(r.caseStatus, 'REOPENED');
  const row = db.prepare('SELECT case_status AS s, closure_sla_due AS d, closure_escalated_at AS e FROM `case` WHERE case_id = ?').get(id);
  assert.equal(row.s, 'REOPENED');
  assert.equal(row.e, null); // 標記重設
  assert.ok(new Date(row.d) > new Date()); // 關閉期限往後重算
  const again = caseService.assignCase(db, id, chngSup, { assigneeId: staffId, note: '重新分派跟進' });
  assert.equal(again.caseStatus, 'ASSIGNED');
});

test('完整 happy path：PENDING→分派→開始→首回應→完結→審核→CLOSED', () => {
  const db = freshDb();
  const chngSup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const id = insertCase(db, { responseDue: '2099-01-01 00:00:00', closureDue: '2099-01-08 00:00:00', consent: 1, email: 'cust@example.com' });
  caseService.assignCase(db, id, chngSup, { assigneeId: staff.userId });
  caseService.startCase(db, id, staff, {});
  const note = caseService.addCaseNote(db, id, staff, { content: '已派人維修' });
  assert.equal(note.logType, 'RESPONSE');
  caseService.submitResolution(db, id, staff, { result: 'RESOLVED_FULL', summary: '完成維修' });
  const closed = caseService.approveResolution(db, id, chngSup, { origin: 'http://demo.test' });
  assert.equal(closed.caseStatus, 'CLOSED');
  const survey = db.prepare('SELECT COUNT(*) AS c FROM satisfaction_survey WHERE case_id = ?').get(id).c;
  assert.equal(survey, 1);
  const logs = db.prepare('SELECT log_type AS t FROM case_log WHERE case_id = ?').all(id).map((x) => x.t);
  assert.ok(logs.includes('ASSIGN') && logs.includes('RESPONSE') && logs.includes('RESOLVE_REQUEST') && logs.includes('RESOLVE_APPROVE'));
});
