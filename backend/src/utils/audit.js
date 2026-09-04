/**
 * 操作審計寫入（append-only）。
 * audit_log 對應規格書 7.3.6：不可篡改、保留 1 年。
 * 所有關鍵操作（登入/建案/分派/狀態變更/參數變更/用戶與角色管理/匯出）皆經此寫入。
 */
'use strict';

function writeAudit(db, { userId, username, action, targetType, targetId, detail }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId == null ? null : userId,
    username || 'SYSTEM',
    action,
    targetType || null,
    targetId == null ? null : String(targetId),
    detail == null ? null : JSON.stringify(detail)
  );
}

module.exports = { writeAudit };
