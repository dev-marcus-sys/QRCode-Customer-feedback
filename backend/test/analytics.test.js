'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const analytics = require('../src/services/analyticsService');

/** :memory: DB 於同一測試檔共享，每測試前清空業務表以隔離 */
function fresh() {
  const db = initDatabase();
  for (const t of ['sys_config_audit', 'audit_log', 'notification', 'email_outbox', 'weekly_report', 'satisfaction_survey', 'case_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM `case`').run();
  return db;
}

// HK 2026-09-04（週五）
const NOW = new Date('2026-09-04T03:00:00Z');

const ALL_USER = { userId: 0, username: 'T', fullName: '測試', estateCode: 'ALL' };

function ins(db, over = {}) {
  const r = {
    case_id: 'SR20260801001',
    case_source: 'QR', case_status: 'CLOSED', event_type: 'NORMAL', priority: 'MEDIUM',
    intent_type: 'COMPLAINT', category_code: 'MAINTENANCE', estate_code: 'CWC',
    customer_title: '先生', customer_name: '測試', incident_date: '2026-08-01',
    comment_content: '測試內容', created_at: '2026-08-03 01:00:00',
    satisfaction_consent: 1,
    ...over,
  };
  const cols = Object.keys(r);
  db.prepare(`INSERT INTO \`case\` (${cols.join(',')}) VALUES (${cols.map((k) => `@${k}`).join(',')})`).run(r);
}

function log(db, caseId, content, over = {}) {
  db.prepare(
    `INSERT INTO case_log (case_id, log_type, log_content, new_status, action_by, action_at)
     VALUES (@case_id, @log_type, @log_content, @new_status, @action_by, @action_at)`
  ).run({ case_id: caseId, log_type: 'STATUS_CHANGE', log_content: content, new_status: 'IN_PROGRESS', action_by: 2, action_at: '2026-08-03 02:00:00', ...over });
}

function survey(db, over = {}) {
  const r = {
    case_id: 'SR20260801001', survey_token: `tk_${Math.random().toString(36).slice(2, 10)}`,
    expires_at: '2026-09-01 00:00:00', status: 'SENT', ...over,
  };
  const cols = Object.keys(r);
  db.prepare(`INSERT INTO satisfaction_survey (${cols.join(',')}) VALUES (${cols.map((k) => `@${k}`).join(',')})`).run(r);
}

function kpiOf(s, key) {
  return s.kpi.find((k) => k.key === key);
}

test('summary：KPI 數值與上期比較（custom 期間）', () => {
  const db = fresh();
  ins(db, {
    case_id: 'SR-A1', estate_code: 'CWC', case_source: 'QR', intent_type: 'COMPLAINT', category_code: 'MAINTENANCE',
    event_type: 'NORMAL', created_at: '2026-08-03 01:00:00', assigned_to: 2, assigned_at: '2026-08-03 01:05:00',
    first_response_at: '2026-08-03 01:10:00', response_sla_due: '2026-08-03 01:30:00', response_sla_met: 1,
    closed_at: '2026-08-04 02:00:00', closure_sla_due: '2026-08-10 01:00:00', closure_sla_met: 1, handling_days: 1.2,
  });
  log(db, 'SR-A1', '開始處理');
  ins(db, {
    case_id: 'SR-A2', estate_code: 'CHNG', case_source: 'CC', intent_type: 'COMPLIMENT', category_code: 'SECURITY',
    event_type: 'N/A', created_at: '2026-08-05 03:00:00',
    closed_at: '2026-08-06 03:00:00', closure_sla_due: '2026-08-12 03:00:00', closure_sla_met: 1, handling_days: 0.5,
  });
  ins(db, {
    case_id: 'SR-A3', estate_code: 'YPR', case_source: 'QR', intent_type: 'INQUIRY', category_code: 'MO_SERVICE',
    event_type: 'NORMAL', case_status: 'IN_PROGRESS', created_at: '2026-08-10 04:00:00', assigned_to: 2,
    assigned_at: '2026-08-10 04:05:00', first_response_at: '2026-08-10 04:30:00',
    response_sla_due: '2026-08-10 06:00:00', response_sla_met: 1, closure_sla_due: '2026-12-01 00:00:00',
  });

  const s = analytics.summary(db, ALL_USER, { range: 'custom', from: '2026-08-01', to: '2026-08-31' }, { nowMs: NOW.getTime() });
  assert.equal(s.kpi.length, 12);
  assert.equal(s.range.labelZh, '自訂區間');

  assert.equal(kpiOf(s, 'KPI_01').value, 3);              // 期間建案 3 宗（上期無 → delta 3）
  assert.equal(kpiOf(s, 'KPI_01').delta, 3);
  assert.equal(kpiOf(s, 'KPI_03').value, 1);              // 未關閉 1 宗（SR-A3）
  assert.equal(kpiOf(s, 'KPI_04').value, 2);              // QR 提交 2 宗
  assert.equal(kpiOf(s, 'KPI_02').value, 0.9);            // (1.2+0.5)/2
  assert.equal(kpiOf(s, 'KPI_02').met, true);             // ≤ 3 天目標
  assert.equal(kpiOf(s, 'KPI_06').value, 100);            // 分母排除 N/A
  assert.equal(kpiOf(s, 'KPI_07').value, 100);
  assert.equal(kpiOf(s, 'KPI_11').value, 0);
  assert.equal(kpiOf(s, 'KPI_11').delta, null);           // 實時值無上期比較
  assert.equal(kpiOf(s, 'KPI_12').value, 0.9);            // 分派→首次處理 55 分鐘

  const st = s.statusCounts.find((x) => x.status === 'CLOSED');
  assert.equal(st.count, 2);
  assert.equal(s.anomalySummary.OVERDUE, 0);
});

test('summary：數據範圍（ESTATE 鎖定）與日期過濾', () => {
  const db = fresh();
  ins(db, { case_id: 'SR-B1', estate_code: 'YPR', case_status: 'CLOSED', created_at: '2026-08-02 01:00:00' });
  ins(db, { case_id: 'SR-B2', estate_code: 'CHNG', case_status: 'CLOSED', created_at: '2026-08-03 01:00:00' });
  ins(db, { case_id: 'SR-B3', estate_code: 'YPR', case_status: 'CLOSED', created_at: '2026-07-20 01:00:00' });

  const allAug = analytics.summary(db, ALL_USER, { range: 'custom', from: '2026-08-01', to: '2026-08-31' }, { nowMs: NOW.getTime() });
  assert.equal(kpiOf(allAug, 'KPI_01').value, 2);

  // ESTATE 角色強制鎖定所屬屋苑（縱使傳入其他屋苑）
  const ypr = analytics.summary(db, { ...ALL_USER, estateCode: 'YPR' }, { range: 'custom', from: '2026-08-01', to: '2026-08-31', estate: 'CHNG' }, { nowMs: NOW.getTime() });
  assert.equal(kpiOf(ypr, 'KPI_01').value, 1);
  assert.equal(ypr.estate, 'YPR');

  const julyYpr = analytics.summary(db, { ...ALL_USER, estateCode: 'YPR' }, { range: 'custom', from: '2026-07-01', to: '2026-07-31' }, { nowMs: NOW.getTime() });
  assert.equal(kpiOf(julyYpr, 'KPI_01').value, 1);
});

test('趨勢（香港月）／分布／處理人員績效', () => {
  const db = fresh();
  // HK 08-04 07:30 建案、HK 08-05 08:30 關閉
  ins(db, { case_id: 'SR-C1', estate_code: 'CWC', created_at: '2026-08-03 23:30:00', closed_at: '2026-08-05 00:30:00', case_status: 'CLOSED', assigned_to: 2 });
  // HK 07-31 23:30 建案（UTC 07-31 15:30 +8h）→ 屬 7 月，不屬 8 月
  ins(db, { case_id: 'SR-C2', estate_code: 'YPR', created_at: '2026-07-31 15:30:00', case_status: 'IN_PROGRESS', assigned_to: 2 });
  ins(db, { case_id: 'SR-C3', estate_code: 'CHNG', case_status: 'IN_PROGRESS', created_at: '2026-08-15 01:00:00', assigned_to: 2 });

  const tr = analytics.trend(db, ALL_USER, {});
  assert.equal(tr.length, 12);
  const aug = tr.find((m) => m.ym === '2026-08');
  assert.ok(aug, '應含 2026-08');
  assert.equal(aug.created, 2); // HK 8 月：SR-C1＋SR-C3（SR-C2 於 HK 7 月底）
  assert.equal(aug.closed, 1);
  const jul = tr.find((m) => m.ym === '2026-07');
  assert.equal(jul.created, 1);

  const d = analytics.distributions(db, ALL_USER, { range: 'custom', from: '2026-08-01', to: '2026-08-31' });
  assert.equal(d.total, 2);
  const cat = d.category.find((c) => c.code === 'MAINTENANCE');
  assert.ok(cat, 'MAINTENANCE 分布應存在');
  assert.equal(cat.count, 2);
  const intent = d.intent.find((i) => i.code === 'COMPLAINT');
  assert.ok(intent, 'COMPLAINT 分布應存在');
  assert.equal(intent.count, 2);

  const h = analytics.handlers(db, ALL_USER, { range: 'custom', from: '2026-08-01', to: '2026-08-31' });
  const row = h.find((x) => x.userId === 2);
  assert.ok(row, '應有 assigned_to=2 之處理人員');
  assert.equal(row.fullName, '客服主管');
  assert.equal(row.caseCount, 2);
  assert.equal(row.closedCount, 1);
});

test('問卷 KPI 與異常清單', () => {
  const db = fresh();
  ins(db, { case_id: 'SR-D1', estate_code: 'YPR', case_status: 'CLOSED', created_at: '2026-08-01 01:00:00' });
  survey(db, { case_id: 'SR-D1', status: 'SUBMITTED', submitted_at: '2026-08-02 01:00:00', rating_overall: 2, is_low_score: 1 });
  ins(db, { case_id: 'SR-D2', estate_code: 'CHNG', case_status: 'CLOSED', created_at: '2026-08-05 01:00:00' });
  survey(db, { case_id: 'SR-D2', status: 'SUBMITTED', submitted_at: '2026-08-06 01:00:00', rating_overall: 5, is_low_score: 0 });
  ins(db, { case_id: 'SR-D3', estate_code: 'CWC', case_status: 'PENDING', created_at: '2026-08-07 01:00:00' });
  // 逾期（未回應）
  ins(db, {
    case_id: 'SR-D4', estate_code: 'YPR', case_status: 'IN_PROGRESS', created_at: '2026-08-03 01:00:00',
    response_sla_due: '2026-08-03 02:00:00', first_response_at: null,
  });
  // 二次投訴
  ins(db, { case_id: 'SR-D5', estate_code: 'CHNG', case_status: 'IN_PROGRESS', is_second_complaint: 1, created_at: '2026-08-04 01:00:00' });

  const s = analytics.summary(db, ALL_USER, { range: 'custom', from: '2026-08-01', to: '2026-08-31' }, { nowMs: NOW.getTime() });
  assert.equal(kpiOf(s, 'KPI_08').value, 100);            // 2/2 已回覆
  assert.equal(kpiOf(s, 'KPI_09').value, 3.5);            // (2+5)/2
  assert.equal(kpiOf(s, 'KPI_10').value, 50);             // 1/2 低分
  assert.equal(s.anomalySummary.OVERDUE, 1);
  assert.equal(s.anomalySummary.SECOND, 1);

  const an = analytics.anomalies(db, ALL_USER, {}, {});
  assert.equal(an.counts.OVERDUE, 1);
  assert.equal(an.counts.LOW_SCORE, 1);
  assert.equal(an.counts.SECOND, 1);
  const over = an.items.find((i) => i.type === 'OVERDUE');
  assert.equal(over.aspect, '首應逾期');
  assert.equal(over.caseId, 'SR-D4');
  const low = an.items.find((i) => i.type === 'LOW_SCORE');
  assert.equal(low.caseId, 'SR-D1');
});

test('CSV 匯出內容（BOM＋區段）', () => {
  const db = fresh();
  ins(db, { case_id: 'SR-E1', estate_code: 'CWC', case_status: 'CLOSED', created_at: '2026-08-02 01:00:00', assigned_to: 2 });
  const out = analytics.buildExportCsv(db, ALL_USER, { range: 'custom', from: '2026-08-01', to: '2026-08-31' });
  const text = out.buffer.toString('utf8');
  assert.ok(text.startsWith('\uFEFF'));
  assert.ok(text.includes('KPI'));
  assert.ok(text.includes('處理人員績效'));
  assert.ok(text.includes('異常清單'));
  assert.ok(out.filename.endsWith('.csv'));
});
