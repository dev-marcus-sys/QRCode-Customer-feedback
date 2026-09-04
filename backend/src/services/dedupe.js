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

/** 24 小時二次投訴：回傳原案 row 或 null */
function findSecondComplaint(db, payload, nowMs = Date.now()) {
  const id = identifierOf(payload);
  if (!id || id.field === 'unit') return null; // 無電郵/電話時僅提示人工確認（6.5）
  const since = toDb(new Date(nowMs - 24 * 60 * 60 * 1000));
  const cats = Array.isArray(payload.categories) ? payload.categories : [];
  if (cats.length === 0) return null;
  const placeholders = cats.map(() => '?').join(',');
  const estateCode = payload.estate || payload.estate_code;
  const rows =
    id.field === 'customer_email'
      ? db.prepare(
          `SELECT * FROM \`case\`
            WHERE created_at >= ? AND customer_email = ? AND estate_code = ?
              AND category_code IN (${placeholders})
            ORDER BY created_at DESC LIMIT 1`
        ).all(since, id.value, estateCode, ...cats)
      : db.prepare(
          `SELECT * FROM \`case\`
            WHERE created_at >= ? AND customer_phone = ? AND estate_code = ?
              AND category_code IN (${placeholders})
            ORDER BY created_at DESC LIMIT 1`
        ).all(since, id.value, estateCode, ...cats);
  return rows[0] || null;
}

module.exports = { findDuplicate, findSecondComplaint, identifierOf };
