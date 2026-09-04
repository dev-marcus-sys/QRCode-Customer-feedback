'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

let seq = 100;
function insertCase(db, overrides = {}) {
  const caseId = overrides.caseId || `T${seq++}`;
  const estate = overrides.estate || 'CHNG';
  db.prepare(
    `INSERT INTO \`case\` (case_id, case_status, event_type, priority, intent_type, category_code,
       estate_code, customer_title, customer_name, customer_email, incident_date, comment_content,
       satisfaction_consent, assigned_to, response_sla_due, closure_sla_due, created_at, updated_at)
     VALUES (?, ?, ?, 'HIGH', 'COMPLAINT', 'SECURITY', ?, '陳', '小明', ?, '2026-09-01', '測試意見內容', 1, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(
    caseId,
    overrides.status || 'PENDING',
    overrides.eventType || 'NORMAL',
    estate,
    overrides.email || 'cust@example.com',
    overrides.assignedTo || null,
    overrides.responseDue || null,
    overrides.closureDue || '2026-09-08 00:00:00'
  );
  return caseId;
}

function user(userId, username, estateCode) {
  return { userId, username, estateCode };
}

function notes(db, caseId) {
  return db.prepare('SELECT log_type AS logType, new_status AS newStatus, action_by AS actionBy FROM case_log WHERE case_id = ? ORDER BY log_id ASC').all(caseId);
}

function notifs(db, userId) {
  return db.prepare('SELECT notif_type AS notifType, ref_id AS refId FROM notification WHERE user_id = ? ORDER BY notif_id DESC').all(userId);
}

test('assignees：建議屋苑主管且候選僅限該屋苑可處理角色', () => {
  const db = freshDb();
  const chngSupId = uid(db, 'chng_sup');
  const staffId = uid(db, 'chng_staff');
  const admin = user(uid(db, 'admin'), 'admin', 'ALL');
  const id = insertCase(db, {});
  const data = caseService.getAssignees(db, id, admin);
  assert.equal(data.estateCode, 'CHNG');
  assert.equal(data.suggestedUserId, chngSupId);
  const ids = data.assignableUsers.map((x) => x.userId);
  assert.ok(ids.includes(chngSupId));   // 屋苑主管
  assert.ok(ids.includes(staffId));     // 前線處理人員
  assert.ok(!ids.includes(admin.userId)); // ADMIN 不列為可指派處理人員
});

test('分派：PENDING→ASSIGNED，寫時間軸＋通知處理人員', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staffId = uid(db, 'chng_staff');
  const id = insertCase(db, {});
  const r = caseService.assignCase(db, id, sup, { assigneeId: staffId, priority: 'MEDIUM', note: '請盡快跟進' });
  assert.equal(r.caseStatus, 'ASSIGNED');
  const row = db.prepare('SELECT case_status AS s, assigned_to AS a FROM `case` WHERE case_id = ?').get(id);
  assert.equal(row.s, 'ASSIGNED');
  assert.equal(row.a, staffId);
  assert.ok(notes(db, id).some((n) => n.logType === 'ASSIGN'));
  assert.ok(notifs(db, staffId).some((n) => n.notifType === 'CASE' && n.refId === id));
});

test('分派不合法狀態：已指派個案需用轉派', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staffId = uid(db, 'chng_staff');
  const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staffId });
  assert.throws(() => caseService.assignCase(db, id, sup, { assigneeId: staffId }), (e) => e.code === 3002);
});

test('轉派：須不同處理人員＋原因必填；通知新舊處理人員', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staffId = uid(db, 'chng_staff');
  const supId = sup.userId;
  const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staffId });
  assert.throws(() => caseService.reassignCase(db, id, sup, { assigneeId: supId }), (e) => e.code === 1002); // 缺原因
  assert.throws(() => caseService.reassignCase(db, id, sup, { assigneeId: staffId, reason: 'x' }), (e) => e.code === 1002); // 相同處理人員
  const r = caseService.reassignCase(db, id, sup, { assigneeId: supId, reason: '由主管直接跟進' });
  assert.equal(r.assigneeId, supId);
  const row = db.prepare('SELECT assigned_to AS a FROM `case` WHERE case_id = ?').get(id);
  assert.equal(row.a, supId);
  assert.ok(notifs(db, staffId).some((n) => n.refId === id));
});

test('跟進：非處理人員為 NOTE；處理人員首筆寫入 RESPONSE 並記 first_response_at', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId, responseDue: '2099-01-01 00:00:00' });
  caseService.addCaseNote(db, id, sup, { content: '主管補充指示' });
  assert.equal(notes(db, id).at(-1).logType, 'NOTE');
  const r = caseService.addCaseNote(db, id, staff, { content: '已聯絡客戶並解釋安排' });
  assert.equal(r.logType, 'RESPONSE');
  const row = db.prepare('SELECT first_response_at AS f, response_sla_met AS m FROM `case` WHERE case_id = ?').get(id);
  assert.ok(row.f);
  assert.equal(row.m, 1);
});

test('狀態流：start→waiting→resume；非法流轉被拒', () => {
  const db = freshDb();
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
  assert.throws(() => caseService.setWaitingCase(db, id, staff, {}), (e) => e.code === 3002); // ASSIGNED 不可 WAITING
  caseService.startCase(db, id, staff, {});
  assert.equal(db.prepare('SELECT case_status AS s FROM `case` WHERE case_id = ?').get(id).s, 'IN_PROGRESS');
  caseService.setWaitingCase(db, id, staff, { note: '等客戶補相' });
  assert.equal(db.prepare('SELECT case_status AS s FROM `case` WHERE case_id = ?').get(id).s, 'WAITING');
  assert.throws(() => caseService.startCase(db, id, staff, {}), (e) => e.code === 3002); // WAITING 不可直接 start
  caseService.resumeCase(db, id, staff, {});
  assert.equal(db.prepare('SELECT case_status AS s FROM `case` WHERE case_id = ?').get(id).s, 'IN_PROGRESS');
});

test('範圍保護：非該屋苑操作者操作他苑個案拋 3004', () => {
  const db = freshDb();
  const yprSup = user(uid(db, 'ypr_sup'), 'ypr_sup', 'YPR');
  const id = insertCase(db, {});
  assert.throws(() => caseService.getAssignees(db, id, yprSup), (e) => e.code === 3004);
});

test('批次分派：可處理＋不可處理分開回報', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staffId = uid(db, 'chng_staff');
  const okCase = insertCase(db, {});
  const noCase = insertCase(db, { status: 'ASSIGNED', assignedTo: staffId });
  const otherEstate = insertCase(db, { estate: 'YPR' });
  const r = caseService.batchAssignCases(db, sup, { caseIds: [okCase, noCase, otherEstate], assigneeId: staffId });
  assert.ok(r.assigned.includes(okCase));
  assert.ok(r.skipped.some((s) => s.caseId === noCase));
  assert.ok(r.skipped.some((s) => s.caseId === otherEstate));
});

test('批次開始處理：ASSIGNED/REOPENED 可，其餘跳過', () => {
  const db = freshDb();
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const a = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
  const b = insertCase(db, { status: 'REOPENED', assignedTo: staff.userId });
  const c = insertCase(db, { status: 'PENDING' });
  const r = caseService.batchUpdateCases(db, staff, { caseIds: [a, b, c] });
  assert.ok(r.done.includes(a));
  assert.ok(r.done.includes(b));
  assert.ok(r.skipped.some((s) => s.caseId === c));
});

test('附件：上傳入時間軸＋可下載；偽裝副檔名／超大小／跨苑下載被拒', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'case-upload-'));
  process.env.UPLOAD_DIR = tmp;
  try {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
    const up = caseService.uploadCaseAttachment(db, id, staff, { name: '證據.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
    assert.ok(up.attachmentId);
    assert.equal(up.fileName, '證據.png');
    assert.ok(notes(db, id).some((n) => n.logType === 'UPLOAD'));
    const meta = db.prepare('SELECT file_type AS t, storage_key AS k FROM case_log_attachment WHERE attachment_id = ?').get(up.attachmentId);
    assert.equal(meta.t, 'png');
    assert.ok(meta.k.endsWith('.png'));
    const dl = caseService.downloadCaseAttachment(db, id, up.attachmentId, staff);
    assert.equal(dl.fileName, '證據.png');
    assert.ok(readFileSync(dl.absPath).length > 0);
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'evil.exe', data: Buffer.from('x') }), (e) => e.code === 4009);
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'big.png', data: Buffer.alloc(11 * 1024 * 1024) }), (e) => e.code === 4009);
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'empty.png', data: null }), (e) => e.code === 4009);
    const yprSup = user(uid(db, 'ypr_sup'), 'ypr_sup', 'YPR');
    assert.throws(() => caseService.downloadCaseAttachment(db, id, up.attachmentId, yprSup), (e) => e.code === 3004);
  } finally {
    delete process.env.UPLOAD_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
});
