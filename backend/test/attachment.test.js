/**
 * 附件管理（service 層單元測試，不含 AI）。
 * 涵蓋：上傳（成功/邊界驗證）、下載（跨苑/不存在/實體遺失）、刪除（成功＋稽核＋實體清理）、
 * 以及 CLOSED/RESOLVED/PENDING 對上傳/刪除的阻擋。對應本次修正的「附件刪除」回歸。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const caseService = require('../src/services/caseService');
const { ERR } = require('../src/config/constants');
const { freshDb, uid, insertCase, user, notes } = require('./helpers/casesFixtures');

/** 將附件寫入臨時目錄，避免污染 data/uploads；每個測試獨立清理 */
function withUploadDir(fn) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'case-att-'));
  process.env.UPLOAD_DIR = tmp;
  try {
    fn(tmp);
  } finally {
    delete process.env.UPLOAD_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test('上傳：成功寫 UPLOAD 時間軸＋實體檔可讀', () => {
  withUploadDir((tmp) => {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
    const up = caseService.uploadCaseAttachment(db, id, staff, { name: '證據.png', data: PNG });
    assert.ok(up.attachmentId);
    assert.equal(up.fileName, '證據.png');
    assert.ok(notes(db, id).some((n) => n.logType === 'UPLOAD'));
    const meta = db.prepare('SELECT file_type AS t, storage_key AS k FROM case_log_attachment WHERE attachment_id = ?').get(up.attachmentId);
    assert.equal(meta.t, 'png');
    assert.ok(existsSync(path.join(tmp, id, meta.k)));
    const dl = caseService.downloadCaseAttachment(db, id, up.attachmentId, staff);
    assert.equal(dl.fileName, '證據.png');
    assert.deepEqual(readFileSync(dl.absPath), PNG);
  });
});

test('上傳：非法副檔名／超大小／空檔／非 buffer 全拋 ATTACH_INVALID(4009)/400', () => {
  withUploadDir(() => {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'evil.exe', data: Buffer.from('x') }), (e) => e.code === ERR.ATTACH_INVALID && e.httpStatus === 400);
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'big.png', data: Buffer.alloc(11 * 1024 * 1024) }), (e) => e.code === ERR.ATTACH_INVALID);
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'empty.png', data: null }), (e) => e.code === ERR.ATTACH_INVALID);
    assert.throws(() => caseService.uploadCaseAttachment(db, id, staff, { name: 'y.png', data: 'notbuffer' }), (e) => e.code === ERR.ATTACH_INVALID);
  });
});

test('上傳/刪除：CLOSED、RESOLVED、PENDING 皆被阻擋(STATE_TRANSITION 3002)', () => {
  withUploadDir(() => {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    for (const st of ['CLOSED', 'RESOLVED', 'PENDING']) {
      const id = insertCase(db, { status: st });
      assert.throws(
        () => caseService.uploadCaseAttachment(db, id, staff, { name: 'a.png', data: PNG }),
        (e) => e.code === ERR.STATE_TRANSITION,
        `upload on ${st}`
      );
    }
  });
});

test('下載：跨屋苑被拒(3004)/403；附件不存在 404；實體檔遺失 500', () => {
  withUploadDir((tmp) => {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    const ypr = user(uid(db, 'ypr_sup'), 'ypr_sup', 'YPR');
    const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
    const up = caseService.uploadCaseAttachment(db, id, staff, { name: 'a.png', data: PNG });
    assert.throws(() => caseService.downloadCaseAttachment(db, id, up.attachmentId, ypr), (e) => e.code === ERR.DATA_SCOPE && e.httpStatus === 403);
    assert.throws(() => caseService.downloadCaseAttachment(db, id, 99999, staff), (e) => e.code === ERR.CASE_NOT_FOUND && e.httpStatus === 404);
    const key = db.prepare('SELECT storage_key FROM case_log_attachment WHERE attachment_id=?').get(up.attachmentId).storage_key;
    unlinkSync(path.join(tmp, id, key)); // 模擬實體檔遺失
    assert.throws(() => caseService.downloadCaseAttachment(db, id, up.attachmentId, staff), (e) => e.code === ERR.INTERNAL && e.httpStatus === 500);
  });
});

test('刪除：成功移除 DB 紀錄＋實體檔＋解除 case_log 關聯，並寫 OTHER 時間軸與審計', () => {
  withUploadDir((tmp) => {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
    const up = caseService.uploadCaseAttachment(db, id, staff, { name: 'a.png', data: PNG });
    const key = db.prepare('SELECT storage_key FROM case_log_attachment WHERE attachment_id=?').get(up.attachmentId).storage_key;
    assert.ok(existsSync(path.join(tmp, id, key)));

    const r = caseService.deleteCaseAttachment(db, id, staff, up.attachmentId);
    assert.equal(r.attachmentId, up.attachmentId);
    // DB 紀錄移除
    assert.equal(db.prepare('SELECT COUNT(*) c FROM case_log_attachment WHERE attachment_id=?').get(up.attachmentId).c, 0);
    // 實體檔移除
    assert.ok(!existsSync(path.join(tmp, id, key)));
    // case_log.attachment_id 解除
    assert.equal(db.prepare('SELECT COUNT(*) c FROM case_log WHERE attachment_id=?').get(up.attachmentId).c, 0);
    // 時間軸寫 OTHER 且內容含「刪除附件」（註：實際 log_type 為 OTHER，非 UPLOAD_REMOVE）
    const delLog = db.prepare("SELECT log_type, log_content AS logContent FROM case_log WHERE case_id=? AND log_type='OTHER' ORDER BY log_id DESC LIMIT 1").get(id);
    assert.ok(delLog && delLog.logContent.includes('刪除附件'));
    // 審計
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='CASE_ATTACHMENT_DELETE' AND target_id=?").get(id));
  });
});

test('刪除：附件不存在拋 404(3001)；CLOSED/RESOLVED/PENDING 阻擋(3002)', () => {
  withUploadDir(() => {
    const db = freshDb();
    const staff = user(uid(db, 'chng_staff'), 'chng_staff', 'CHNG');
    const id = insertCase(db, { status: 'ASSIGNED', assignedTo: staff.userId });
    assert.throws(() => caseService.deleteCaseAttachment(db, id, staff, 99999), (e) => e.code === ERR.CASE_NOT_FOUND && e.httpStatus === 404);
    for (const st of ['CLOSED', 'RESOLVED', 'PENDING']) {
      const other = insertCase(db, { status: st });
      assert.throws(
        () => caseService.deleteCaseAttachment(db, other, staff, 1),
        (e) => e.code === ERR.STATE_TRANSITION,
        `delete on ${st}`
      );
    }
  });
});
