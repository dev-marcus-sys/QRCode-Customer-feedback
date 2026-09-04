/**
 * F-010 角色與權限管理（FR-010-03/07）。
 * - 角色列表（含權限碼、用戶數、啟用狀態）
 * - 新增/修改角色（含細粒度權限綁定：模組 × 操作 × 數據範圍三層）
 * - 角色複製（以既有角色為範本，FR-010-07）
 * - 軟刪（停用；不可刪除）
 * 所有操作寫入 audit_log（action=ROLE_MANAGE）。
 */
'use strict';
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { writeAudit } = require('../utils/audit');

function bad(msg, http = 400) {
  return new ApiError(ERR.VALIDATION, msg, http);
}

function validDataScope(scope) {
  return scope === 'ALL' || scope === 'ESTATE';
}

function roleToView(db, r) {
  const permissions = db.prepare(
    `SELECT p.perm_code AS code, p.perm_name AS name, p.module AS module, p.perm_type AS type
       FROM sys_permission p JOIN sys_role_permission rp ON rp.permission_id = p.permission_id
      WHERE rp.role_id = ? ORDER BY p.module, p.perm_code`
  ).all(r.role_id);
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM sys_user_role WHERE role_id = ?').get(r.role_id).c;
  return {
    roleId: r.role_id,
    roleCode: r.role_code,
    roleName: r.role_name,
    dataScope: r.data_scope,
    isActive: r.is_active,
    permissions,
    userCount,
  };
}

function listRoles(db) {
  const rows = db.prepare('SELECT * FROM sys_role ORDER BY role_code').all();
  return { items: rows.map((r) => roleToView(db, r)) };
}

function resolvePermIds(db, permCodes) {
  const codes = Array.isArray(permCodes) ? permCodes : [];
  const ids = [];
  for (const code of codes) {
    const p = db.prepare('SELECT permission_id, perm_code FROM sys_permission WHERE perm_code = ? AND is_active = 1').get(code);
    if (!p) throw bad(`權限碼不存在或已停用：${code}`);
    ids.push(p);
  }
  return ids;
}

function linkPerms(db, roleId, permIds) {
  const del = db.prepare('DELETE FROM sys_role_permission WHERE role_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)');
  del.run(roleId);
  for (const p of permIds) ins.run(roleId, p.permission_id);
}

function createRole(db, actor, payload) {
  const { roleCode, roleName, dataScope, permissions } = payload || {};
  if (!roleCode || !/^[A-Z][A-Z0-9_]{1,29}$/.test(roleCode)) throw bad('角色代碼須為全大寫英數/底線（2~30 字），如 ESTATE_MANAGER');
  if (!roleName || roleName.length > 50) throw bad('角色名稱為必填（≤50 字）');
  if (!validDataScope(dataScope || 'ALL')) throw bad('數據範圍須為 ALL 或 ESTATE');
  if (db.prepare('SELECT 1 FROM sys_role WHERE role_code = ?').get(roleCode)) throw bad('角色代碼已存在', 409);
  const permIds = resolvePermIds(db, permissions);
  const info = db.prepare('INSERT INTO sys_role (role_code, role_name, data_scope, is_active) VALUES (?, ?, ?, 1)')
    .run(roleCode, roleName, dataScope || 'ALL');
  const roleId = info.lastInsertRowid;
  linkPerms(db, roleId, permIds);
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'ROLE_MANAGE', targetType: 'ROLE', targetId: roleCode, detail: { op: 'create', permissions: permIds.map((p) => p.perm_code) } });
  return roleToView(db, db.prepare('SELECT * FROM sys_role WHERE role_id = ?').get(roleId));
}

function updateRole(db, actor, roleCode, payload) {
  const role = db.prepare('SELECT * FROM sys_role WHERE role_code = ?').get(roleCode);
  if (!role) throw bad('角色不存在', 404);
  const { roleName, dataScope, permissions, isActive } = payload || {};
  const tx = db.transaction(() => {
    const sets = [];
    const params = [];
    if (roleName !== undefined) {
      if (!roleName) throw bad('角色名稱不可為空');
      sets.push('role_name = ?'); params.push(roleName);
    }
    if (dataScope !== undefined) {
      if (!validDataScope(dataScope)) throw bad('數據範圍須為 ALL 或 ESTATE');
      sets.push('data_scope = ?'); params.push(dataScope);
    }
    if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (sets.length) {
      sets.push('updated_at = datetime(\'now\')');
      db.prepare(`UPDATE sys_role SET ${sets.join(', ')} WHERE role_id = ?`).run(...params, role.role_id);
    }
    if (permissions !== undefined) {
      linkPerms(db, role.role_id, resolvePermIds(db, permissions));
    }
  });
  tx();
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'ROLE_MANAGE', targetType: 'ROLE', targetId: roleCode, detail: { op: 'update', fields: Object.keys(payload || {}) } });
  return roleToView(db, db.prepare('SELECT * FROM sys_role WHERE role_code = ?').get(roleCode));
}

function copyRole(db, actor, payload) {
  const { fromRoleCode, roleCode, roleName } = payload || {};
  if (!fromRoleCode || !roleCode) throw bad('請提供來源與新角色代碼');
  const src = db.prepare('SELECT * FROM sys_role WHERE role_code = ?').get(fromRoleCode);
  if (!src) throw bad('來源角色不存在', 404);
  if (db.prepare('SELECT 1 FROM sys_role WHERE role_code = ?').get(roleCode)) throw bad('新角色代碼已存在', 409);
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(roleCode)) throw bad('角色代碼格式不正確');
  const permIds = db.prepare(
    'SELECT p.permission_id, p.perm_code FROM sys_permission p JOIN sys_role_permission rp ON rp.permission_id = p.permission_id WHERE rp.role_id = ?'
  ).all(src.role_id);
  const info = db.prepare('INSERT INTO sys_role (role_code, role_name, data_scope, is_active) VALUES (?, ?, ?, 1)')
    .run(roleCode, roleName || `${src.role_name}（副本）`, src.data_scope);
  const newId = info.lastInsertRowid;
  linkPerms(db, newId, permIds);
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'ROLE_MANAGE', targetType: 'ROLE', targetId: roleCode, detail: { op: 'copy', from: fromRoleCode, permissions: permIds.map((p) => p.perm_code) } });
  return roleToView(db, db.prepare('SELECT * FROM sys_role WHERE role_id = ?').get(newId));
}

function listAllPermissions(db) {
  const rows = db.prepare('SELECT perm_code AS code, module, perm_name AS name, perm_type AS type, is_active AS isActive FROM sys_permission ORDER BY module, perm_code').all();
  return rows;
}

module.exports = { listRoles, createRole, updateRole, copyRole, listAllPermissions, roleToView };
