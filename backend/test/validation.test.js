'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const { validateFeedback } = require('../src/utils/validate');
const { estateOf } = require('../src/services/caseService');
const { ApiError } = require('../src/middlewares/error');

const meta = {
  titles: ['先生', '女士', '小姐', '太太', '不願透露', 'Mr.', 'Ms.', 'Miss', 'Mrs.', 'Prefer not to say'],
  maxLength: { name: 50, content: 1000, other: 50 },
};
const valid = {
  estate: 'CHNG', title: '先生', name: '陳大文', email: 'chan@example.com', phone: '',
  incidentDate: '2026-09-03', incidentTime: '14:30',
  categories: ['MAINTENANCE'], content: '大堂冷氣機滴水。', surveyConsent: true,
};
const fieldsOf = (errors) => errors.map((e) => e.field);

test('合法請求通過驗證', () => {
  assert.equal(validateFeedback(valid, meta).length, 0);
});

test('缺姓名/稱謂/內容 → 1002 對應欄位錯誤', () => {
  const errors = validateFeedback({ ...valid, title: '', name: '', content: ' ' }, meta);
  assert.ok(fieldsOf(errors).includes('title'));
  assert.ok(fieldsOf(errors).includes('name'));
  assert.ok(fieldsOf(errors).includes('content'));
});

test('電郵格式錯誤與電郵電話皆空', () => {
  const badEmail = validateFeedback({ ...valid, email: 'not-an-email' }, meta);
  assert.ok(fieldsOf(badEmail).includes('email'));
  const none = validateFeedback({ ...valid, email: '', phone: '' }, meta);
  assert.ok(fieldsOf(none).includes('contact'));
});

test('香港電話格式驗證（須 2/3/5/6/9 開頭 8 位）', () => {
  const bad = validateFeedback({ ...valid, email: '', phone: '12345678' }, meta);
  assert.ok(fieldsOf(bad).includes('phone'));
  const good = validateFeedback({ ...valid, email: '', phone: '+852 9123 4567' }, meta);
  assert.equal(good.length, 0);
});

test('事發日期不可為未來', () => {
  const errors = validateFeedback({ ...valid, incidentDate: '2999-01-01' }, meta);
  assert.ok(fieldsOf(errors).includes('incidentDate'));
});

test('類別規則：至少 1、最多 3、OTHER 需填寫說明', () => {
  const none = validateFeedback({ ...valid, categories: [] }, meta);
  assert.ok(fieldsOf(none).includes('categories'));
  const tooMany = validateFeedback({ ...valid, categories: ['A', 'B', 'C', 'D'] }, meta);
  assert.ok(fieldsOf(tooMany).includes('categories'));
  const badCode = validateFeedback({ ...valid, categories: ['FOO'] }, meta);
  assert.ok(fieldsOf(badCode).includes('categories'));
  const otherEmpty = validateFeedback({ ...valid, categories: ['OTHER'], otherText: '' }, meta);
  assert.ok(fieldsOf(otherEmpty).includes('otherText'));
  const otherOk = validateFeedback({ ...valid, categories: ['OTHER'], otherText: '其他事項說明' }, meta);
  assert.equal(otherOk.length, 0);
});

test('內容長度上限 1000 字', () => {
  const errors = validateFeedback({ ...valid, content: '字'.repeat(1001) }, meta);
  assert.ok(fieldsOf(errors).includes('content'));
});

test('屋苑不存在 → 1004 ApiError', () => {
  const db = initDatabase();
  assert.throws(
    () => estateOf(db, 'NO_SUCH'),
    (e) => e instanceof ApiError && e.code === 1004
  );
});
