/**
 * 清空個案及其關聯資料，並一併清除「與個案相關」的站內通知（維護腳本）。
 *
 * 只刪除資料記錄，保留模組程式碼與所有資料表結構。
 * 依外鍵「子表優先、父表最後」的順序 DELETE，並在交易內暫時關閉
 * foreign_keys（因 case 表有 original_case_id 自我參照），避免外鍵違例。
 * 通知部分：
 *  - 刪除 notif_type 屬 CASE/REMINDER/ESCALATION/SURVEY 的個案相關通知（所有帳號）；
 *  - 依權限：僅保留具 ADMIN 角色使用者的 SYSTEM 系統通知，刪除其餘（非 Admin）帳號的
 *    SYSTEM 通知（其他帳號不需要在通知中心看到 SYSTEM 公告）。
 *
 * 用法：node backend/scripts/clearCaseData.js
 * 注意：執行前請先停止後端（釋放 SQLite 寫入鎖）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function dbPath() {
  if (process.env.DB_PATH === ':memory:') return ':memory:';
  // 本腳本位於 backend/scripts，向上一層即 backend，再進 data。
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'qr_feedback.sqlite');
}

// 子表在前、父表在後（與 schema.sql 外鍵依賴方向相反）。
const TABLES = [
  'case_log_attachment',
  'case_log',
  'ai_feedback_insight',
  'satisfaction_survey',
  'ai_suggestion',
  'ai_case_risk',
  'ai_embedding',
  'case',
];

// 條件式刪除：僅清除與個案相關的通知，保留 SYSTEM 系統公告。
const CONDITIONAL_DELETES = [
  {
    table: 'notification',
    where: "notif_type IN ('CASE','REMINDER','ESCALATION','SURVEY')",
    label: 'notification(個案相關)',
  },
];

// 取得具 ADMIN 角色（role_code='ADMIN'）的使用者 ID 清單。
function getAdminUserIds(db) {
  const rows = db
    .prepare(
      `SELECT DISTINCT ur.user_id AS userId
         FROM sys_user_role ur
         JOIN sys_role r ON r.role_id = ur.role_id
         JOIN sys_user u ON u.user_id = ur.user_id
        WHERE r.role_code = 'ADMIN' AND r.is_active = 1 AND u.is_active = 1`
    )
    .all();
  return rows.map((x) => x.userId);
}

// 依權限刪除非 Admin 使用者的 SYSTEM 通知，保留 Admin 的 SYSTEM 通知。
function deleteNonAdminSystemNotifications(db, results) {
  const adminIds = getAdminUserIds(db);
  let n = 0;
  try {
    if (adminIds.length === 0) {
      // 防呆：無 Admin 時全部清掉，避免 NOT IN () 語法錯誤。
      n = db.prepare("DELETE FROM notification WHERE notif_type = 'SYSTEM'").run().changes;
    } else {
      const placeholders = adminIds.map(() => '?').join(',');
      n = db
        .prepare(`DELETE FROM notification WHERE notif_type = 'SYSTEM' AND user_id NOT IN (${placeholders})`)
        .run(...adminIds).changes;
    }
  } catch (e) {
    console.warn(`[clearCaseData] 跳過非 Admin SYSTEM 通知刪除：${e.message}`);
    n = 0;
  }
  results['notification(SYSTEM,非Admin)'] = n;
  results['adminUserIdCount'] = adminIds.length;
}

function main() {
  const p = dbPath();
  if (p !== ':memory:' && !fs.existsSync(p)) {
    console.error(`[clearCaseData] 找不到資料庫檔案：${p}`);
    process.exit(1);
  }

  const db = new Database(p);
  console.log(`[clearCaseData] 已開啟資料庫：${p}`);

  const results = {};
  const txn = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    for (const t of TABLES) {
      let n = 0;
      try {
        n = db.prepare(`DELETE FROM \`${t}\``).run().changes;
      } catch (e) {
        // 若某表不存在（相容不同版本 schema），記為 0 並提示。
        console.warn(`[clearCaseData] 跳過資料表 ${t}：${e.message}`);
        n = 0;
      }
      results[t] = n;
    }
    for (const c of CONDITIONAL_DELETES) {
      let n = 0;
      try {
        n = db.prepare(`DELETE FROM \`${c.table}\` WHERE ${c.where}`).run().changes;
      } catch (e) {
        console.warn(`[clearCaseData] 跳過條件刪除 ${c.label}：${e.message}`);
        n = 0;
      }
      results[c.label] = n;
    }
    deleteNonAdminSystemNotifications(db, results);
    db.pragma('foreign_keys = ON');
  });

  try {
    txn();
  } catch (e) {
    console.error(`[clearCaseData] 交易失敗，已回滾：${e.message}`);
    process.exit(1);
  } finally {
    db.close();
  }

  console.log('[clearCaseData] 已清空下列資料表（筆數）：');
  for (const t of TABLES) {
    console.log(`  - ${t.padEnd(22)} ${results[t]}`);
  }
  for (const c of CONDITIONAL_DELETES) {
    console.log(`  - ${c.label.padEnd(22)} ${results[c.label]}`);
  }
  console.log(`  - ${'notification(SYSTEM,非Admin)'.padEnd(22)} ${results['notification(SYSTEM,非Admin)']} (保留 Admin 數=${results.adminUserIdCount})`);
  console.log('[clearCaseData] 完成。模組程式碼與資料表結構保持不變；僅 Admin 保留 SYSTEM 系統通知。');
}

main();
