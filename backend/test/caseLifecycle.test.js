/**
 * 個案 CRUD 與生命週期狀態機（service 層單元測試，不含 AI）。
 * 與 caseAction.test.js 互補：本檔聚焦「建案/列表/詳情」與「完結/審核/重開/優先級」等
 * caseAction.test.js 未涵蓋的狀態機分支，以及所有非法轉換與錯誤碼。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const caseService = require('../src/services/caseService');
const { STATUS_ACTIONS, ERR } = require('../src/config/constants');
const { freshDb, uid, insertCase, user } = require('./helpers/casesFixtures');

/* ---------- 手動建案（case:create 之 service 層） ---------- */

test('手動建案：成功回傳 caseId（含斜線編號）且狀態 PENDING', () => {
  const db = freshDb();
  const actor = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const r = caseService.createManualCase(db, actor, { estate: 'CHNG', title: '先生', name: '王小明', category: 'SECURITY', content: '大堂燈損壞' });
  assert.match(r.caseId, /\//); // 編號格式 公司/業務/屋苑/日期流水
  assert.equal(r.status, 'PENDING');
  const row = db.prepare('SELECT case_status, customer_name, category_code FROM `case` WHERE case_id = ?').get(r.caseId);
  assert.equal(row.case_status, 'PENDING');
  assert.equal(row.customer_name, '王小明');
  assert.equal(row.category_code, 'SECURITY');
  assert.ok(db.prepare("SELECT 1 FROM case_log WHERE case_id = ? AND log_type='CREATE'").get(r.caseId));
});

test('手動建案：缺少必填欄位拋 VALIDATION(1002)/400', () => {
  const db = freshDb();
  const actor = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const cases = [
    { name: 'x', category: 'SECURITY', content: 'c' },                 // 缺 estate
    { estate: 'CHNG', category: 'SECURITY', content: 'c' },            // 缺 name
    { estate: 'CHNG', name: 'x', content: 'c' },                       // 缺 category
    { estate: 'CHNG', name: 'x', category: 'SECURITY' },               // 缺 content
  ];
  for (const payload of cases) {
    assert.throws(
      () => caseService.createManualCase(db, actor, payload),
      (e) => e.code === ERR.VALIDATION && e.httpStatus === 400
    );
  }
});

test('手動建案：屋苑超出操作者範圍拋 DATA_SCOPE(3004)/403', () => {
  const db = freshDb();
  const actor = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  assert.throws(
    () => caseService.createManualCase(db, actor, { estate: 'YPR', name: 'x', category: 'SECURITY', content: 'c' }),
    (e) => e.code === ERR.DATA_SCOPE && e.httpStatus === 403
  );
});

/* ---------- 列表 / 詳情 ---------- */

test('列表：依屋苑範圍過濾＋分頁', () => {
  const db = freshDb();
  const chng = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  insertCase(db, { estate: 'CHNG', status: 'PENDING' });
  insertCase(db, { estate: 'CHNG', status: 'PENDING' });
  insertCase(db, { estate: 'YPR', status: 'PENDING' });
  const all = caseService.listCases(db, {}, chng, { page: 1, pageSize: 20 });
  assert.equal(all.total, 2); // 受限用戶僅見 CHNG
  const paged = caseService.listCases(db, {}, chng, { page: 1, pageSize: 1 });
  assert.equal(paged.items.length, 1);
  assert.equal(paged.total, 2);
  assert.equal(paged.pageSize, 1);
});

test('詳情：回傳 個案/時間軸/allowedActions；查不到 404；跨屋苑 403', () => {
  const db = freshDb();
  const chng = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const ypr = user(uid(db, 'ypr_sup'), 'ypr_sup', 'YPR');
  const id = insertCase(db, { estate: 'CHNG', status: 'PENDING' });
  const d = caseService.getCaseDetail(db, id, chng);
  assert.equal(d.case.caseId, id);
  assert.ok(Array.isArray(d.timeline));
  assert.deepEqual(d.allowedActions, STATUS_ACTIONS.PENDING.map((a) => ({ action: a.action, toStatus: a.toStatus })));
  assert.throws(
    () => caseService.getCaseDetail(db, 'NOPE', chng),
    (e) => e.code === ERR.CASE_NOT_FOUND && e.httpStatus === 404
  );
  assert.throws(
    () => caseService.getCaseDetail(db, id, ypr),
    (e) => e.code === ERR.DATA_SCOPE && e.httpStatus === 403
  );
});

/* ---------- 生命週期狀態機 ---------- */

test('狀態機：resolve→approve→reopen 合法流轉（含二次投訴標記）', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const id = insertCase(db, { status: 'IN_PROGRESS', assignedTo: staff.userId });
  const r1 = caseService.submitResolution(db, id, staff, { result: 'RESOLVED_FULL', summary: '已處理完畢' });
  assert.equal(r1.caseStatus, 'RESOLVED');
  const r2 = caseService.approveResolution(db, id, sup, {});
  assert.equal(r2.caseStatus, 'CLOSED');
  assert.ok(typeof r2.handlingDays === 'number');
  const r3 = caseService.reopenCase(db, id, sup, { reason: '客戶再次投訴', reopenType: 'SECOND_COMPLAINT' });
  assert.equal(r3.caseStatus, 'REOPENED');
  const row = db.prepare('SELECT is_second_complaint AS s FROM `case` WHERE case_id = ?').get(id);
  assert.equal(row.s, 1); // 重開標記寫入欄位
});

test('狀態機：完結申請 非法結果/缺摘要/UNRESOLVED 缺原因 皆拋 VALIDATION', () => {
  const db = freshDb();
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const id = insertCase(db, { status: 'IN_PROGRESS', assignedTo: staff.userId });
  assert.throws(() => caseService.submitResolution(db, id, staff, { result: 'BAD', summary: 'x' }), (e) => e.code === ERR.VALIDATION);
  assert.throws(() => caseService.submitResolution(db, id, staff, { result: 'RESOLVED_FULL' }), (e) => e.code === ERR.VALIDATION);
  assert.throws(() => caseService.submitResolution(db, id, staff, { result: 'UNRESOLVED', summary: 'x' }), (e) => e.code === ERR.VALIDATION);
});

test('狀態機：非法流轉拋 STATE_TRANSITION(3002)', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  // approve 需 RESOLVED
  assert.throws(() => caseService.approveResolution(db, insertCase(db, { status: 'IN_PROGRESS', assignedTo: staff.userId }), sup, {}), (e) => e.code === ERR.STATE_TRANSITION);
  // reopen 需 CLOSED
  assert.throws(() => caseService.reopenCase(db, insertCase(db, { status: 'IN_PROGRESS', assignedTo: staff.userId }), sup, { reason: 'x' }), (e) => e.code === ERR.STATE_TRANSITION);
  // submitResolution 需 IN_PROGRESS/WAITING
  assert.throws(() => caseService.submitResolution(db, insertCase(db, { status: 'PENDING' }), staff, { result: 'RESOLVED_FULL', summary: 'x' }), (e) => e.code === ERR.STATE_TRANSITION);
  // reject 需 RESOLVED
  assert.throws(() => caseService.rejectResolution(db, insertCase(db, { status: 'IN_PROGRESS', assignedTo: staff.userId }), sup, { reason: 'x' }), (e) => e.code === ERR.STATE_TRANSITION);
  // start 需 ASSIGNED/REOPENED
  assert.throws(() => caseService.startCase(db, insertCase(db, { status: 'PENDING' }), staff, {}), (e) => e.code === ERR.STATE_TRANSITION);
});

test('狀態機：審核駁回 RESOLVED→IN_PROGRESS', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  const id = insertCase(db, { status: 'RESOLVED', assignedTo: staff.userId });
  const r = caseService.rejectResolution(db, id, sup, { reason: '資料不足' });
  assert.equal(r.caseStatus, 'IN_PROGRESS');
  assert.ok(db.prepare("SELECT 1 FROM case_log WHERE case_id=? AND log_type='RESOLVE_REJECT'").get(id));
});

test('優先級：CLOSED 阻擋(3002)；RESOLVED 允許；非法優先級拋 VALIDATION', () => {
  const db = freshDb();
  const sup = user(uid(db, 'chng_sup'), 'chng_sup', 'CHNG');
  const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
  assert.throws(() => caseService.changeCasePriority(db, insertCase(db, { status: 'CLOSED' }), sup, { priority: 'LOW' }), (e) => e.code === ERR.STATE_TRANSITION);
  const r = caseService.changeCasePriority(db, insertCase(db, { status: 'RESOLVED' }), sup, { priority: 'LOW' });
  assert.equal(r.priority, 'LOW');
  assert.throws(() => caseService.changeCasePriority(db, insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId }), sup, { priority: 'X' }), (e) => e.code === ERR.VALIDATION);
});
