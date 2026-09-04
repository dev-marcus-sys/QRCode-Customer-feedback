/**
 * 個案編號產生（FR-002-02/03，規格書 6.2）。
 * 格式：{公司代碼}/{業務代碼}/{屋苑代碼}/{YYMMDD}{3位流水}，例 SMS/SR/CHNG/260716001
 * 流水每日由 001 起算（香港時區日期）；唯一性以 case_id PK 約束，衝突由呼叫端重試。
 */
'use strict';
const { BIZ_CODE } = require('../config/constants');
const { getConfig } = require('../db/configStore');
const { hkYymmdd } = require('../utils/time');

function padSeq(n, digits) {
  return String(n).padStart(digits, '0');
}

/** 依屋苑與日期計算當日下一序號（MAX + 1） */
function nextSequence(db, prefix, seqDigits) {
  const row = db.prepare('SELECT case_id FROM `case` WHERE case_id LIKE ? ORDER BY case_id DESC LIMIT 1').get(`${prefix}%`);
  if (!row) return 1;
  const suffix = row.case_id.slice(-seqDigits);
  const parsed = Number(suffix);
  return Number.isFinite(parsed) ? parsed + 1 : 1;
}

/**
 * 產生單一候選案號（不寫庫）。
 * @param {import('better-sqlite3').Database} db
 * @param {{estate_code:string, company_code:string}} estateRow
 * @param {Date} nowDate
 */
function generateCaseId(db, estateRow, nowDate = new Date()) {
  const numbering = getConfig(db, 'numbering', { bizCode: BIZ_CODE, seqDigits: 3, reset: 'DAILY' });
  const bizCode = numbering.bizCode || BIZ_CODE;
  const seqDigits = numbering.seqDigits || 3;
  const yymmdd = hkYymmdd(nowDate);
  const prefix = `${estateRow.company_code}/${bizCode}/${estateRow.estate_code}/${yymmdd}`;
  const seq = nextSequence(db, prefix, seqDigits);
  return `${prefix}${padSeq(seq, seqDigits)}`;
}

module.exports = { generateCaseId };
