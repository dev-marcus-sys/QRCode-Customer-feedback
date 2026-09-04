/**
 * 事件類型判定與 SLA 到期計算（FR-002-05/09，規格書 5.5.1 / 6.3）。
 * 判定規則以 sys_config('sla.rules' / 'category.event_mapping') 為準（F-009 預留）。
 */
'use strict';
const { getConfig } = require('../db/configStore');
const { normalizeContent } = require('../utils/hash');
const { toDb } = require('../utils/time');

const URGENTABLE = ['SECURITY', 'MAINTENANCE', 'CLEANLINESS', 'NUISANCE'];

function includesAny(text, keywords) {
  const list = Array.isArray(keywords) ? keywords : [];
  return list.some((k) => text.includes(String(k).toLowerCase()));
}

/**
 * 判定意見性質（啟發式；規格書未定義公眾表單採集方式 → 差異見設計文 §9.6）
 */
function guessIntent(content, rules) {
  const text = normalizeContent(content).toLowerCase();
  if (includesAny(text, rules.complimentKeywords)) return 'COMPLIMENT';
  if (includesAny(text, rules.complaintKeywords)) return 'COMPLAINT';
  if (includesAny(text, rules.inquiryKeywords)) return 'INQUIRY';
  return 'FEEDBACK';
}

/**
 * 判定事件類型。
 * @returns {{intentType:string, eventType:string}}
 */
function computeEvent({ categories, content, isSecondComplaint }, rules, mapping) {
  const intentType = guessIntent(content, rules);
  const text = normalizeContent(content).toLowerCase();
  const cats = Array.isArray(categories) ? categories : [];

  if (intentType === 'COMPLIMENT') return { intentType, eventType: 'N/A' };
  if (intentType === 'INQUIRY') return { intentType, eventType: 'INSTANT' };

  // URGENT：涉安全/衞生/結構類關鍵字（限定可緊急類別）
  const canUrgent = cats.some((c) => URGENTABLE.includes(c));
  if (canUrgent && includesAny(text, rules.urgentKeywords)) {
    return { intentType, eventType: 'URGENT' };
  }
  // COMPLEX：重複投訴升級（規格書 6.3.2）
  if (isSecondComplaint) return { intentType, eventType: 'COMPLEX' };

  // 依類別基線取最嚴（INSTANT > NORMAL）
  let eventType = 'NORMAL';
  for (const c of cats) {
    const base = mapping[c] ? mapping[c].base : 'NORMAL';
    if (base === 'INSTANT') eventType = 'INSTANT';
  }
  return { intentType, eventType };
}

/**
 * 計算 SLA 到期時間。
 * @returns {{responseDue:string|null, closureDue:string}}
 */
function computeDueDates(db, createdAt, eventType) {
  const responseMap = getConfig(db, 'sla.response', { URGENT: 5, NORMAL: 30, COMPLEX: 120, INSTANT: 240 });
  const closureDays = getConfig(db, 'sla.closure_days', 7);
  const base = createdAt.getTime();
  let responseDue = null;
  if (eventType !== 'N/A' && responseMap[eventType]) {
    responseDue = toDb(new Date(base + responseMap[eventType] * 60 * 1000));
  }
  const closureDue = toDb(new Date(base + Number(closureDays) * 24 * 60 * 60 * 1000));
  return { responseDue, closureDue };
}

module.exports = { computeEvent, computeDueDates, guessIntent };
