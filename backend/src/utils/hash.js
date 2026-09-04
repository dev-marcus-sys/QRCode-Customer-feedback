/**
 * Hash / HMAC 工具。
 * - source_submission_id：sha1(聯絡人|規範化內容|10分鐘桶)
 * - formToken：HMAC-SHA256 簽署 {estate, exp}，base64url 編碼
 */
'use strict';
const crypto = require('crypto');

function sha1Hex(s) {
  return crypto.createHash('sha1').update(String(s), 'utf8').digest('hex');
}

/** 規範化內容：全形→半形、轉小寫、壓縮空白 */
function normalizeContent(s) {
  return String(s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 10 分鐘桶鍵：floor(epochMinutes / 10) */
function windowBucket(nowMs = Date.now()) {
  return Math.floor(nowMs / 60000 / 10);
}

/**
 * 去重鍵：聯絡人鍵 + 規範化內容 + 10 分鐘桶。
 * 聯絡人鍵優先 email，其次 phone，再其次 name+unit（規格書 6.5 客戶識別順序）。
 */
function submissionKey({ email, phone, name, unit, content }, nowMs = Date.now()) {
  const contact = email || phone || `${name || ''}|${unit || ''}`;
  return sha1Hex(`${contact}|${normalizeContent(content)}|${windowBucket(nowMs)}`);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function fromBase64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function hmacSign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${base64url(data)}.${base64url(sig)}`;
}

/** 驗證並回傳 payload；無效/過期回傳 null */
function hmacVerify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;
  const expected = crypto.createHmac('sha256', secret).update(fromBase64url(dataB64)).digest();
  const given = fromBase64url(sigB64);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(fromBase64url(dataB64).toString('utf8'));
    if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 產生 formToken（一次性、5 分鐘） */
function createFormToken({ estate }, secret, ttlMinutes = 5) {
  const exp = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
  return hmacSign({ estate, exp }, secret);
}

module.exports = { sha1Hex, normalizeContent, submissionKey, createFormToken, hmacVerify };
