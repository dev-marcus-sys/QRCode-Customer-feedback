'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const { scanSla } = require('../src/services/slaReminderService');

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

let seq = 400;
function dbStr(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function insertCase(db, o = {}) {
  const caseId = o.caseId || `L${seq++}`;
  const now = new Date();
  db.prepare(
    `INSERT INTO \`case\` (case_id, case_status, event_type, priority, intent_type, category_code,
       estate_code, customer_title, customer_name, incident_date, comment_content,
       assigned_to, response_sla_due, closure_sla_due, first_response_at, created_at, updated_at)
     VALUES (?, ?, 'URGENT', 'HIGH', 'COMPLAINT', 'SECURITY', 'CHNG', '王', '客戶丙', '2026-09-03', '保安問題',
        ?, ?, ?, ?, ?, ?)`
  ).run(
    caseId,
    o.status || 'ASSIGNED',
    o.assignedTo || null,
    o.responseDue || null,
    o.closureDue || null,
    o.firstResponseAt || null,
    dbStr(new Date(now.getTime() - 60000)),
    dbStr(now)
  );
  return caseId;
}

function logs(db, caseId, type) {
  return db.prepare('SELECT COUNT(*) AS c FROM case_log WHERE case_id = ? AND log_type = ?').get(caseId, type).c;
}

function countMark(db, caseId, col) {
  return db.prepare(`SELECT ${col} AS v FROM \`case\` WHERE case_id = ?`).get(caseId).v;
}

test('回應逾期升級：通知處理人員＋直屬主管，只升級一次', () => {
  const db = freshDb();
  const staffId = db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get('chng_staff').user_id;
  const supId = db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get('chng_sup').user_id;
  const past = dbStr(new Date(Date.now() - 10 * 60 * 1000));
  const id = insertCase(db, { assignedTo: staffId, responseDue: past });
  const r = scanSla(db);
  assert.ok(r.responseEscalations.includes(id));
  assert.ok(countMark(db, id, 'response_escalated_at'));
  const escFor = (userId) => db.prepare(
    'SELECT COUNT(*) AS c FROM notification WHERE user_id = ? AND notif_type = ? AND ref_id = ?'
  ).get(userId, 'ESCALATION', id).c;
  assert.equal(escFor(staffId), 1);
  assert.equal(escFor(supId), 1);
  assert.equal(logs(db, id, 'ESCALATE'), 1);
  // 第二次掃描不再升級
  const r2 = scanSla(db);
  assert.ok(!r2.responseEscalations.includes(id));
  assert.equal(logs(db, id, 'ESCALATE'), 1);
});

test('回應期限將至提醒（URGENT 提前 10 分鐘）', () => {
  const db = freshDb();
  const staffId = db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get('chng_staff').user_id;
  const dueIn5 = dbStr(new Date(Date.now() + 5 * 60 * 1000));
  const id = insertCase(db, { assignedTo: staffId, responseDue: dueIn5 });
  const r = scanSla(db);
  assert.ok(r.responseReminders.includes(id));
  const rem = db.prepare('SELECT COUNT(*) AS c FROM notification WHERE user_id = ? AND notif_type = ? AND ref_id = ?').get(staffId, 'REMINDER', id).c;
  assert.equal(rem, 1);
  assert.equal(logs(db, id, 'REMINDER'), 1);
  // 尚未到期不觸發升級
  assert.ok(!r.responseEscalations.includes(id));
});

test('關閉期限：逾時升級、前一天提醒（各自一次）；已關閉/審核中不掃', () => {
  const db = freshDb();
  const staffId = db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get('chng_staff').user_id;
  const firstResp = dbStr(new Date());
  // C1 已逾關閉期限（且已首次回應，避免污染 response 掃描）
  const c1 = insertCase(db, { assignedTo: staffId, responseDue: null, firstResponseAt: firstResp, closureDue: dbStr(new Date(Date.now() - 60 * 60 * 1000)) });
  // C2 一天內到期（12 小時後）
  const c2 = insertCase(db, { assignedTo: staffId, responseDue: null, firstResponseAt: firstResp, closureDue: dbStr(new Date(Date.now() + 12 * 60 * 60 * 1000)) });
  // C3 RESOLVED 逾時 → 不掃
  const c3 = insertCase(db, { status: 'RESOLVED', responseDue: null, firstResponseAt: firstResp, closureDue: dbStr(new Date(Date.now() - 60 * 60 * 1000)) });
  const r = scanSla(db);
  assert.ok(r.closureEscalations.includes(c1));
  assert.ok(r.closureReminders.includes(c2));
  assert.ok(!r.closureEscalations.includes(c3));
  assert.ok(!r.responseEscalations.includes(c1)); // responseDue null → 不掃
  const r2 = scanSla(db);
  assert.ok(!r2.closureEscalations.includes(c1));
  assert.ok(!r2.closureReminders.includes(c2));
});

test('N/A 事件（如讚賞）不回應升級；問卷到期納入掃描', () => {
  const db = freshDb();
  const id = insertCase(db, { responseDue: dbStr(new Date(Date.now() - 60 * 60 * 1000)) });
  db.prepare('UPDATE `case` SET event_type = ? WHERE case_id = ?').run('N/A', id);
  const r = scanSla(db);
  assert.ok(!r.responseEscalations.includes(id));
  assert.equal(r.expiredSurveys, 0);
});
