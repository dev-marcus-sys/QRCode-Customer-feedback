/**
 * 公眾表單後端驗證（對應 FR-001-03）。回傳錯誤陣列；空陣列＝通過。
 * 每筆錯誤：{ field, zh, en }
 */
'use strict';
const { CATEGORY_CODE } = require('../config/constants');
const { isFutureDate } = require('./time');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 香港電話：+852（可略）＋ 2/3/5/6/9 開頭 8 位數 */
const PHONE_RE = /^(?:\+852)?[23569]\d{7}$/;

function cleanPhone(p) {
  return String(p || '').replace(/[\s\-()]/g, '');
}

/**
 * @param {object} body 請求 body
 * @param {object} meta { titles: string[], maxLength: {name,content,other} }
 * @returns {Array<{field:string, zh:string, en:string}>}
 */
function validateFeedback(body, meta) {
  const errors = [];
  const max = meta.maxLength || { name: 50, content: 1000, other: 50 };
  const titles = meta.titles || [];

  if (!body.estate) errors.push({ field: 'estate', zh: '屋苑參數缺失', en: 'Missing estate' });

  if (!titles.includes(body.title)) errors.push({ field: 'title', zh: '請選擇稱謂', en: 'Please select a title' });

  const name = String(body.name || '').trim();
  if (!name) errors.push({ field: 'name', zh: '請填寫姓名', en: 'Name is required' });
  else if (name.length > max.name) errors.push({ field: 'name', zh: `姓名不可超過 ${max.name} 字`, en: `Name must be within ${max.name} characters` });

  const email = String(body.email || '').trim();
  const phone = cleanPhone(body.phone);
  if (email && !EMAIL_RE.test(email)) errors.push({ field: 'email', zh: '電郵格式不正確', en: 'Invalid email format' });
  if (body.phone && !PHONE_RE.test(phone)) errors.push({ field: 'phone', zh: '電話須為香港 8 位數字（2/3/5/6/9 開頭）', en: 'Phone must be an 8-digit HK number starting with 2/3/5/6/9' });
  if (!email && !phone) errors.push({ field: 'contact', zh: '電郵或電話至少填寫一項', en: 'Email or phone is required' });

  if (!body.incidentDate) errors.push({ field: 'incidentDate', zh: '請填寫事發日期', en: 'Incident date is required' });
  else if (isFutureDate(body.incidentDate)) errors.push({ field: 'incidentDate', zh: '事發日期不可為未來日期', en: 'Incident date cannot be in the future' });

  const categories = Array.isArray(body.categories) ? body.categories : [];
  if (categories.length === 0) errors.push({ field: 'categories', zh: '請至少選擇一項意見種類', en: 'Please select at least one category' });
  else if (categories.length > 3) errors.push({ field: 'categories', zh: '意見種類最多選擇 3 項', en: 'Select at most 3 categories' });
  else {
    for (const c of categories) {
      if (!CATEGORY_CODE.includes(c)) {
        errors.push({ field: 'categories', zh: '意見種類選項不正確', en: 'Invalid category option' });
        break;
      }
    }
  }
  if (categories.includes('OTHER')) {
    const other = String(body.otherText || '').trim();
    if (!other) errors.push({ field: 'otherText', zh: '選擇「其他」時請填寫說明', en: 'Please specify when choosing "Others"' });
    else if (other.length > max.other) errors.push({ field: 'otherText', zh: `「其他」說明不可超過 ${max.other} 字`, en: `"Others" note must be within ${max.other} characters` });
  }

  const content = String(body.content || '').trim();
  if (!content) errors.push({ field: 'content', zh: '請填寫意見內容', en: 'Content is required' });
  else if (content.length > max.content) errors.push({ field: 'content', zh: `意見內容不可超過 ${max.content} 字`, en: `Content must be within ${max.content} characters` });

  if (typeof body.surveyConsent !== 'boolean') errors.push({ field: 'surveyConsent', zh: '請選擇是否接受滿意度調查', en: 'Please indicate survey consent' });

  return errors;
}

module.exports = { validateFeedback, cleanPhone };
