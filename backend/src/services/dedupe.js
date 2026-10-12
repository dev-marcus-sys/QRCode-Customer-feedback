/**
 * 防重複提交與二次投訴識別（FR-001-05 / 規格書 6.5）。
 * - 10 分鐘同內容重複：同一聯絡人（email 優先，其次電話）＋規範化內容相同
 * - 24 小時二次投訴：同一聯絡人＋同屋苑＋事項類別有交集 → 關聯原案、優先級 HIGH
 */
'use strict';
const { normalizeContent } = require('../utils/hash');
const { toDb, parseDb } = require('../utils/time');

function identifierOf({ email, phone, name, unit }) {
  if (email) return { field: 'customer_email', value: String(email).trim().toLowerCase() };
  if (phone) return { field: 'customer_phone', value: String(phone).replace(/[\s\-()]/g, '') };
  if (name && unit) return { field: 'unit', value: `${String(name).trim()}|${String(unit).trim()}` };
  return null;
}

/** 10 分鐘內同內容重複：回傳既有案號或 null */
function findDuplicate(db, payload, nowMs = Date.now()) {
  const id = identifierOf(payload);
  if (!id) return null;
  const since = toDb(new Date(nowMs - 10 * 60 * 1000));
  const rows =
    id.field === 'unit'
      ? db.prepare(
          `SELECT case_id, comment_content FROM \`case\`
            WHERE created_at >= ? AND customer_name = ? AND customer_unit = ?
            ORDER BY created_at DESC LIMIT 20`
        ).all(since, payload.name, payload.unit)
      : db.prepare(
          `SELECT case_id, comment_content FROM \`case\`
            WHERE created_at >= ? AND ${id.field} = ?
            ORDER BY created_at DESC LIMIT 20`
        ).all(since, id.value);
  const needle = normalizeContent(payload.content);
  const hit = rows.find((r) => normalizeContent(r.comment_content) === needle);
  return hit || null;
}

/** 24 小時二次投訴：回傳原案 row 或 null（視窗長度可配置；排除已結案原案；收緊為同類別＋同單位） */
function findSecondComplaint(db, payload, nowMs = Date.now(), windowHours = 24) {
  const id = identifierOf(payload);
  if (!id || id.field === 'unit') return null; // 無電郵/電話時僅提示人工確認（6.5）
  const since = toDb(new Date(nowMs - windowHours * 60 * 60 * 1000));
  const cats = Array.isArray(payload.categories) ? payload.categories : [];
  if (cats.length === 0) return null;
  const placeholders = cats.map(() => '?').join(',');
  const estateCode = payload.estate || payload.estate_code;
  // 收緊：提交含 block/floor/unit 時，要求原案單位一致（任一提供即比對；原案該欄為 NULL 則不符）
  const addr = payload.address || {};
  const addrClauses = [];
  const addrParams = [];
  ['block', 'floor', 'unit'].forEach((f) => {
    const v = addr[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      addrClauses.push(`customer_${f} = ?`);
      addrParams.push(String(v).trim());
    }
  });
  const addrSql = addrClauses.length ? ` AND ${addrClauses.join(' AND ')}` : '';
  const closedSql = " AND case_status NOT IN ('RESOLVED','CLOSED')";
  const sqlFor = (field) =>
    `SELECT * FROM \`case\`
       WHERE created_at >= ? AND ${field} = ? AND estate_code = ?
         AND category_code IN (${placeholders})
         ${closedSql}${addrSql}
       ORDER BY created_at DESC LIMIT 1`;
  const params = [since, id.value, estateCode, ...cats, ...addrParams];
  const rows =
    id.field === 'customer_email'
      ? db.prepare(sqlFor('customer_email')).all(...params)
      : db.prepare(sqlFor('customer_phone')).all(...params);
  return rows[0] || null;
}

module.exports = { findDuplicate, findSecondComplaint, identifierOf };
