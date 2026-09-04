/**
 * JWT 認證與 RBAC 權限守衛（Demo 級）。
 * - requireAuth：驗證 Bearer token，載入用戶 + 角色 + 權限至 req.user
 * - requirePerm(code)：權限碼檢查（規格書 8.3「權限代碼」）
 */
'use strict';
const jwt = require('jsonwebtoken');
const { ERR } = require('../config/constants');
const { messageFor } = require('../config/i18n');
const { ApiError } = require('./error');
const { getDb } = require('../db/connection');

function jwtSecret() {
  return process.env.JWT_SECRET || 'qr-feedback-dev-secret-change-me';
}

/** 載入用戶 RBAC 上下文 */
function loadUserContext(db, userId) {
  const user = db.prepare(
    'SELECT user_id AS userId, username, full_name AS fullName, email, estate_code AS estateCode, is_active AS isActive FROM sys_user WHERE user_id = ?'
  ).get(userId);
  if (!user) return null;
  const roles = db.prepare(
    `SELECT r.role_code AS roleCode, r.data_scope AS dataScope
       FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.role_id
      WHERE ur.user_id = ? AND r.is_active = 1`
  ).all(userId).map((r) => r.roleCode);
  const permissions = db.prepare(
    `SELECT p.perm_code AS permCode
       FROM sys_permission p
       JOIN sys_role_permission rp ON rp.permission_id = p.permission_id
       JOIN sys_user_role ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ? AND p.is_active = 1`
  ).all(userId).map((r) => r.permCode);
  user.roles = roles;
  user.permissions = [...new Set(permissions)];
  return user;
}

function requireAuth(req, res, next) {
  const lang = req.headers['accept-language'];
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return next(new ApiError(ERR.UNAUTH, messageFor(ERR.UNAUTH, lang), 401));
  }
  const token = header.slice(7).trim();
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret());
  } catch {
    return next(new ApiError(ERR.UNAUTH, messageFor(ERR.UNAUTH, lang), 401));
  }
  const db = getDb();
  const user = loadUserContext(db, payload.userId);
  if (!user || !user.isActive) {
    return next(new ApiError(ERR.ACCOUNT_DISABLED, messageFor(ERR.ACCOUNT_DISABLED, lang), 403));
  }
  req.user = user;
  return next();
}

function requirePerm(permCode) {
  return (req, res, next) => {
    const lang = req.headers['accept-language'];
    if (!req.user || !req.user.permissions.includes(permCode)) {
      return next(new ApiError(ERR.PERMISSION, messageFor(ERR.PERMISSION, lang), 403));
    }
    return next();
  };
}

module.exports = { requireAuth, requirePerm, loadUserContext, jwtSecret };
