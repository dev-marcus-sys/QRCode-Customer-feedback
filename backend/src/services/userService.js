/**
 * F-010 用戶管理（FR-010-01/02/04/05/06）。
 * - 用戶列表（依操作人數據範圍過濾；ADMIN/ALL 看全部，ESTATE 限所屬屋苑）
 * - 新增/修改/停用（軟刪）/重設密碼（一次性臨時密碼＋強制改密）/鎖定解鎖
 * - 密碼策略（≥8 位大小寫＋數字）、90 天更換（建檔時不強制，pwd_changed_at 為 null 不視為過期）
 * - 防呆：不可停用/鎖定最後一位啟用之 ADMIN
 * 所有關鍵操作寫入 audit_log（action=USER_MANAGE）。
 */
'use strict';
const bcrypt = require('bcryptjs');
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { getConfig } = require('../db/configStore');
const { toDb, now } = require('../utils/time');
const { writeAudit } = require('../utils/audit');
const { isStrong, generateTempPassword } = require('../utils/password');

const HASH_COST = 10;

function bad(msg, http = 400) {
  return new ApiError(ERR.VALIDATION, msg, http);
}

function rowToUser(r) {
  if (!r) return null;
  const { password_hash, security_answer_hash, ...rest } = r;
  void password_hash;
  void security_answer_hash;
  return {
    ...rest,
    estateCode: r.estate_code,
    fullName: r.full_name,
    isActive: r.is_active,
    mustChangePwd: r.must_change_pwd,
    failedAttempts: r.failed_attempts,
    lastLoginAt: r.last_login_at ? r.last_login_at : null,
    pwdChangedAt: r.pwd_changed_at,
    lockedUntil: r.locked_until,
  };
}

function resolveScope(actor) {
  // ALL 視為全屋苑（含 ADMIN/CC 角色）；ESTATE 角色限所屬屋苑
  if (!actor || !actor.estateCode || actor.estateCode === 'ALL') return null;
  return actor.estateCode;
}

function listUsers(db, { actor, keyword, roleCode, estateCode, active, sortBy, sortDir, page, pageSize }) {
  const where = [];
  const params = [];
  const scope = resolveScope(actor);
  if (scope) {
    where.push('u.estate_code = ?');
    params.push(scope);
  }
  if (keyword) {
    where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  if (estateCode) {
    where.push('u.estate_code = ?');
    params.push(estateCode);
  }
  if (active !== undefined && active !== null && active !== '') {
    where.push('u.is_active = ?');
    params.push(active ? 1 : 0);
  }
  if (roleCode) {
    where.push('EXISTS (SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id AND r.role_code = ?)');
    params.push(roleCode);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const allowedSort = { username: 'u.username', fullName: 'u.full_name', estateCode: 'u.estate_code', createdAt: 'u.created_at', lastLoginAt: 'u.last_login_at' };
  const orderBy = allowedSort[sortBy] || 'u.user_id';
  const dir = String(sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM sys_user u ${w}`).get(...params).c;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const rows = db.prepare(
    `SELECT u.* FROM sys_user u ${w} ORDER BY ${orderBy} ${dir} LIMIT ? OFFSET ?`
  ).all(...params, ps, (p - 1) * ps);
  return {
    total,
    page: p,
    pageSize: ps,
    items: rows.map((r) => {
      const roles = db.prepare(
        `SELECT r.role_code AS code, r.role_name AS name FROM sys_role r
         JOIN sys_user_role ur ON ur.role_id = r.role_id WHERE ur.user_id = ?`
      ).all(r.user_id);
      return {
        ...rowToUser(r),
        roles,
        hasSecurityQuestion: !!r.security_question,
      };
    }),
  };
}

function passwordExpired(db, user) {
  if (!user.pwd_changed_at) return false; // 初始未設定不視為過期（避免示範帳號被鎖）
  const maxAge = Number(getConfig(db, 'pwd.max_age_days')) || 90;
  const changed = new Date(user.pwd_changed_at.replace(' ', 'T') + (user.pwd_changed_at.includes('+') ? '' : 'Z'));
  const days = (Date.now() - changed.getTime()) / (24 * 3600 * 1000);
  return days > maxAge;
}

function validateEstate(db, estateCode) {
  if (estateCode === 'ALL') return;
  const row = db.prepare('SELECT estate_code FROM sys_estate WHERE estate_code = ?').get(estateCode);
  if (!row) throw bad('屋苑代碼不存在');
}

function createUser(db, actor, payload) {
  const { username, fullName, email, phone, estateCode, roles, password, securityQuestion, securityAnswer } = payload || {};
  if (!username || !/^[A-Za-z0-9_.-]{3,50}$/.test(username)) throw bad('登入帳號須為 3~50 位英數或 ._-');
  if (!fullName || fullName.length > 50) throw bad('姓名為必填（≤50 字）');
  validateEstate(db, estateCode || 'ALL');
  if (db.prepare('SELECT 1 FROM sys_user WHERE username = ?').get(username)) throw bad('登入帳號已存在', 409);
  const roleRows = resolveRoles(db, roles);
  let hash;
  let mustChange = 0;
  if (password) {
    if (!isStrong(password)) throw bad('密碼須 ≥8 位，含大小寫字母與數字');
    hash = bcrypt.hashSync(password, HASH_COST);
  } else {
    hash = bcrypt.hashSync(generateTempPassword(), HASH_COST);
    mustChange = 1; // 管理員代建 → 強制首登改密
  }
  const saHash = securityQuestion && securityAnswer ? bcrypt.hashSync(String(securityAnswer).trim(), HASH_COST) : null;
  const info = db.prepare(
    `INSERT INTO sys_user (username, password_hash, full_name, email, phone, estate_code, security_question, security_answer_hash, must_change_pwd, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(username, hash, fullName, email || null, phone || null, estateCode || 'ALL', securityQuestion || null, saHash, mustChange);
  const userId = info.lastInsertRowid;
  linkRoles(db, userId, roleRows.map((r) => r.role_id));
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'USER_MANAGE', targetType: 'USER', targetId: userId, detail: { op: 'create', username, estateCode, roles: roleRows.map((r) => r.role_code) } });
  return { userId, mustChangePwd: !!mustChange, tempPassword: mustChange ? undefined : undefined };
}

function resolveRoles(db, roleCodes) {
  const codes = Array.isArray(roleCodes) && roleCodes.length ? roleCodes : [];
  const rows = [];
  for (const code of codes) {
    const r = db.prepare('SELECT role_id, role_code FROM sys_role WHERE role_code = ? AND is_active = 1').get(code);
    if (!r) throw bad(`角色不存在或已停用：${code}`);
    rows.push(r);
  }
  return rows;
}

function linkRoles(db, userId, roleIds) {
  const del = db.prepare('DELETE FROM sys_user_role WHERE user_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)');
  del.run(userId);
  for (const rid of roleIds) ins.run(userId, rid);
}

function updateUser(db, actor, userId, payload) {
  const user = db.prepare('SELECT * FROM sys_user WHERE user_id = ?').get(userId);
  if (!user) throw bad('用戶不存在', 404);
  const { fullName, email, phone, estateCode, roles, securityQuestion, securityAnswer } = payload || {};
  const tx = db.transaction(() => {
    const sets = [];
    const params = [];
    if (fullName !== undefined) {
      if (!fullName) throw bad('姓名不可為空');
      sets.push('full_name = ?'); params.push(fullName);
    }
    if (email !== undefined) { sets.push('email = ?'); params.push(email || null); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone || null); }
    if (estateCode !== undefined) { validateEstate(db, estateCode); sets.push('estate_code = ?'); params.push(estateCode); }
    if (securityQuestion !== undefined) {
      sets.push('security_question = ?'); params.push(securityQuestion || null);
      sets.push('security_answer_hash = ?');
      params.push(securityQuestion && securityAnswer ? bcrypt.hashSync(String(securityAnswer).trim(), HASH_COST) : null);
    }
    if (sets.length) {
      sets.push('updated_at = datetime(\'now\')');
      db.prepare(`UPDATE sys_user SET ${sets.join(', ')} WHERE user_id = ?`).run(...params, userId);
    }
    if (roles !== undefined) {
      const rs = resolveRoles(db, roles);
      linkRoles(db, userId, rs.map((r) => r.role_id));
    }
  });
  tx();
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'USER_MANAGE', targetType: 'USER', targetId: userId, detail: { op: 'update', fields: Object.keys(payload || {}) } });
  return rowToUser(db.prepare('SELECT * FROM sys_user WHERE user_id = ?').get(userId));
}

function setActive(db, actor, userId, active) {
  const user = db.prepare('SELECT * FROM sys_user WHERE user_id = ?').get(userId);
  if (!user) throw bad('用戶不存在', 404);
  const willDisable = !active;
  if (willDisable && user.is_active === 1) {
    // 防呆：不可停用最後一位啟用之 ADMIN
    const isAdmin = db.prepare(
      `SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.role_id = ur.role_id
       WHERE ur.user_id = ? AND r.role_code = 'ADMIN'`
    ).get(userId);
    if (isAdmin) {
      const activeAdmins = db.prepare(
        `SELECT COUNT(*) AS c FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.user_id
         JOIN sys_role r ON r.role_id = ur.role_id
         WHERE r.role_code = 'ADMIN' AND u.is_active = 1`
      ).get().c;
      if (activeAdmins <= 1) throw new ApiError(ERR.PERMISSION, '不可停用最後一位管理員', 409);
    }
  }
  db.prepare('UPDATE sys_user SET is_active = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(active ? 1 : 0, userId);
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'USER_MANAGE', targetType: 'USER', targetId: userId, detail: { op: active ? 'enable' : 'disable', username: user.username } });
  return { userId, isActive: !!active };
}

function resetPassword(db, actor, userId) {
  const user = db.prepare('SELECT * FROM sys_user WHERE user_id = ?').get(userId);
  if (!user) throw bad('用戶不存在', 404);
  const temp = generateTempPassword();
  db.prepare('UPDATE sys_user SET password_hash = ?, must_change_pwd = 1, failed_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(bcrypt.hashSync(temp, HASH_COST), userId);
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'USER_MANAGE', targetType: 'USER', targetId: userId, detail: { op: 'reset_password', username: user.username } });
  return { userId, tempPassword: temp }; // 一次性密碼回傳前端（經 token 傳送）
}

function setLock(db, actor, userId, locked) {
  const user = db.prepare('SELECT * FROM sys_user WHERE user_id = ?').get(userId);
  if (!user) throw bad('用戶不存在', 404);
  if (locked) {
    db.prepare('UPDATE sys_user SET locked_until = ?, failed_attempts = 5, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(toDb(new Date(Date.now() + 30 * 60 * 1000)), userId);
  } else {
    db.prepare('UPDATE sys_user SET locked_until = NULL, failed_attempts = 0, updated_at = datetime(\'now\') WHERE user_id = ?').run(userId);
  }
  writeAudit(db, { userId: actor.userId, username: actor.username, action: 'USER_MANAGE', targetType: 'USER', targetId: userId, detail: { op: locked ? 'lock' : 'unlock', username: user.username } });
  return { userId, lockedUntil: locked ? toDb(new Date(Date.now() + 30 * 60 * 1000)) : null };
}

module.exports = {
  listUsers, createUser, updateUser, setActive, resetPassword, setLock, rowToUser, passwordExpired,
};
