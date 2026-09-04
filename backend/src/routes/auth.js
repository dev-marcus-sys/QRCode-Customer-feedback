/**
 * 後台認證：POST /api/v1/auth/login、GET /api/v1/me
 * 掛載於 /api/v1，內部路徑 /auth/login 與 /me。
 */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ERR } = require('../config/constants');
const { messageFor, pickLang } = require('../config/i18n');
const { ApiError, ok } = require('../middlewares/error');
const { requireAuth, loadUserContext, jwtSecret } = require('../middlewares/auth');
const { getDb } = require('../db/connection');
const { toDb, now } = require('../utils/time');
const { createLimiter } = require('../utils/rateLimit');
const { getConfig } = require('../db/configStore');
const { writeAudit } = require('../utils/audit');
const { isStrong } = require('../utils/password');

const router = express.Router();
const loginLimiter = createLimiter({ windowMs: 60 * 1000, max: 5 });
const LOCK_WINDOW_MS = 30 * 60 * 1000;

router.post('/auth/login', (req, res) => {
  const lang = pickLang(req.headers['accept-language']);
  const db = getDb();
  loginLimiter.assert(`login:${req.ip}`, lang);
  const { username, password } = req.body || {};
  if (!username || !password) {
    throw new ApiError(ERR.BAD_CREDENTIALS, messageFor(ERR.BAD_CREDENTIALS, lang), 401);
  }
  const user = db.prepare('SELECT * FROM sys_user WHERE username = ?').get(String(username).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    // 連續失敗鎖定（FR-010-05 精簡版）
    if (user && !user.locked_until) {
      const fails = (user.failed_attempts || 0) + 1;
      if (fails >= 5) {
        db.prepare('UPDATE sys_user SET failed_attempts = ?, locked_until = ? WHERE user_id = ?')
          .run(fails, toDb(new Date(Date.now() + LOCK_WINDOW_MS)), user.user_id);
        throw new ApiError(ERR.ACCOUNT_LOCKED, messageFor(ERR.ACCOUNT_LOCKED, lang), 403);
      }
      db.prepare('UPDATE sys_user SET failed_attempts = ? WHERE user_id = ?').run(fails, user.user_id);
    }
    throw new ApiError(ERR.BAD_CREDENTIALS, messageFor(ERR.BAD_CREDENTIALS, lang), 401);
  }
  if (user.is_active !== 1) {
    throw new ApiError(ERR.ACCOUNT_DISABLED, messageFor(ERR.ACCOUNT_DISABLED, lang), 403);
  }
  if (user.locked_until && user.locked_until > toDb(now())) {
    throw new ApiError(ERR.ACCOUNT_LOCKED, messageFor(ERR.ACCOUNT_LOCKED, lang), 403);
  }

  // FR-010-04：首登/管理員重設後強制改密；或密碼超過最大使用年限（pwd.max_age_days，預設 90）
  const pwdMaxAgeDays = Number(getConfig(getDb(), 'pwd.max_age_days')) || 90;
  const pwdExpired = user.pwd_changed_at
    && (Date.now() - new Date(String(user.pwd_changed_at).replace(' ', 'T') + (String(user.pwd_changed_at).includes('+') ? '' : 'Z')).getTime()) / (24 * 3600 * 1000) > pwdMaxAgeDays;
  if (user.must_change_pwd === 1 || pwdExpired) {
    throw new ApiError(ERR.MUST_CHANGE_PWD, messageFor(ERR.MUST_CHANGE_PWD, lang), 401);
  }

  const nowDb = toDb(now());
  db.prepare('UPDATE sys_user SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE user_id = ?')
    .run(nowDb, user.user_id);

  const expiresIn = Number(process.env.JWT_EXPIRES_MINUTES) || 120;
  const accessToken = jwt.sign(
    { userId: user.user_id, username: user.username, estateCode: user.estate_code },
    jwtSecret(),
    { expiresIn: `${expiresIn}m` }
  );
  const ctx = loadUserContext(db, user.user_id);
  ok(res, {
    accessToken,
    tokenType: 'Bearer',
    expiresInMinutes: expiresIn,
    user: {
      userId: ctx.userId,
      username: ctx.username,
      fullName: ctx.fullName,
      email: ctx.email,
      estateCode: ctx.estateCode,
      roles: ctx.roles,
      permissions: ctx.permissions,
    },
  });
});

router.get('/me', requireAuth, (req, res) => {
  ok(res, {
    userId: req.user.userId,
    username: req.user.username,
    fullName: req.user.fullName,
    email: req.user.email,
    estateCode: req.user.estateCode,
    roles: req.user.roles,
    permissions: req.user.permissions,
  });
});

/**
 * POST /api/v1/auth/change-password
 * FR-010-04：變更密碼（首登強制、管理員重設後、或密碼過期時）。
 * - 非強制改密情境下須提供 currentPassword 並比對正確。
 * - 新密碼須符合強度策略（≥8 位含大小寫＋數字）。
 * - 成功後清除 must_change_pwd、寫入 pwd_changed_at、重置失敗/鎖定計數，並寫入審計。
 */
router.post('/auth/change-password', requireAuth, (req, res) => {
  const lang = pickLang(req.headers['accept-language']);
  const db = getDb();
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || !isStrong(newPassword)) {
    throw new ApiError(ERR.VALIDATION, '新密碼須 ≥8 位，且同時包含英文大寫、小寫與數字', 400);
  }
  const me = db.prepare('SELECT * FROM sys_user WHERE user_id = ?').get(req.user.userId);
  if (!me) throw new ApiError(ERR.UNAUTH, messageFor(ERR.UNAUTH, lang), 401);
  // 非強制改密時，需驗證原密碼
  if (me.must_change_pwd !== 1) {
    if (!currentPassword) throw new ApiError(ERR.VALIDATION, '變更密碼須提供原密碼', 400);
    if (!bcrypt.compareSync(currentPassword, me.password_hash)) {
      throw new ApiError(ERR.BAD_CREDENTIALS, messageFor(ERR.BAD_CREDENTIALS, lang), 401);
    }
  }
  db.prepare(
    `UPDATE sys_user SET password_hash = ?, pwd_changed_at = ?, must_change_pwd = 0,
       failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE user_id = ?`
  ).run(bcrypt.hashSync(newPassword, 10), toDb(now()), me.user_id);
  writeAudit(db, { userId: me.user_id, username: me.username, action: 'USER_MANAGE', targetType: 'USER', targetId: me.user_id, detail: { op: 'change_password' } });
  ok(res, { changed: true });
});

module.exports = router;
