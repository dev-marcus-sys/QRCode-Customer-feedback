/**
 * 屋苑主檔服務（後台「屋苑」管理頁）。
 * - 屋苑為系統主檔（sys_estate），被 `case` / `qr_code` 以 FK 參照，
 *   因此只提供新增、修改名稱/公司代碼與「停用/啟用」，不提供實體刪除。
 * - 停用（is_active=0）後：住戶表單 /form/meta 與提交回 ESTATE_NOT_FOUND；
 *   QR 總覽不再列示、generate 拒絕（見 qrService.js），既有歷史資料保留。
 * - 所有變更寫入 audit_log（action=ESTATE_MANAGE）。
 */
'use strict';
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { writeAudit } = require('../utils/audit');

/** 屋苑代碼：大寫英數/底線，2~10 字，首字須為英文字母（與現有 CWC/YPR/CHNG/DAHF 一致） */
const CODE_RE = /^[A-Z][A-Z0-9_]{1,9}$/;

function bad(msg, http = 400) {
  return new ApiError(ERR.VALIDATION, msg, http);
}

function toView(row) {
  return {
    estateCode: row.estate_code,
    estateNameZh: row.estate_name_zh,
    estateNameEn: row.estate_name_en,
    companyCode: row.company_code,
    isActive: row.is_active,
  };
}

function find(db, code) {
  const row = db.prepare('SELECT * FROM sys_estate WHERE estate_code = ?').get(String(code || '').toUpperCase());
  return row ? toView(row) : null;
}

function listEstates(db) {
  const rows = db.prepare('SELECT * FROM sys_estate ORDER BY estate_code').all();
  return { items: rows.map(toView) };
}

function audit(db, actor, op, code, detail) {
  writeAudit(db, {
    userId: actor.userId,
    username: actor.username,
    action: 'ESTATE_MANAGE',
    targetType: 'ESTATE',
    targetId: code,
    detail: { op, ...detail },
  });
}

function createEstate(db, actor, payload) {
  const code = String((payload && payload.estateCode) || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw bad('屋苑代碼須為大寫英數（2~10 字，首字為英文字母），如 CWC');
  const nameZh = String((payload && payload.estateNameZh) || '').trim();
  const nameEn = String((payload && payload.estateNameEn) || '').trim();
  const company = String((payload && payload.companyCode) || '').trim().toUpperCase();
  if (!nameZh || nameZh.length > 50) throw bad('中文名稱必填（≤50 字）');
  if (!nameEn || nameEn.length > 100) throw bad('英文名稱必填（≤100 字）');
  if (!company || company.length > 10) throw bad('公司代碼必填（≤10 字），如 CRPM / PML / SMS');
  if (db.prepare('SELECT 1 FROM sys_estate WHERE estate_code = ?').get(code)) {
    throw bad(`屋苑代碼 ${code} 已存在`, 409);
  }
  db.prepare(
    'INSERT INTO sys_estate (estate_code, estate_name_zh, estate_name_en, company_code, is_active) VALUES (?, ?, ?, ?, 1)'
  ).run(code, nameZh, nameEn, company);
  audit(db, actor, 'create', code, { nameZh, nameEn, company });
  return find(db, code);
}

function updateEstate(db, actor, code, payload) {
  const current = find(db, code);
  if (!current) throw bad('屋苑不存在', 404);
  const sets = [];
  const params = [];
  if (payload && payload.estateNameZh !== undefined) {
    const v = String(payload.estateNameZh).trim();
    if (!v || v.length > 50) throw bad('中文名稱不可為空（≤50 字）');
    sets.push('estate_name_zh = ?'); params.push(v);
  }
  if (payload && payload.estateNameEn !== undefined) {
    const v = String(payload.estateNameEn).trim();
    if (!v || v.length > 100) throw bad('英文名稱不可為空（≤100 字）');
    sets.push('estate_name_en = ?'); params.push(v);
  }
  if (payload && payload.companyCode !== undefined) {
    const v = String(payload.companyCode).trim().toUpperCase();
    if (!v || v.length > 10) throw bad('公司代碼不可為空（≤10 字）');
    sets.push('company_code = ?'); params.push(v);
  }
  if (payload && payload.isActive !== undefined) {
    sets.push('is_active = ?'); params.push(payload.isActive ? 1 : 0);
  }
  if (!sets.length) throw bad('沒有需要更新的欄位');
  params.push(current.estateCode);
  db.prepare(`UPDATE sys_estate SET ${sets.join(', ')} WHERE estate_code = ?`).run(...params);
  const fields = sets.map((s) => s.split(' = ')[0]);
  const hasActive = fields.includes('is_active');
  audit(db, actor, hasActive ? (payload.isActive ? 'activate' : 'deactivate') : 'update', current.estateCode, { fields });
  return find(db, current.estateCode);
}

module.exports = { listEstates, createEstate, updateEstate, find };
