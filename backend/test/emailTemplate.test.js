'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const tpl = require('../src/services/emailTemplateService');
const configService = require('../src/services/configService');

const ADMIN = { userId: 1, username: 'admin', fullName: '系統管理員' };

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

function insertOutbox(db, { status = 'PENDING', subject = 'S', body = 'B' } = {}) {
  const info = db.prepare(
    "INSERT INTO email_outbox (case_id, template, recipient, lang, subject, body, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(null, 'satisfaction_survey', 'a@b.com', 'zh-Hant', subject, body, status);
  return info.lastInsertRowid;
}

test('renderEmailTemplate：無設定時用內建並替換佔位符', () => {
  const db = freshDb();
  const out = tpl.renderEmailTemplate(db, 'satisfaction_survey', 'zh-Hant', {
    case_id: 'S999',
    estate_name: '黄埔花园',
    survey_link: 'http://x/survey/tok',
    expires: '2026-12-31',
  });
  assert.match(out.subject, /S999/);
  assert.match(out.subject, /黄埔花园/);
  assert.match(out.body, /http:\/\/x\/survey\/tok/);
  assert.match(out.body, /2026-12-31/);
  assert.ok(!out.subject.includes('{{'));
});

test('renderEmailTemplate：sys_config 覆寫優先於內建', () => {
  const db = freshDb();
  configService.updateConfig(db, 'email.template.satisfaction_survey.zh', {
    subject: 'CFG 主旨 {{case_id}}',
    body: 'CFG <b>{{estate_name}}</b> 連結 {{survey_link}}',
  }, ADMIN);
  const out = tpl.renderEmailTemplate(db, 'satisfaction_survey', 'zh', {
    case_id: 'S7',
    estate_name: '美孚新邨',
    survey_link: 'http://x/s',
    expires: '2099-01-01',
  });
  assert.equal(out.subject, 'CFG 主旨 S7');
  assert.equal(out.body, 'CFG <b>美孚新邨</b> 連結 http://x/s');
});

test('renderEmailTemplate：未知變數保留原樣；en 語系正規化', () => {
  const db = freshDb();
  const out = tpl.renderEmailTemplate(db, 'satisfaction_survey', 'en', {
    case_id: 'S1',
    estate_name: 'Estate',
    survey_link: 'http://x',
    expires: '2099',
  });
  assert.ok(!out.body.includes('{{case_id}}'));
  assert.match(out.subject, /Feedback Survey/);
});

test('getEffectiveTemplate：管理頁可取得有效範本（含內建佔位符）', () => {
  const db = freshDb();
  const e = tpl.getEffectiveTemplate(db, 'satisfaction_survey_reminder', 'en');
  assert.ok(e.subject.length > 0 && e.body.length > 0);
  assert.ok(e.body.includes('{{expires}}'), '內建範本應含未替換佔位符');
});

test('sanitizeHtml：移除 <script> 與 on* 屬性', () => {
  const dirty = '<p onclick="evil()">hi</p><script>alert(1)</script><a href="x">link</a>';
  const clean = tpl.sanitizeHtml(dirty);
  assert.ok(!/script/i.test(clean));
  assert.ok(!/onclick/i.test(clean));
  assert.ok(clean.includes('<a href="x">link</a>'));
});

test('updateOutboxContent：正常更新並清理 XSS', () => {
  const db = freshDb();
  const id = insertOutbox(db, { status: 'FAILED' });
  const r = tpl.updateOutboxContent(db, id, {
    subject: '<script>x</script>標題',
    body: '<b>内容</b><img src=x onerror=alert(1)>',
  });
  assert.equal(r.subject, '標題');
  assert.ok(!/onerror/i.test(r.body));
  assert.ok(r.body.includes('<b>内容</b>'));
  const row = db.prepare('SELECT subject, body FROM email_outbox WHERE outbox_id = ?').get(id);
  assert.equal(row.subject, '標題');
});

test('updateOutboxContent：已 SENT 不可編輯', () => {
  const db = freshDb();
  const id = insertOutbox(db, { status: 'SENT' });
  assert.throws(() => tpl.updateOutboxContent(db, id, { subject: 's', body: 'b' }), /已寄出/);
});

test('updateOutboxContent：缺欄位 / 不存在 拋錯', () => {
  const db = freshDb();
  const id = insertOutbox(db);
  assert.throws(() => tpl.updateOutboxContent(db, id, { subject: 's' }), /必填/);
  assert.throws(() => tpl.updateOutboxContent(db, 99999, { subject: 's', body: 'b' }), /不存在/);
});

test('updateOutboxContent：內文超 64KB 拒絕', () => {
  const db = freshDb();
  const id = insertOutbox(db);
  const big = 'x'.repeat(tpl.MAX_BODY_LEN + 1);
  assert.throws(() => tpl.updateOutboxContent(db, id, { subject: 's', body: big }), /過長/);
});
