'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const { generateCaseId } = require('../src/services/numbering');

function insertMinimal(db, caseId, createdAt = '2026-09-03 02:00:00') {
  db.prepare(
    `INSERT INTO \`case\`
     (case_id, case_status, event_type, priority, intent_type, category_code, estate_code,
      customer_title, customer_name, comment_content, incident_date, created_at)
     VALUES (?, 'PENDING', 'NORMAL', 'MEDIUM', 'FEEDBACK', 'OTHER', 'CHNG', '先生', '測試用戶', '測試內容', '2026-09-03', ?)`
  ).run(caseId, createdAt);
}

test('編號格式符合 {公司代碼}/{業務代碼}/{屋苑代碼}/{YYMMDD}{3位流水}', () => {
  const db = initDatabase();
  const estate = db.prepare('SELECT estate_code, company_code FROM sys_estate WHERE estate_code = ?').get('CHNG');
  const at = new Date(Date.UTC(2026, 8, 3, 2, 0, 0)); // 香港 260903 10:00
  const id = generateCaseId(db, estate, at);
  assert.equal(id, 'SMS/SR/CHNG/260903001');
  assert.match(id, /^[A-Z]+\/SR\/[A-Z]+\/\d{6}\d{3}$/);
});

test('同日流水遞增、跨日重設為 001', () => {
  const db = initDatabase();
  const estate = db.prepare('SELECT estate_code, company_code FROM sys_estate WHERE estate_code = ?').get('CHNG');
  const day1 = new Date(Date.UTC(2026, 8, 3, 2, 0, 0));
  const id1 = generateCaseId(db, estate, day1);
  insertMinimal(db, id1);
  const id2 = generateCaseId(db, estate, day1);
  assert.equal(id2, 'SMS/SR/CHNG/260903002');
  insertMinimal(db, id2);

  const day2 = new Date(Date.UTC(2026, 8, 4, 2, 0, 0));
  const id3 = generateCaseId(db, estate, day2);
  assert.equal(id3, 'SMS/SR/CHNG/260904001');
});

test('case_id 主鍵唯一約束存在（衝突被拒）', () => {
  const db = initDatabase();
  insertMinimal(db, 'SMS/SR/CHNG/260903777');
  assert.throws(() => insertMinimal(db, 'SMS/SR/CHNG/260903777'), /SQLITE_CONSTRAINT|UNIQUE/i);
});
