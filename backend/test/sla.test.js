'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const { getConfig } = require('../src/db/configStore');
const { computeEvent, computeDueDates } = require('../src/services/sla');

function rulesOf(db) {
  return {
    rules: getConfig(db, 'sla.rules', {}),
    mapping: getConfig(db, 'category.event_mapping', {}),
  };
}

test('維修類別一般內容 → INSTANT（4 小時回應）', () => {
  const db = initDatabase();
  const { rules, mapping } = rulesOf(db);
  const r = computeEvent({ categories: ['MAINTENANCE'], content: '單位水龍頭滴水，請安排維修。' }, rules, mapping);
  assert.equal(r.eventType, 'INSTANT');
  const created = new Date(Date.UTC(2026, 8, 3, 6, 30, 0)); // HK 14:30
  const due = computeDueDates(db, created, r.eventType);
  assert.equal(due.responseDue, '2026-09-03 10:30:00'); // +4h UTC
  assert.equal(due.closureDue, '2026-09-10 06:30:00'); // +7 日
});

test('保安類別含緊急關鍵字 → URGENT（5 分鐘）', () => {
  const db = initDatabase();
  const { rules, mapping } = rulesOf(db);
  const r = computeEvent({ categories: ['SECURITY'], content: '大廈內有濃煙，懷疑火警，請即派人處理！' }, rules, mapping);
  assert.equal(r.eventType, 'URGENT');
  const created = new Date(Date.UTC(2026, 8, 3, 6, 30, 0));
  const due = computeDueDates(db, created, r.eventType);
  assert.equal(due.responseDue, '2026-09-03 06:35:00');
});

test('讚揚內容 → N/A（無首次回應 SLA）', () => {
  const db = initDatabase();
  const { rules, mapping } = rulesOf(db);
  const r = computeEvent({ categories: ['MO_SERVICE'], content: '非常感謝保安陳先生熱心協助。' }, rules, mapping);
  assert.equal(r.eventType, 'N/A');
  const due = computeDueDates(db, new Date(), r.eventType);
  assert.equal(due.responseDue, null);
  assert.ok(due.closureDue);
});

test('二次投訴 → COMPLEX（2 小時）', () => {
  const db = initDatabase();
  const { rules, mapping } = rulesOf(db);
  const r = computeEvent({
    categories: ['MAINTENANCE'],
    content: '滴水問題仍未被處理，再次反映。',
    isSecondComplaint: true,
  }, rules, mapping);
  assert.equal(r.eventType, 'COMPLEX');
  const created = new Date(Date.UTC(2026, 8, 3, 6, 30, 0));
  const due = computeDueDates(db, created, r.eventType);
  assert.equal(due.responseDue, '2026-09-03 08:30:00');
});

test('查詢性質 → INSTANT', () => {
  const db = initDatabase();
  const { rules, mapping } = rulesOf(db);
  const r = computeEvent({ categories: ['MO_SERVICE'], content: '想請問管理處辦公時間。' }, rules, mapping);
  assert.equal(r.eventType, 'INSTANT');
  assert.equal(r.intentType, 'INQUIRY');
});
