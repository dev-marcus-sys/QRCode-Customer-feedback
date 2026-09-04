'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const { createCaseFromFeedback } = require('../src/services/caseService');
const { findDuplicate, findSecondComplaint } = require('../src/services/dedupe');

const base = {
  estate: 'CHNG', title: '先生', name: '陳大文',
  email: 'chan@example.com', phone: '',
  incidentDate: '2026-09-03', incidentTime: '14:30',
  categories: ['MAINTENANCE'], content: '大堂冷氣機滴水，請安排處理。',
  surveyConsent: true,
};
const payload = (over) => ({ ...base, ...over });

test('10 分鐘內同聯絡人同內容 → 回顯原案號，不重複建案', () => {
  const db = initDatabase();
  const first = createCaseFromFeedback(db, payload());
  assert.equal(first.isDuplicate, false);
  const again = createCaseFromFeedback(db, payload());
  assert.equal(again.isDuplicate, true);
  assert.equal(again.caseId, first.caseId);
  const total = db.prepare('SELECT COUNT(*) AS c FROM `case`').get().c;
  assert.equal(total, 1);
});

test('同內容但不同聯絡人（email 不同）→ 不視為重複', () => {
  const db = initDatabase();
  createCaseFromFeedback(db, payload());
  const other = createCaseFromFeedback(db, payload({ email: 'lee@example.com', name: '李小姐' }));
  assert.equal(other.isDuplicate, false);
});

test('同聯絡人但內容不同 → 不視為 10 分鐘重複', () => {
  const db = initDatabase();
  createCaseFromFeedback(db, payload());
  const other = createCaseFromFeedback(db, payload({ content: '大堂地面濕滑，請派人清潔。' }));
  assert.equal(other.isDuplicate, false);
});

test('24 小時內同聯絡人＋同類別（內容不同）→ 標記二次投訴並關聯原案', () => {
  const db = initDatabase();
  const first = createCaseFromFeedback(db, payload({ email: 'second@example.com', content: '大堂冷氣機嚴重滴水，地面濕滑。' }));
  assert.equal(first.isDuplicate, false);
  const second = createCaseFromFeedback(db, payload({
    email: 'second@example.com',
    content: '滴水問題未獲跟進，請盡快處理。',
  }));
  assert.equal(second.isDuplicate, false);
  assert.equal(second.isSecondComplaint, true);
  assert.equal(second.originalCaseId, first.caseId);
  const row = db.prepare('SELECT priority FROM `case` WHERE case_id = ?').get(second.caseId);
  assert.equal(row.priority, 'HIGH');
});

test('24 小時同聯絡人但類別無交集 → 不標記二次投訴', () => {
  const db = initDatabase();
  createCaseFromFeedback(db, payload({ content: '大堂冷氣機滴水，請安排處理。' }));
  const other = createCaseFromFeedback(db, payload({
    content: '保安態度十分良好，想請問當值時間。',
    categories: ['MO_SERVICE'],
  }));
  assert.equal(other.isSecondComplaint, false);
});

test('findDuplicate 依 email 優先識別聯絡人', () => {
  const db = initDatabase();
  const created = createCaseFromFeedback(db, payload());
  const hit = findDuplicate(db, {
    email: 'CHAN@example.com', content: '大堂冷氣機滴水，請安排處理。',
  }, Date.now());
  assert.ok(hit);
  assert.equal(hit.case_id, created.caseId);
});

test('findSecondComplaint 僅在 24 小時窗內命中', () => {
  const db = initDatabase();
  const created = createCaseFromFeedback(db, payload({ email: 'window@example.com', content: '單位窗戶無法關上。' }));
  const hitWithin = findSecondComplaint(db, payload({ email: 'window@example.com', content: '另一件相同類別的事。' }), Date.now());
  assert.ok(hitWithin);
  assert.equal(hitWithin.case_id, created.caseId);
  const hitOutside = findSecondComplaint(db, payload({ email: 'window@example.com', content: '另一件相同類別的事。' }), Date.now() + 25 * 60 * 60 * 1000);
  assert.equal(hitOutside, null);
});
