'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const weekly = require('../src/services/weeklyReportService');
const analytics = require('../src/services/analyticsService');

// 2026-09-07（週一）HK 09:05；上週＝2026-08-31（一）~ 09-06（日）
const MONDAY = new Date('2026-09-07T01:05:00Z');
const FRIDAY = new Date('2026-09-04T03:00:00Z');

/** :memory: DB 於同一測試檔共享，每測試前清空以隔離 */
function fresh() {
  const db = initDatabase();
  for (const t of ['sys_config_audit', 'audit_log', 'notification', 'email_outbox', 'weekly_report', 'satisfaction_survey', 'case_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM `case`').run();
  return db;
}

function ins(db, over = {}) {
  const r = {
    case_id: 'SR-W1', case_source: 'QR', case_status: 'CLOSED', event_type: 'NORMAL', priority: 'MEDIUM',
    intent_type: 'COMPLAINT', category_code: 'MAINTENANCE', estate_code: 'CWC',
    customer_title: '先生', customer_name: '測試', incident_date: '2026-08-31',
    comment_content: '測試', created_at: '2026-08-31 02:00:00',
    ...over,
  };
  const cols = Object.keys(r);
  db.prepare(`INSERT INTO \`case\` (${cols.join(',')}) VALUES (${cols.map((k) => `@${k}`).join(',')})`).run(r);
}

test('產生上週週報：週報記錄＋email_outbox 佇列（6 收件人）', () => {
  const db = fresh();
  ins(db, { case_id: 'SR-W1', estate_code: 'CWC', created_at: '2026-08-31 02:00:00' });
  ins(db, { case_id: 'SR-W2', estate_code: 'CHNG', case_status: 'IN_PROGRESS', created_at: '2026-09-01 03:00:00' });

  const out = weekly.generateWeeklyReport(db, { nowMs: MONDAY.getTime(), actor: { userId: 0, username: 'SYSTEM' } });
  assert.equal(out.duplicate, false);
  assert.equal(out.report.periodStart, '2026-08-31');
  assert.equal(out.report.periodEnd, '2026-09-06');
  assert.equal(out.recipients, 6); // ADMIN + CC_SUPERVISOR + 4 屋苑主管
  assert.equal(out.emailQueued, 6);

  const row = db.prepare('SELECT * FROM weekly_report WHERE period_key = ?').get('2026-08-31');
  assert.ok(row);
  const sum = JSON.parse(row.summary_json);
  assert.equal(sum.kpi.find((k) => k.key === 'KPI_01').value, 2);
  assert.ok(sum.kpi.length === 12);
  assert.ok(JSON.parse(row.anomaly_json).length === 0);

  const emails = db.prepare("SELECT recipient, subject FROM email_outbox WHERE template = 'weekly_report'").all();
  assert.equal(emails.length, 6);
  assert.ok(emails.every((e) => e.subject.includes('2026-08-31 ~ 2026-09-06')));

  const audit = db.prepare("SELECT detail FROM audit_log WHERE action = 'WEEKLY_REPORT'").all();
  assert.ok(audit.length === 1);
});

test('重複產生同週：duplicate 且不重寫、不再佇列', () => {
  const db = fresh();
  ins(db, { case_id: 'SR-W1', estate_code: 'CWC', created_at: '2026-09-01 02:00:00' });
  weekly.generateWeeklyReport(db, { nowMs: MONDAY.getTime() });
  const again = weekly.generateWeeklyReport(db, { nowMs: MONDAY.getTime() });
  assert.equal(again.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM weekly_report').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM email_outbox').get().c, 6);
});

test('異常項目寫入週報 anomaly_json', () => {
  const db = fresh();
  ins(db, {
    case_id: 'SR-X1', estate_code: 'YPR', case_status: 'IN_PROGRESS', created_at: '2026-09-01 01:00:00',
    response_sla_due: '2026-09-01 02:00:00', first_response_at: null,
  });
  const out = weekly.generateWeeklyReport(db, { nowMs: MONDAY.getTime() });
  assert.equal(out.duplicate, false);
  const row = db.prepare('SELECT anomaly_json FROM weekly_report WHERE period_key = ?').get('2026-08-31');
  const items = JSON.parse(row.anomaly_json);
  assert.ok(items.some((i) => i.type === 'OVERDUE' && i.caseId === 'SR-X1'));
});

test('maybeRunWeekly：非時段不跑；週一 09:00–09:10 視窗內產生；重複略過', () => {
  const db = fresh();
  ins(db, { case_id: 'SR-W1', estate_code: 'CWC', created_at: '2026-09-01 02:00:00' });

  const fri = weekly.maybeRunWeekly(db, FRIDAY.getTime());
  assert.equal(fri.ran, false);
  assert.equal(fri.reason, 'not_in_window');

  const mon = weekly.maybeRunWeekly(db, MONDAY.getTime());
  assert.equal(mon.ran, true);
  assert.equal(mon.report.periodStart, '2026-08-31');

  const again = weekly.maybeRunWeekly(db, MONDAY.getTime());
  assert.equal(again.ran, false);
  assert.equal(again.reason, 'already_generated');
});

test('排程可於 F-009 配置（如改為週五 09:00）', () => {
  const db = fresh();
  db.prepare("UPDATE sys_config SET config_value = ? WHERE config_key = 'weekly_report.schedule'")
    .run(JSON.stringify({ dayOfWeek: 'FRI', time: '09:00' }));
  const { generateWeeklyReport } = weekly;
  // 週五 HK 11:00（FRI 09:00 視窗已過）→ 不會跑；測試直接產生以確認參數不影響內容
  assert.equal(weekly.maybeRunWeekly(db, FRIDAY.getTime()).reason, 'not_in_window');
  const cfg = weekly.maybeRunWeekly(db, new Date('2026-09-04T01:03:00Z').getTime()); // HK 09:03 週五
  assert.equal(cfg.ran, true);
  // 上週為 2026-08-24~08-30
  const lw = analytics.lastWeekRange(new Date('2026-09-04T01:03:00Z').getTime());
  assert.equal(lw.from, '2026-08-24');
  assert.equal(lw.to, '2026-08-30');
  generateWeeklyReport(db, { nowMs: new Date('2026-09-04T01:03:00Z').getTime() });
});
