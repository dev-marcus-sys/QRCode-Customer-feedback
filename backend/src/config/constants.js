/**
 * 單一真源常數 — 枚舉/錯誤碼/狀態機矩陣
 * 全部對應《功能規格書》6.1 / 6.3 / 7.3 / 8.5，禁止自行增改枚舉值。
 */
const CASE_SOURCE = ['QR', 'CC', 'SITE', 'APP', 'EMAIL'];
const CASE_STATUS = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'REOPENED'];
const EVENT_TYPE = ['URGENT', 'NORMAL', 'COMPLEX', 'INSTANT', 'N/A'];
const PRIORITY = ['HIGH', 'MEDIUM', 'LOW'];
const INTENT_TYPE = ['COMPLAINT', 'FEEDBACK', 'INQUIRY', 'COMPLIMENT'];
const CATEGORY_CODE = ['MO_SERVICE', 'SECURITY', 'MAINTENANCE', 'CLEANLINESS', 'NUISANCE', 'OTHER'];
const RESOLUTION_RESULT = ['RESOLVED_FULL', 'RESOLVED_PART', 'UNRESOLVED', 'WITHDRAWN', 'REFERRED'];
/** F-006 重開標記（6.5：二次投訴／跟進不足） */
const REOPEN_TYPE = ['SECOND_COMPLAINT', 'INSUFFICIENT_FOLLOWUP'];
const SURVEY_STATUS = ['SENT', 'SUBMITTED', 'EXPIRED'];
const LOG_TYPE = [
  'CREATE', 'ASSIGN', 'REASSIGN', 'UPDATE', 'STATUS_CHANGE', 'RESPONSE', 'NOTE',
  'RESOLVE_REQUEST', 'RESOLVE_APPROVE', 'RESOLVE_REJECT', 'CLOSE', 'REOPEN',
  'ESCALATE', 'REMINDER', 'UPLOAD', 'OTHER',
];

/** 業務代碼（QR 管道固定 SR；規格書 6.2） */
const BIZ_CODE = 'SR';

/** 狀態機轉換矩陣（規格書 6.1.2）。key 為現狀態，值為允許之目標狀態。 */
const TRANSITIONS = {
  PENDING: ['ASSIGNED'],
  ASSIGNED: ['ASSIGNED', 'IN_PROGRESS'],
  IN_PROGRESS: ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED'],
  WAITING: ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['ASSIGNED', 'IN_PROGRESS'],
};

/** 目前狀態 → 可提示之操作（骨架僅提示，不提供轉換端點；F-004 起實作） */
const STATUS_ACTIONS = {
  PENDING: [{ action: 'assign', labelKey: 'action.assign', toStatus: 'ASSIGNED' }],
  ASSIGNED: [
    { action: 'reassign', labelKey: 'action.reassign', toStatus: 'ASSIGNED' },
    { action: 'start', labelKey: 'action.start', toStatus: 'IN_PROGRESS' },
  ],
  IN_PROGRESS: [
    { action: 'reassign', labelKey: 'action.reassign', toStatus: 'ASSIGNED' },
    { action: 'waiting', labelKey: 'action.waiting', toStatus: 'WAITING' },
    { action: 'resolveRequest', labelKey: 'action.resolveRequest', toStatus: 'RESOLVED' },
  ],
  WAITING: [
    { action: 'reassign', labelKey: 'action.reassign', toStatus: 'ASSIGNED' },
    { action: 'reply', labelKey: 'action.reply', toStatus: 'IN_PROGRESS' },
    { action: 'resolveRequest', labelKey: 'action.resolveRequest', toStatus: 'RESOLVED' },
  ],
  RESOLVED: [
    { action: 'reject', labelKey: 'action.reject', toStatus: 'IN_PROGRESS' },
    { action: 'approve', labelKey: 'action.approve', toStatus: 'CLOSED' },
  ],
  CLOSED: [{ action: 'reopen', labelKey: 'action.reopen', toStatus: 'REOPENED' }],
  REOPENED: [
    { action: 'reassign', labelKey: 'action.reassign', toStatus: 'ASSIGNED' },
    { action: 'start', labelKey: 'action.start', toStatus: 'IN_PROGRESS' },
  ],
};

/** 錯誤碼（規格書 8.5 子集） */
const ERR = {
  OK: 0,
  DUPLICATE: 1001,
  VALIDATION: 1002,
  FORM_TOKEN: 1003,
  ESTATE_NOT_FOUND: 1004,
  QR_NOT_FOUND: 1005,
  UNAUTH: 2001,
  BAD_CREDENTIALS: 2002,
  ACCOUNT_LOCKED: 2003,
  ACCOUNT_DISABLED: 2004,
  PERMISSION: 2005,
  MUST_CHANGE_PWD: 2006, // FR-010-04 首登/重設後強制改密；密碼過期
  CASE_NOT_FOUND: 3001,
  STATE_TRANSITION: 3002,
  DATA_SCOPE: 3004,
  SURVEY_NOT_FOUND: 4006,
  SURVEY_EXPIRED: 4007,
  SURVEY_ALREADY: 4008,
  ATTACH_INVALID: 4009,
  INTERNAL: 5000,
  RATE_LIMIT: 5001,
};

/** 狀態與事件類型之顯示用 meta（前端色簽對應） */
const STATUS_META = {
  PENDING: { labelZh: '待分派', labelEn: 'Pending', color: '#757575' },
  ASSIGNED: { labelZh: '已分派', labelEn: 'Assigned', color: '#1565C0' },
  IN_PROGRESS: { labelZh: '處理中', labelEn: 'In Progress', color: '#ED6C02' },
  WAITING: { labelZh: '待客戶回覆', labelEn: 'Waiting Customer', color: '#6A1B9A' },
  RESOLVED: { labelZh: '已完結（待審核）', labelEn: 'Resolved', color: '#00838F' },
  CLOSED: { labelZh: '已關閉', labelEn: 'Closed', color: '#2E7D32' },
  REOPENED: { labelZh: '已重開', labelEn: 'Reopened', color: '#B71C1C' },
};

const LOG_TYPE_LABEL = {
  CREATE: '建立個案', ASSIGN: '分派', REASSIGN: '轉派', UPDATE: '更新',
  STATUS_CHANGE: '狀態變更', RESPONSE: '首次回應', NOTE: '跟進紀錄',
  RESOLVE_REQUEST: '完結申請', RESOLVE_APPROVE: '審核通過', RESOLVE_REJECT: '審核駁回',
  CLOSE: '關閉', REOPEN: '重開', ESCALATE: '升級', REMINDER: '提醒',
  UPLOAD: '附件', OTHER: '其他',
};

module.exports = {
  CASE_SOURCE, CASE_STATUS, EVENT_TYPE, PRIORITY, INTENT_TYPE, CATEGORY_CODE, LOG_TYPE,
  RESOLUTION_RESULT, REOPEN_TYPE, SURVEY_STATUS,
  BIZ_CODE, TRANSITIONS, STATUS_ACTIONS, STATUS_META, LOG_TYPE_LABEL, ERR,
};
