/**
 * 種子資料：屋苑、角色/權限、演示用戶、系統參數、QR Code。
 * 密碼採 bcrypt（骨架 cost=6 以縮短啟動時間；投產應升為 10+）。
 */
'use strict';
const bcrypt = require('bcryptjs');

const ESTATES = [
  { estate_code: 'CWC', estate_name_zh: '灣景中心', estate_name_en: 'Bayview Centre', company_code: 'CRPM' },
  { estate_code: 'YPR', estate_name_zh: '攸壆路', estate_name_en: 'Yau Pok Road', company_code: 'PML' },
  { estate_code: 'CHNG', estate_name_zh: '頌雅苑', estate_name_en: 'Chung Nga Court', company_code: 'SMS' },
  { estate_code: 'DAHF', estate_name_zh: '大夫第', estate_name_en: 'Dai Fu House', company_code: 'SMS' },
];

const ROLES = [
  { role_code: 'ADMIN', role_name: '系統管理員', data_scope: 'ALL' },
  { role_code: 'CC_SUPERVISOR', role_name: '客服中心主管', data_scope: 'ALL' },
  { role_code: 'CC_STAFF', role_name: '客服中心人員', data_scope: 'ALL' },
  { role_code: 'ESTATE_SUPERVISOR', role_name: '物業管理處主管', data_scope: 'ESTATE' },
  { role_code: 'ESTATE_STAFF', role_name: '物業前線人員', data_scope: 'ESTATE' },
  { role_code: 'AUDITOR', role_name: '審計管理人員', data_scope: 'ALL' },
];

const PERMISSIONS = [
  ['case:list', 'case', '個案列表'],
  ['case:view', 'case', '個案詳情'],
  ['case:export', 'case', '匯出'],
  ['case:assign', 'case', '分派/轉派'],
  ['case:update', 'case', '跟進/更新'],
  ['case:resolve', 'case', '完結申請'],
  ['case:review', 'case', '完結審核'],
  ['case:reopen', 'case', '授權重開'],
  ['config:view', 'config', '參數查閱'],
  ['config:update', 'config', '參數更新'],
  ['config:approve', 'config', '參數審批'],
  ['qr:view', 'qr', 'QR 查閱'],
  ['qr:generate', 'qr', 'QR 生成/停用'],
  ['sla:run', 'sla', 'SLA 提醒掃描'],
  ['user:list', 'user', '用戶管理'],
  ['user:create', 'user', '用戶新增'],
  ['user:update', 'user', '用戶修改'],
  ['user:disable', 'user', '用戶停用'],
  ['user:reset_pwd', 'user', '重設密碼'],
  ['user:lock', 'user', '鎖定/解鎖'],
  ['role:list', 'role', '角色查閱'],
  ['role:manage', 'role', '角色管理'],
  ['audit:view', 'audit', '審計查閱'],
  ['dashboard:view', 'dashboard', '儀表板'],
  ['estate:list', 'estate', '屋苑查閱'],
  ['estate:manage', 'estate', '屋苑管理'],
];

const ROLE_PERMISSIONS = {
  ADMIN: PERMISSIONS.map((p) => p[0]),
  CC_SUPERVISOR: ['case:list', 'case:view', 'case:export', 'case:assign', 'case:review', 'case:reopen', 'audit:view', 'dashboard:view', 'config:view', 'qr:view', 'sla:run', 'user:list', 'user:update', 'role:list', 'estate:list'],
  CC_STAFF: ['case:list', 'case:view', 'case:export', 'case:assign', 'case:update', 'case:resolve', 'dashboard:view'],
  ESTATE_SUPERVISOR: ['case:list', 'case:view', 'case:export', 'case:assign', 'case:update', 'case:resolve', 'case:review', 'case:reopen', 'dashboard:view', 'user:list', 'role:list', 'audit:view', 'estate:list'],
  ESTATE_STAFF: ['case:list', 'case:view', 'case:update', 'case:resolve'],
  AUDITOR: ['case:list', 'case:view', 'audit:view', 'dashboard:view'],
};

/** 演示帳號（username / 密碼 / 角色 / 數據範圍） */
const USERS = [
  { username: 'admin', password: 'Admin@2026', full_name: '系統管理員', email: 'admin@example.com', role: 'ADMIN', estate_code: 'ALL' },
  { username: 'cc_sup', password: 'CcSup@2026', full_name: '客服主管', email: 'ccsup@example.com', role: 'CC_SUPERVISOR', estate_code: 'ALL' },
  { username: 'cwc_sup', password: 'CwcSup@2026', full_name: '灣景主管', email: 'cwcsup@example.com', role: 'ESTATE_SUPERVISOR', estate_code: 'CWC' },
  { username: 'ypr_sup', password: 'YprSup@2026', full_name: '攸壆主管', email: 'yprsup@example.com', role: 'ESTATE_SUPERVISOR', estate_code: 'YPR' },
  { username: 'chng_sup', password: 'ChngSup@2026', full_name: '頌雅主管', email: 'chngsup@example.com', role: 'ESTATE_SUPERVISOR', estate_code: 'CHNG' },
  { username: 'dahf_sup', password: 'DahfSup@2026', full_name: '大夫主管', email: 'dahfsup@example.com', role: 'ESTATE_SUPERVISOR', estate_code: 'DAHF' },
  { username: 'chng_staff', password: 'ChngSt@2026', full_name: '前線小明', email: 'chngstaff@example.com', role: 'ESTATE_STAFF', estate_code: 'CHNG' },
];

/** sys_config 初始值（JSON 字串儲存） */
function buildConfigs() {
  const configs = {};
  configs['sla.response'] = { URGENT: 5, NORMAL: 30, COMPLEX: 120, INSTANT: 240 };
  configs['sla.closure_days'] = 7;
  configs['sla.rules'] = {
    urgentKeywords: ['安全', '危險', '火警', '濃煙', '燒焦', '爆喉', '漏水', '墜物', '受傷', '滋擾', '噪音', '臭', '鼠', 'security', 'danger', 'fire', 'flood', 'leak'],
    complimentKeywords: ['讚揚', '感謝', '表揚', '嘉許', 'praise', 'thank', 'commend'],
    inquiryKeywords: ['想問', '請問', '查詢', '如何', '可否', 'enquiry', 'inquire', 'how to'],
    complaintKeywords: ['投訴', '不滿', 'complaint', 'dissatisf'],
  };
  configs.numbering = { bizCode: 'SR', seqDigits: 3, reset: 'DAILY' };
  configs['category.event_mapping'] = {
    MO_SERVICE: { base: 'NORMAL' },
    SECURITY: { base: 'NORMAL' },
    MAINTENANCE: { base: 'INSTANT' },
    CLEANLINESS: { base: 'NORMAL' },
    NUISANCE: { base: 'NORMAL' },
    OTHER: { base: 'NORMAL' },
  };
  configs['form.categories'] = {
    MO_SERVICE: { labelZh: '管理處人員服務', labelEn: 'Property Management Service' },
    SECURITY: { labelZh: '保安人員服務', labelEn: 'Security Service' },
    MAINTENANCE: { labelZh: '維修事宜', labelEn: 'Maintenance' },
    CLEANLINESS: { labelZh: '衞生事宜', labelEn: 'Cleanliness' },
    NUISANCE: { labelZh: '滋擾事宜', labelEn: 'Nuisance' },
    OTHER: { labelZh: '其他', labelEn: 'Others' },
  };
  configs['form.titles'] = { zh: ['先生', '女士', '小姐', '太太', '不願透露'], en: ['Mr.', 'Ms.', 'Miss', 'Mrs.', 'Prefer not to say'] };
  configs['form.max_length'] = { name: 50, content: 1000, other: 50 };
  configs['form.fields'] = ['title', 'name', 'incidentDate', 'incidentTime', 'email', 'phone', 'address', 'categories', 'content', 'surveyConsent'];
  configs['form.promise'] = {
    zh: '感謝您的反饋，我們將於三個工作天內聯繫閣下',
    en: 'Thank you for your feedback. We will contact you within 3 working days.',
  };
  configs['form.style'] = { primaryColor: '#1a5aa6', sloganZh: '攜手共建美好家園', sloganEn: 'Building a Better Home Together' };
  configs['form.site_base_url'] = ''; // 空 = 依目前訪問主機自動構成 QR 內容
  configs['form.privacy_policy_url'] = 'https://example.com/privacy';
  // F-005 提醒提前量（分鐘/天；規格書 5.5.1）
  configs['sla.reminder'] = {
    responseLeadMinutes: { URGENT: 10, NORMAL: 30, COMPLEX: 30, INSTANT: 30 },
    closureLeadDays: 1,
  };
  // F-008 週報自動產生排程（F-009 可配置；每週一 09:00 產生上週報表）
  configs['weekly_report.schedule'] = { dayOfWeek: 'MON', time: '09:00' };
  // F-007 問卷（有效期天數＋四題文案；可於 F-009 配置）
  configs['survey.expiry_days'] = 14;
  configs['survey.questions'] = {
    zh: [
      { key: 'overall', label: '整體滿意度' },
      { key: 'response', label: '回應速度' },
      { key: 'attitude', label: '處理人員態度' },
      { key: 'resolution', label: '問題解決程度' },
    ],
    en: [
      { key: 'overall', label: 'Overall satisfaction' },
      { key: 'response', label: 'Response speed' },
      { key: 'attitude', label: 'Attitude of the handling staff' },
      { key: 'resolution', label: 'Extent of problem resolution' },
    ],
  };
  return configs;
}

function insertConfigs(db, configs) {
  const stmt = db.prepare(
    'INSERT INTO sys_config (config_key, config_value, config_type) VALUES (@k, @v, @t)'
  );
  const typeOf = (k) => (k.startsWith('sla') ? 'SLA' : k.startsWith('category') || k.startsWith('form') ? 'FORM_STYLE' : k.startsWith('numbering') ? 'NUMBERING' : 'SYSTEM');
  const tx = db.transaction((map) => {
    for (const [key, value] of Object.entries(map)) {
      stmt.run({ k: key, v: JSON.stringify(value), t: typeOf(key) });
    }
  });
  tx(buildConfigs());
}

function seed(db) {
  const insertEstate = db.prepare('INSERT INTO sys_estate (estate_code, estate_name_zh, estate_name_en, company_code) VALUES (?, ?, ?, ?)');
  for (const e of ESTATES) insertEstate.run(e.estate_code, e.estate_name_zh, e.estate_name_en, e.company_code);

  insertConfigs(db);

  const insRole = db.prepare('INSERT INTO sys_role (role_code, role_name, data_scope) VALUES (?, ?, ?)');
  const roleIds = {};
  for (const r of ROLES) {
    const info = insRole.run(r.role_code, r.role_name, r.data_scope);
    roleIds[r.role_code] = info.lastInsertRowid;
  }

  const insPerm = db.prepare('INSERT INTO sys_permission (perm_code, module, perm_name) VALUES (?, ?, ?)');
  const permIds = {};
  for (const [code, module, name] of PERMISSIONS) {
    const info = insPerm.run(code, module, name);
    permIds[code] = info.lastInsertRowid;
  }

  const linkRolePerm = db.prepare('INSERT INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)');
  const linkUserRole = db.prepare('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)');
  const insUser = db.prepare(
    'INSERT INTO sys_user (username, password_hash, full_name, email, estate_code, must_change_pwd) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const hashCost = 6;
  const userIds = {};
  for (const u of USERS) {
    const hash = bcrypt.hashSync(u.password, hashCost);
    const info = insUser.run(u.username, hash, u.full_name, u.email, u.estate_code, 0);
    userIds[u.username] = info.lastInsertRowid;
  }
  for (const u of USERS) {
    linkUserRole.run(userIds[u.username], roleIds[u.role]);
  }
  for (const [roleCode, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of perms) {
      linkRolePerm.run(roleIds[roleCode], permIds[p]);
    }
  }

  // QR Code 不再於種子預插死碼（內容主機依環境而異）；由管理員於後台「QR Code 管理」首次生成。
}

module.exports = { seed };
