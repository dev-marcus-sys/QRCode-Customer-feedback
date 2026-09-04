/**
 * F-010 密碼工具（FR-010-04 密碼策略）：
 * - 強度驗證：≥ 8 位，須同時含大小寫字母與數字。
 * - 一次性臨時密碼產生（管理員重設用）。
 */
'use strict';
const crypto = require('crypto');

/** 密碼強度：長度 ≥ 8，且同時含英文大寫、英文小寫、數字 */
function isStrong(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return false;
  return /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
}

/** 產生符合強度策略的一次性臨時密碼（12 位，含大寫/小寫/數字並打散） */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  const rnd = crypto.randomBytes(16);
  const chars = [
    upper[rnd[0] % upper.length],
    lower[rnd[1] % lower.length],
    digit[rnd[2] % digit.length],
  ];
  for (let i = 3; i < 12; i += 1) chars.push(all[rnd[i] % all.length]);
  // Fisher–Yates 打散順序
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rnd[(i + 3) % 16] % (i + 1);
    const t = chars[i];
    chars[i] = chars[j];
    chars[j] = t;
  }
  return chars.join('');
}

module.exports = { isStrong, generateTempPassword };
