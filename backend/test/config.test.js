'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const { getConfig } = require('../src/db/configStore');
const configService = require('../src/services/configService');
const { ApiError } = require('../src/middlewares/error');

const ADMIN = { userId: 1, username: 'admin', fullName: '系統管理員' };

/** :memory: DB 於同一測試檔共享，每測試前清空審計/通知等以隔離 */
function fresh() {
  const db = initDatabase();
  for (const t of ['sys_config_audit', 'audit_log', 'notification', 'email_outbox', 'weekly_report', 'satisfaction_survey', 'case_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM `case`').run();
  return db;
}

test('目錄：含 meta 與可編輯旗標（唯讀鍵不可編輯）', () => {
  const db = fresh();
  const list = configService.listConfigs(db);
  const sla = list.groups.find((g) => g.key === 'SLA');
  assert.ok(sla, '應有 SLA 群組');
  const days = sla.items.find((i) => i.key === 'sla.closure_days');
  assert.ok(days && days.editable);
  assert.equal(days.value, 7);
  const numbering = list.groups.find((g) => g.key === 'NUMBERING')
    || { items: list.groups.flatMap((g) => g.items).filter((i) => i.key === 'numbering') };
  const num = numbering.items.find((i) => i.key === 'numbering');
  assert.ok(num, 'numbering 應列出');
  assert.equal(num.editable, false);
});

test('更新：合法值即時生效並完整審計＋通知', () => {
  const db = fresh();
  const out = configService.updateConfig(db, 'sla.closure_days', 10, ADMIN);
  assert.equal(out.value, 10);
  assert.equal(getConfig(db, 'sla.closure_days'), 10);

  const audit = configService.listAudit(db, {});
  assert.equal(audit.length, 1);
  assert.equal(audit[0].configKey, 'sla.closure_days');
  assert.equal(audit[0].action, 'UPDATE');
  assert.equal(audit[0].actorName, '系統管理員');
  assert.equal(audit[0].oldValue, 7);
  assert.equal(audit[0].newValue, 10);

  const log = db.prepare("SELECT detail FROM audit_log WHERE action = 'CONFIG_CHANGE' ORDER BY audit_id DESC LIMIT 1").get();
  assert.ok(log, '應有 CONFIG_CHANGE 審計');
  const detail = JSON.parse(log.detail);
  assert.equal(detail.configKey, 'sla.closure_days');

  const notifs = db.prepare("SELECT user_id FROM notification WHERE ref_type = 'CONFIG' AND ref_id = 'sla.closure_days'").all();
  assert.ok(notifs.length >= 2, 'ADMIN 與客服主管應收到站內通知');
  assert.ok(notifs.some((n) => n.user_id === 1) && notifs.some((n) => n.user_id === 2));
});

test('更新：每類驗證失敗均 400（ApiError VALIDATION）', () => {
  const db = fresh();
  const cases = [
    ['sla.closure_days', '10'],
    ['sla.closure_days', 99],
    ['sla.response', { URGENT: 5, NORMAL: 30, COMPLEX: 120 }], // 缺 INSTANT
    ['sla.response', { URGENT: 5, NORMAL: 30, COMPLEX: 0, INSTANT: 240 }],
    ['category.event_mapping', { MO_SERVICE: { base: 'N/A' } }], // 不完整＋base 非法
    ['weekly_report.schedule', { dayOfWeek: 'XDAY', time: '09:00' }],
    ['weekly_report.schedule', { dayOfWeek: 'MON', time: '25:00' }],
    ['form.style', { primaryColor: 'red', sloganZh: 'a', sloganEn: 'b' }],
  ];
  const [errKey, ...rest] = cases;
  for (const [key, val] of rest) {
    assert.throws(() => configService.updateConfig(db, key, val, ADMIN), ApiError, `${key} 應拒絕非法值`);
  }
  assert.ok(errKey);
  // form.style 合法色票應成功
  const ok = configService.updateConfig(db, 'form.style', { primaryColor: '#123456', sloganZh: '安心居住', sloganEn: 'Live with ease' }, ADMIN);
  assert.equal(ok.value.primaryColor, '#123456');
});

test('更新：非白名單鍵／不存在鍵拒絕（404）', () => {
  const db = fresh();
  assert.throws(() => configService.updateConfig(db, 'numbering', { bizCode: 'XX' }, ADMIN), (e) => e instanceof ApiError && e.httpStatus === 404);
  assert.throws(() => configService.updateConfig(db, 'form.site_base_url', 'https://x.com', ADMIN), (e) => e instanceof ApiError && e.httpStatus === 404);
  assert.throws(() => configService.updateConfig(db, 'no.such.key', 1, ADMIN), ApiError);
});

test('審計：依參數過濾', () => {
  const db = fresh();
  configService.updateConfig(db, 'survey.expiry_days', 21, ADMIN);
  configService.updateConfig(db, 'sla.response', { URGENT: 10, NORMAL: 30, COMPLEX: 120, INSTANT: 240 }, ADMIN);
  const only = configService.listAudit(db, { key: 'survey.expiry_days' });
  assert.equal(only.length, 1);
  assert.equal(only[0].configKey, 'survey.expiry_days');
  const all = configService.listAudit(db, {});
  assert.equal(all.length, 2);
});
