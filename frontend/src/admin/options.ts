/**
 * 後台選項常數（與種子資料/規格書一致）。
 * 注意：屋苑清單已改為動態（見 useEstates.ts / GET /api/v1/estates），請勿在此寫死。
 */
export const CATEGORY_OPTIONS: { code: string; labelZh: string; labelEn: string }[] = [
  { code: 'MO_SERVICE', labelZh: '管理處人員服務', labelEn: 'Property Management Service' },
  { code: 'SECURITY', labelZh: '保安人員服務', labelEn: 'Security Service' },
  { code: 'MAINTENANCE', labelZh: '維修事宜', labelEn: 'Maintenance' },
  { code: 'CLEANLINESS', labelZh: '衞生事宜', labelEn: 'Cleanliness' },
  { code: 'NUISANCE', labelZh: '滋擾事宜', labelEn: 'Nuisance' },
  { code: 'OTHER', labelZh: '其他', labelEn: 'Others' },
];

export const STATUS_OPTIONS: { code: string; labelZh: string; labelEn: string }[] = [
  { code: 'PENDING', labelZh: '待分派', labelEn: 'Pending' },
  { code: 'ASSIGNED', labelZh: '已分派', labelEn: 'Assigned' },
  { code: 'IN_PROGRESS', labelZh: '處理中', labelEn: 'In Progress' },
  { code: 'WAITING', labelZh: '待客戶回覆', labelEn: 'Waiting Customer' },
  { code: 'RESOLVED', labelZh: '已完結（待審核）', labelEn: 'Resolved' },
  { code: 'CLOSED', labelZh: '已關閉', labelEn: 'Closed' },
  { code: 'REOPENED', labelZh: '已重開', labelEn: 'Reopened' },
];

export const EVENT_OPTIONS: { code: string; labelZh: string; labelEn: string }[] = [
  { code: 'URGENT', labelZh: '緊急', labelEn: 'Urgent' },
  { code: 'NORMAL', labelZh: '一般', labelEn: 'Normal' },
  { code: 'COMPLEX', labelZh: '複雜', labelEn: 'Complex' },
  { code: 'INSTANT', labelZh: '即時', labelEn: 'Instant' },
  { code: 'N/A', labelZh: '不適用', labelEn: 'N/A' },
];

export const PRIORITY_OPTIONS: { code: string; labelZh: string; labelEn: string }[] = [
  { code: 'HIGH', labelZh: '高', labelEn: 'High' },
  { code: 'MEDIUM', labelZh: '中', labelEn: 'Medium' },
  { code: 'LOW', labelZh: '低', labelEn: 'Low' },
];

export const RESOLUTION_OPTIONS: { code: string; labelZh: string; labelEn: string }[] = [
  { code: 'RESOLVED_FULL', labelZh: '已徹底解決', labelEn: 'Fully Resolved' },
  { code: 'RESOLVED_PART', labelZh: '部分解決', labelEn: 'Partially Resolved' },
  { code: 'UNRESOLVED', labelZh: '無法解決', labelEn: 'Unable to Resolve' },
  { code: 'WITHDRAWN', labelZh: '客戶撤回投訴', labelEn: 'Complaint Withdrawn' },
  { code: 'REFERRED', labelZh: '已轉介其他部門', labelEn: 'Referred Elsewhere' },
];

export const REOPEN_OPTIONS: { code: string; labelZh: string; labelEn: string }[] = [
  { code: 'SECOND_COMPLAINT', labelZh: '二次投訴', labelEn: 'Second Complaint' },
  { code: 'INSUFFICIENT_FOLLOWUP', labelZh: '跟進不足', labelEn: 'Insufficient Follow-up' },
];

export const STATUS_COLORS: Record<string, string> = {
  PENDING: '#757575',
  ASSIGNED: '#1565C0',
  IN_PROGRESS: '#ED6C02',
  WAITING: '#6A1B9A',
  RESOLVED: '#00838F',
  CLOSED: '#2E7D32',
  REOPENED: '#B71C1C',
};

export function labelOf(list: { code: string; labelZh: string; labelEn: string }[], code: string | null | undefined, lang: 'zh-Hant' | 'en'): string {
  if (!code) return '';
  const hit = list.find((o) => o.code === code);
  return hit ? (lang === 'en' ? hit.labelEn : hit.labelZh) : code;
}
