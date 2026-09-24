/**
 * API client：統一信封解包、錯誤碼映射、token 存取。
 * 信封：{ code, message, data }；code===0 為成功（規格書 8.1）。
 */
export interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

export class ApiRequestError extends Error {
  code: number;
  detail: unknown;
  constructor(code: number, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface FormMetaCategory {
  code: string;
  label: string;
  labelZh: string;
  labelEn: string;
}

export interface FormMeta {
  estateCode: string;
  estateNameZh: string;
  estateNameEn: string;
  lang: string;
  fields: string[];
  categories: FormMetaCategory[];
  titles: string[];
  maxLength: { name: number; content: number; other: number };
  promise: string;
  style: { primaryColor: string; sloganZh?: string; sloganEn?: string };
  privacyPolicyUrl: string;
}

export interface FeedbackPayload {
  estate: string;
  title: string;
  name: string;
  email: string;
  phone: string;
  incidentDate: string;
  incidentTime: string;
  address: { block: string; floor: string; unit: string };
  categories: string[];
  otherText: string;
  content: string;
  surveyConsent: boolean;
  formToken: string;
  lang?: string;
  /** 短亂數 QR 連結令牌（?estate=..&t=..），用於後端精確驗證該張 QR */
  t?: string;
}

export interface FeedbackResult {
  caseId: string;
  status: string;
  eventType: string;
  responseSlaDue: string | null;
  closureSlaDue: string | null;
  isDuplicate: boolean;
  isSecondComplaint: boolean;
  originalCaseId: string | null;
  message: string;
}

/** 客服人員手動新增個案之請求載荷（對應 POST /cases，case:create） */
export interface CreateCasePayload {
  estate: string;
  title: string;
  name: string;
  email?: string;
  phone?: string;
  block?: string;
  floor?: string;
  unit?: string;
  category: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  incidentDate?: string;
  incidentTime?: string;
  content: string;
  surveyConsent?: boolean;
}

export interface CreateCaseResult {
  caseId: string;
  status: string;
  eventType: string;
  responseSlaDue: string | null;
  closureSlaDue: string | null;
  message: string;
}

export interface AdminUser {
  userId: number;
  username: string;
  fullName: string;
  email?: string;
  estateCode: string;
  estateCodes?: string[];
  roles: string[];
  permissions: string[];
}

export interface LoginResult {
  accessToken: string;
  tokenType: string;
  expiresInMinutes: number;
  /** FR-010-04：首登/重設後/密碼過期強制改密，此時 token 僅可用於 change-password */
  mustChangePwd?: boolean;
  user: AdminUser;
}

export interface CaseItem {
  caseId: string;
  caseSource: string;
  caseStatus: string;
  eventType: string;
  priority: string;
  intentType: string;
  categoryCode: string;
  estateCode: string;
  estateNameZh: string;
  estateNameEn: string;
  customerTitle: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  address: { block: string | null; floor: string | null; unit: string | null };
  incidentDate: string;
  incidentTime: string | null;
  commentContent: string;
  satisfactionConsent: boolean;
  isSecondComplaint: boolean;
  originalCaseId: string | null;
  assignedTo: { id: number; fullName: string } | null;
  responseSlaDue: string | null;
  closureSlaDue: string | null;
  slaOverdue: boolean;
  responseSlaMet?: number | null;
  closureSlaMet?: number | null;
  closedAt?: string | null;
  handlingDays?: number | null;
  firstResponseAt?: string | null;
  resolutionResult?: string | null;
  resolutionSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseListData {
  total: number;
  page: number;
  pageSize: number;
  items: CaseItem[];
}

export interface TimelineItem {
  logId: number;
  caseId: string;
  logType: string;
  logContent: string;
  oldStatus: string | null;
  newStatus: string | null;
  actionBy: number;
  actionByName: string;
  actionAt: string;
  attachmentId?: number | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
}

export interface CaseSurvey {
  surveyId: number;
  status: string;
  lang: string;
  sentAt: string | null;
  submittedAt: string | null;
  expiresAt: string | null;
  ratings: { overall: number; response: number; attitude: number; resolution: number } | null;
  average: number | null;
  feedback: string | null;
  isLowScore: boolean;
  resendCount: number;
}

export interface CaseDetailData {
  case: CaseItem;
  timeline: TimelineItem[];
  survey: CaseSurvey | null;
  allowedActions: { action: string; toStatus: string }[];
}

export interface AssignableUser {
  userId: number;
  fullName: string;
  email: string | null;
  estateCode: string;
  roleNames: string | null;
}

export interface AssigneesData {
  caseId: string;
  estateCode: string;
  suggestedUserId: number | null;
  assignableUsers: AssignableUser[];
}

export interface CaseActionResult {
  caseId: string;
  caseStatus: string;
  assigneeId?: number;
  priority?: string;
  logType?: string;
  resolutionResult?: string;
  handlingDays?: number | null;
  closureSlaMet?: number | null;
  closureSlaDue?: string | null;
  survey?: CaseSurvey | null;
}

export interface BatchActionResult {
  assigned?: string[];
  skipped?: { caseId: string; reason: string }[];
  done?: string[];
  assigneeId?: number;
}

/* ------- AI 建議（M0 / AI-01 內容分類影子模式；docs/AI_利用方案.md §7.1）------- */

export interface AiClassifyPayload {
  category: string;
  intent: string;
  urgency: string;
  eventType: string;
  reason: string;
  withDiff: boolean;
  baseline: { category: string; intent: string; eventType: string };
}

export interface AiSuggestionItem {
  suggestionId: number;
  caseId: string;
  aiType: string;
  status: string;
  payload: AiClassifyPayload | null;
  inputExcerpt: string | null;
  confidence: number | null;
  model: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decidedNote: string | null;
}

export interface AiDecideResult {
  suggestionId: number;
  caseId: string;
  status: string;
  changes: string[];
  responseSlaDue: string | null;
}
export interface AiSimilarMatch {
  caseId: string;
  category: string;
  score: number;
  sharedEntities: string[];
}

export interface AiAssigneeCandidate {
  userId: number;
  fullName: string;
  email: string | null;
  roles: string[];
  roleCodes: string[];
  isPreferredRole: boolean;
  stats: { sameCategoryCount: number; avgHandlingDays: number | null; judged: number; overdue: number; openCount: number };
  score: number;
  reason: string;
}

export interface AiAssigneeSuggestion {
  enabled: boolean;
  category: string | null;
  preferredRole: string | null;
  lookbackDays: number;
  suggestedUserId: number | null;
  suggestedUserName: string | null;
  candidates: AiAssigneeCandidate[];
}

export interface AiLinkResult {
  suggestionId: number;
  caseId: string;
  status: string;
  originalCaseId: string;
}
export interface AiDraftPoint { label: string; text: string }

export interface AiDraftPayload {
  kind: 'summary' | 'reply';
  lang: string;
  text: string;
  points?: AiDraftPoint[];
  fallback?: boolean;
}

export interface AiDraftResult {
  suggestionId: number;
  caseId: string;
  aiType: string;
  status: string;
  kind: 'summary' | 'reply';
  lang: string;
  payload: AiDraftPayload;
  model: string | null;
  confidence: number | null;
}

export interface AiDraftUseResult {
  suggestionId: number;
  caseId: string;
  status: string;
  kind: 'summary' | 'reply';
  kindZh: string;
  content: string;
}

export type FeedbackSentiment = 'positive' | 'neutral' | 'negative';

export interface FeedbackInsightItem {
  surveyId: number;
  caseId: string;
  estateCode: string;
  estateNameZh: string | null;
  topics: string[];
  sentiment: FeedbackSentiment;
  summary: string | null;
  confidence: number | null;
  model: string | null;
  createdAt: string;
  submittedAt: string | null;
  overall: number | null;
  isLowScore: boolean;
}

export interface SurveyInsightsData {
  total: number;
  topics: { topic: string; count: number; avgOverall: number | null; negativeRate: number }[];
  sentiment: Record<FeedbackSentiment, number>;
  items: FeedbackInsightItem[];
  topicLabels: string[];
}

export interface NotificationItem {
  notifId: number;
  title: string;
  body: string;
  notifType: string;
  refType: string | null;
  refId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListData {
  total: number;
  page: number;
  pageSize: number;
  items: NotificationItem[];
}

export interface SurveyQuestion {
  key: string;
  label: string;
}

export interface PublicSurvey {
  caseId: string;
  estateCode: string;
  estateNameZh: string;
  estateNameEn: string;
  status: string;
  lang: string;
  questions: SurveyQuestion[];
  expiresAt: string | null;
  submittedAt: string | null;
  isLowScore: boolean;
  ratings: { overall: number; response: number; attitude: number; resolution: number } | null;
  feedback: string | null;
}

export interface SurveySubmitResult {
  submitted: boolean;
  caseId: string;
  average: number;
  isLowScore: boolean;
}

export interface SurveyStatsData {
  overall: {
    sent: number;
    submitted: number;
    expired: number;
    pending: number;
    replyRate: number;
    lowScoreCount: number;
    avg: { overall: number | null; response: number | null; attitude: number | null; resolution: number | null };
  };
  byEstate: {
    estateCode: string;
    estateNameZh: string;
    sent: number;
    submitted: number;
    expired: number;
    lowScoreCount: number;
    replyRate: number;
    avgOverall: number | null;
  }[];
}

/* ------- F-008 數據分析與儀表板 / F-009 系統參數 ------- */

export type RangePreset = 'today' | 'thisWeek' | 'thisMonth' | 'thisQuarter' | 'thisYear' | 'custom';

export interface KpiCard {
  key: string;
  labelZh: string;
  unit: string;
  target: number | null;
  good: 'up' | 'down' | null;
  value: number | null;
  delta: number | null;
  met: boolean | null;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface SurveyConsentData {
  total: number;
  willing: { count: number; rate: number | null };
  unwilling: { count: number; rate: number | null };
  completed: { count: number; rate: number | null };
}

export interface DashboardSummaryData {
  range: { from: string; to: string; labelZh: string };
  estate: string;
  kpi: KpiCard[];
  surveyConsent: SurveyConsentData;
  statusCounts: StatusCount[];
  anomalySummary: { OVERDUE: number; LOW_SCORE: number; SECOND: number };
}

export interface TrendPoint {
  ym: string;
  created: number;
  closed: number;
}

export interface DistributionItem {
  code: string;
  labelZh: string;
  count: number;
  rate: number;
}

export interface DistributionData {
  total: number;
  intent: DistributionItem[];
  category: DistributionItem[];
  status: DistributionItem[];
  estate: DistributionItem[];
}

export interface HandlerRow {
  userId: number;
  fullName: string;
  estateNameZh: string;
  caseCount: number;
  closedCount: number;
  avgHandlingDays: number | null;
  avgSatisfaction: number | null;
}

export type AnomalyType = 'OVERDUE' | 'LOW_SCORE' | 'SECOND';

export interface AnomalyRow {
  type: AnomalyType;
  aspect?: string;
  caseId: string;
  estateCode: string;
  estateNameZh: string;
  status: string;
  dueAt?: string | null;
  createdAt: string | null;
}

export interface AnomalyData {
  counts: Record<AnomalyType, number>;
  items: AnomalyRow[];
}

export interface WeeklyReportItem {
  reportId: number;
  periodStart: string;
  periodEnd: string;
  summary: DashboardSummaryData | null;
  anomalyCount: number;
  anomalies?: AnomalyRow[];
  generatedAt: string;
  aiSummary?: string | null;
  aiSummaryModel?: string | null;
  aiSummaryAt?: string | null;
}

export interface WeeklyReportRunResult {
  duplicate: boolean;
  report?: WeeklyReportItem;
  recipients?: number;
  emailQueued?: number;
}

export interface ConfigItem {
  key: string;
  labelZh: string;
  type: string;
  editable: boolean;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
  /** enum 等 kind 之可選值清單（後端 CATALOG def.options） */
  options?: string[];
  /** 群組內分節標題（AI 參數依 AI-00…AI-07 分節顯示） */
  subGroup?: string;
}

/** AI-08 逾期風險預警（§4.8） */
export interface RiskCaseItem {
  caseId: string;
  estateCode: string;
  estateNameZh: string;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  riskScore: number;
  reason: string | null;
  suggestedAction: string | null;
  model: string | null;
  computedAt: string | null;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  caseStatus: string;
  categoryCode: string;
  eventType: string;
  dueAt: string | null;
  remainingHours: number | null;
  overdue: boolean;
}

/** AI-07 附件影像理解結果（§4.7） */
export interface AttachmentInsight {
  suggestionId: number;
  attachmentId: number;
  fileName: string;
  fileType: string;
  category: string;
  categoryZh: string;
  description: string;
  ocrText: string;
  confidence: number | null;
  /** false＝規則模式／遠端失敗，未真正使用視覺模型（介面須明確標示，避免誤導） */
  visionUsed: boolean;
  model: string | null;
  createdAt: string | null;
}

/* ------- AI-09 RAG 知識庫（§4.9）------- */
export interface KbDocument {
  docId: string;
  title: string;
  source: string;
  version: string;
  status: 'active' | 'disabled' | 'pending_review';
  owner: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  ingestedAt: string | null;
  updatedAt: string | null;
}

export interface KbChunk {
  docId: string;
  title: string;
  source: string;
  seq: number;
  heading: string | null;
  headingPath: string[];
  score: number;
  snippet: string;
}

export interface KbSearchData {
  query: string;
  model: string;
  count: number;
  results: KbChunk[];
}

export interface KbAskData {
  answer: string;
  model: string | null;
  citations: KbChunk[];
  fallback: boolean;
  generated: boolean;
}

export interface ConfigGroup {
  key: string;
  labelZh: string;
  items: ConfigItem[];
}

export interface ConfigListData {
  groups: ConfigGroup[];
  editableOnly: boolean;
}

export interface ConfigAuditRow {
  auditId: number;
  configKey: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  actorName: string;
  createdAt: string;
}

export interface ConfigUpdateResult {
  key: string;
  labelZh: string;
  value: unknown;
  updatedAt: string;
  notified: number[];
}

/** M0 AI 設定現況（GET /api/v1/ai/status；不含任何金鑰內容） */
export interface AiStatus {
  provider: string;
  aiEnabled: boolean;
  classifyEnabled: boolean;
  effective: boolean;
  piiMode: string;
  providers: string[];
  env: {
    baseUrl: string;
    baseUrlSet: boolean;
    baseUrlSource: 'db' | 'env' | 'default';
    apiKeySet: boolean;
    apiKeyMasked: string | null;
    model: string;
    modelSource: 'db' | 'env' | 'default';
    scanIntervalMs: number | null;
    scanEnabled: boolean;
  };
  checkedAt: string | null;
}

/** AI API Key 設定結果（PUT/DELETE /api/v1/ai/api-key；不回傳明文） */
export interface AiApiKeyResult {
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  persisted: boolean;
  persistedAt: string | null;
  persistError: string | null;
}

/** M0 AI 連線測試結果（POST /api/v1/ai/test） */
export interface AiTestResult {
  provider: string;
  ok: boolean;
  local: boolean;
  skipped: boolean;
  latencyMs: number;
  model: string | null;
  message: string;
  error: string | null;
  testedAt: string | null;
  result: {
    category: string;
    intent: string;
    urgency: string;
    eventType: string;
    confidence: number;
    reason: string;
  } | null;
}

/** 各頁 AI 功能開關快照（GET /api/v1/ai/features；依系統參數 AI 開關計算，不含金鑰） */
export interface AiFeatures {
  aiEnabled: boolean;
  features: {
    classify: boolean;      // AI-01 內容分類建議
    similar: boolean;       // AI-02 語意防重
    assign: boolean;        // AI-03 智能分派
    draft: boolean;         // AI-04 草擬回覆／摘要
    feedback: boolean;      // AI-05 問卷意見分析
    weeklySummary: boolean; // AI-06 週報 AI 摘要
    attachment: boolean;    // AI-07 附件影像理解
    risk: boolean;          // AI-08 逾期風險預警
    kb: boolean;            // AI-09 知識庫檢索
    kbAnswer: boolean;      // AI-09 以 LLM 生成附引用答案
  };
}

/** 單一屋苑之 QR 現況（每苑一列；未生成時 qrId 為 null） */
export interface QrItem {
  estateCode: string;
  estateNameZh: string;
  estateNameEn: string;
  qrId: number | null;
  qrContent: string | null;
  active: boolean | null;
  generatedAt: string | null;
  invalidatedAt: string | null;
  /** 有效日期（DB UTC 字串 'YYYY-MM-DD HH:mm:ss'）；null = 永不自動停用（預設） */
  validUntil: string | null;
  /** 是否已逾有效日期（validUntil 為 null 時恆為 false） */
  expired: boolean;
}

export interface QrOverviewData {
  siteBaseUrl: string;
  effectiveBaseUrl: string;
  items: QrItem[];
}

export interface QrActionResult {
  qrId: number;
  estateCode: string;
  qrContent: string;
  active: boolean;
  generatedAt: string;
  invalidatedAt?: string | null;
  validUntil?: string | null;
}

/* ------- F-010 用戶與權限管理 ------- */

export interface UserRoleRef {
  code: string;
  name: string;
}

export interface UserRow {
  userId: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  estateCode: string;
  estateCodes: string[];
  isActive: number; // 0/1
  mustChangePwd: number; // 0/1
  roles: UserRoleRef[];
  createdAt: string;
  lastLoginAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  hasSecurityQuestion?: boolean;
}

export interface UserListData {
  total: number;
  page: number;
  pageSize: number;
  items: UserRow[];
}

export interface PermissionRow {
  code: string;
  module: string;
  name: string;
  type: string;
  isActive: number;
}

export interface RoleRow {
  roleId: number;
  roleCode: string;
  roleName: string;
  dataScope: string; // ALL | ESTATE
  isActive: number; // 0/1
  permissions: PermissionRow[];
  userCount: number;
}

export interface RoleListData {
  roles: RoleRow[];
  permissions: PermissionRow[];
}

export interface AuditRow {
  auditId: number;
  userId: number | null;
  username: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditListData {
  total: number;
  page: number;
  pageSize: number;
  items: AuditRow[];
  actions: string[];
}

/* ------- 屋苑主檔（後台「屋苑」管理頁）------- */

export interface EstateItem {
  estateCode: string;
  estateNameZh: string;
  estateNameEn: string;
  companyCode: string;
  isActive: number; // 0/1
}

export interface EstateListData {
  items: EstateItem[];
}

const BASE = '/api/v1';

/** F-008 儀表板共用查詢參數 */
function dashboardQuery(q: { range?: RangePreset; from?: string; to?: string; estate?: string }): string {
  const params = new URLSearchParams();
  if (q.range) params.set('range', q.range);
  if (q.range === 'custom' && q.from && q.to) {
    params.set('from', q.from);
    params.set('to', q.to);
  }
  if (q.estate) params.set('estate', q.estate);
  const s = params.toString();
  return s ? `?${s}` : '';
}

function parseEnvelope<T>(res: Response): Promise<Envelope<T>> {
  return res.json().then((body) => {
    if (!body || typeof body.code !== 'number') {
      throw new ApiRequestError(500, 'Invalid response', body);
    }
    return body as Envelope<T>;
  });
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(init.headers || {}),
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(BASE + path, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const env = await parseEnvelope<T>(res);
  if (env.code !== 0) {
    throw new ApiRequestError(env.code, env.message, env.data);
  }
  return env.data as T;
}

const TOKEN_KEY = 'qr_admin_token';
const USER_KEY = 'qr_admin_user';

export const authStore = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  getUser: (): AdminUser | null => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  },
  setUser: (u: AdminUser) => localStorage.setItem(USER_KEY, JSON.stringify(u)),
};

export const api = {
  getMeta: (estate: string, lang: string, t?: string) => {
    const params = new URLSearchParams({ estate, lang });
    if (t) params.set('t', t);
    return request<FormMeta>(`/form/meta?${params.toString()}`);
  },
  getToken: (estate: string, t?: string) =>
    request<{ token: string }>('/form/token', {
      method: 'POST',
      body: { estate, ...(t ? { t } : {}) },
    }),
  submitFeedback: (body: FeedbackPayload) =>
    request<FeedbackResult>('/feedback', { method: 'POST', body }),
  login: (username: string, password: string) =>
    request<LoginResult>('/auth/login', { method: 'POST', body: { username, password } }),
  /** 變更密碼（FR-010-04）。強制改密情境 currentPassword 可省略（後端對 must_change_pwd 用戶不驗原密碼） */
  changePassword: (currentPassword: string | undefined, newPassword: string, token: string) =>
    request<{ changed: boolean }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      token,
    }),
  me: (token: string) => request<AdminUser>('/me', { token }),
  listCases: (query: string, token: string) => request<CaseListData>(`/cases?${query}`, { token }),
  caseDetail: (caseId: string, token: string) => request<CaseDetailData>(`/cases/${encodeURIComponent(caseId)}`, { token }),
  /** 客服人員手動新增個案（case:create） */
  createCase: (body: CreateCasePayload, token: string) =>
    request<CreateCaseResult>('/cases', { method: 'POST', body, token }),
  /* AI 建議（AI-01 影子模式；case:view 查閱、case:update 採納/忽略） */
  listAiSuggestions: (caseId: string, token: string) =>
    request<AiSuggestionItem[]>(`/cases/${encodeURIComponent(caseId)}/ai-suggestions`, { token }),
  acceptAiSuggestion: (caseId: string, suggestionId: number, token: string) =>
    request<AiDecideResult>(`/cases/${encodeURIComponent(caseId)}/ai-suggestions/${suggestionId}/accept`, { method: 'POST', body: {}, token }),
  rejectAiSuggestion: (caseId: string, suggestionId: number, token: string) =>
    request<AiDecideResult>(`/cases/${encodeURIComponent(caseId)}/ai-suggestions/${suggestionId}/reject`, { method: 'POST', body: {}, token }),
  refreshAiSuggestion: (caseId: string, token: string) =>
    request<AiSuggestionItem[]>(`/cases/${encodeURIComponent(caseId)}/ai-suggestions/refresh`, { method: 'POST', body: {}, token }),
  aiAssigneeSuggestion: (caseId: string, token: string) =>
    request<AiAssigneeSuggestion>(`/cases/${encodeURIComponent(caseId)}/ai-assignee-suggestion`, { token }),
  linkSimilarCase: (caseId: string, suggestionId: number, targetCaseId: string, token: string) =>
    request<AiLinkResult>(`/cases/${encodeURIComponent(caseId)}/ai-suggestions/${suggestionId}/link`, { method: 'POST', body: { targetCaseId }, token }),
  // AI-07 附件影像理解（§4.7）
  listAttachmentInsights: (caseId: string, token: string) =>
    request<{ items: AttachmentInsight[] }>(`/cases/${encodeURIComponent(caseId)}/attachments/ai-insights`, { token }),
  analyzeAttachment: (caseId: string, attachmentId: number, token: string) =>
    request<AttachmentInsight>(`/cases/${encodeURIComponent(caseId)}/attachments/${attachmentId}/analyze`, { method: 'POST', body: {}, token }),

  createAiDraft: (caseId: string, kind: 'summary' | 'reply', lang: string, token: string) =>
    request<AiDraftResult>(`/cases/${encodeURIComponent(caseId)}/ai-draft`, { method: 'POST', body: { kind, lang }, token }),
  useAiDraft: (caseId: string, suggestionId: number, content: string, token: string) =>
    request<AiDraftUseResult>(`/cases/${encodeURIComponent(caseId)}/ai-draft/${suggestionId}/use`, { method: 'POST', body: { content }, token }),
  caseFeedbackInsight: (caseId: string, token: string) =>
    request<{ insight: FeedbackInsightItem | null }>(`/cases/${encodeURIComponent(caseId)}/ai-feedback-insight`, { token }),
  surveyInsights: (query: string, token: string) =>
    request<SurveyInsightsData>(`/analytics/survey-insights?${query}`, { token }),
  runSurveyInsights: (limit: number, token: string) =>
    request<{ processed: number }>('/analytics/survey-insights/run', { method: 'POST', body: { limit }, token }),
  listQrOverview: (token: string) => request<QrOverviewData>('/qr/overview', { token }),
  generateQr: (estateCode: string, token: string, validUntil?: string | null) =>
    request<QrActionResult>('/qr/generate', { method: 'POST', body: { estateCode, validUntil: validUntil ?? null }, token }),
  setQrStatus: (qrId: number, active: boolean, token: string) =>
    request<QrActionResult>(`/qr/${qrId}/status`, { method: 'POST', body: { active }, token }),
  /** 設定有效日期；傳 null/空字串 = 永不自動停用 */
  setQrValidUntil: (qrId: number, validUntil: string | null, token: string) =>
    request<QrActionResult>(`/qr/${qrId}/valid-until`, { method: 'PUT', body: { validUntil }, token }),
  saveSiteBaseUrl: (siteBaseUrl: string, token: string) =>
    request<{ siteBaseUrl: string }>('/qr/site-url', { method: 'PUT', body: { siteBaseUrl }, token }),
  /* ------- F-004 個案動作 / F-006 完結 / F-007 問卷 / 通知中心 ------- */
  getAssignees: (caseId: string, token: string) =>
    request<AssigneesData>(`/cases/${encodeURIComponent(caseId)}/assignees`, { token }),
  assignCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/assign`, { method: 'POST', body, token }),
  reassignCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/reassign`, { method: 'POST', body, token }),
  startCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/start`, { method: 'POST', body, token }),
  waitingCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/waiting`, { method: 'POST', body, token }),
  resumeCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/resume`, { method: 'POST', body, token }),
  addNote: (caseId: string, content: string, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/note`, { method: 'POST', body: { content }, token }),
  changePriority: (caseId: string, priority: string, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/priority`, { method: 'POST', body: { priority }, token }),
  resolveRequest: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/resolve-request`, { method: 'POST', body, token }),
  approveCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/approve`, { method: 'POST', body, token }),
  rejectCase: (caseId: string, reason: string, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/reject`, { method: 'POST', body: { reason }, token }),
  reopenCase: (caseId: string, body: unknown, token: string) =>
    request<CaseActionResult>(`/cases/${encodeURIComponent(caseId)}/reopen`, { method: 'POST', body, token }),
  uploadAttachment: (caseId: string, fileName: string, fileDataBase64: string, token: string) =>
    request<{ attachmentId: number; fileName: string; fileSize: number }>(`/cases/${encodeURIComponent(caseId)}/attachments`, {
      method: 'POST',
      body: { fileName, fileDataBase64 },
      token,
    }),
  batchAssign: (body: unknown, token: string) =>
    request<BatchActionResult>('/cases/batch-assign', { method: 'POST', body, token }),
  batchUpdate: (body: unknown, token: string) =>
    request<BatchActionResult>('/cases/batch-update', { method: 'POST', body, token }),
  /* 通知中心（F-005 FR-005-04） */
  listNotifications: (token: string, query = '') => request<NotificationListData>(`/notifications?${query}`, { token }),
  unreadNotifications: (token: string) => request<{ unread: number }>('/notifications/unread-count', { token }),
  markNotificationRead: (notifId: number, token: string) =>
    request<{ updated: boolean }>(`/notifications/${notifId}/read`, { method: 'POST', token }),
  markAllNotificationsRead: (token: string) => request<{ updated: boolean }>('/notifications/read-all', { method: 'POST', token }),
  /* 問卷（F-007） */
  surveyStats: (token: string, estate = '') => request<SurveyStatsData>(`/surveys/stats${estate ? `?estate=${encodeURIComponent(estate)}` : ''}`, { token }),
  resendSurvey: (surveyId: number, token: string) =>
    request<{ surveyId: number; resendCount: number; sentAt: string }>(`/surveys/${surveyId}/resend`, { method: 'POST', token }),
  getSurvey: (token: string, lang: string) =>
    request<PublicSurvey>(`/survey/${encodeURIComponent(token)}?lang=${encodeURIComponent(lang)}`),
  submitSurvey: (token: string, body: { ratings: Record<string, number>; feedback: string }) =>
    request<SurveySubmitResult>(`/survey/${encodeURIComponent(token)}/submit`, { method: 'POST', body }),
  /* F-008 儀表板與週報 */
  dashboardSummary: (q: Parameters<typeof dashboardQuery>[0], token: string) =>
    request<DashboardSummaryData>(`/dashboard/summary${dashboardQuery(q)}`, { token }),
  dashboardTrend: (q: Parameters<typeof dashboardQuery>[0], token: string) =>
    request<{ items: TrendPoint[] }>(`/dashboard/trend${dashboardQuery(q)}`, { token }),
  dashboardDistribution: (q: Parameters<typeof dashboardQuery>[0], token: string) =>
    request<DistributionData>(`/dashboard/distribution${dashboardQuery(q)}`, { token }),
  dashboardHandlers: (q: Parameters<typeof dashboardQuery>[0], token: string) =>
    request<{ items: HandlerRow[] }>(`/dashboard/handlers${dashboardQuery(q)}`, { token }),
  dashboardAnomalies: (estate: string, token: string) =>
    request<AnomalyData>(`/dashboard/anomalies${estate ? `?estate=${encodeURIComponent(estate)}` : ''}`, { token }),
  weeklyReportRun: (token: string) =>
    request<WeeklyReportRunResult>('/dashboard/weekly-report/run', { method: 'POST', token }),
  weeklyReportList: (token: string, limit = 20) =>
    request<{ items: WeeklyReportItem[] }>(`/dashboard/weekly-report/list?limit=${limit}`, { token }),
  // AI-08 逾期風險預警（§4.8）
  listCaseRisks: (token: string, level?: string, limit = 20) =>
    request<{ items: RiskCaseItem[] }>(`/dashboard/risk-cases?limit=${limit}${level ? `&level=${encodeURIComponent(level)}` : ''}`, { token }),
  runRiskScan: (token: string) =>
    request<{ scanned: number; high: number; medium: number; low: number; notified: number; skipped?: boolean }>(
      '/dashboard/risk-cases/run', { method: 'POST', body: {}, token }),
  ackCaseRisk: (caseId: string, token: string) =>
    request<{ caseId: string; riskLevel: string; acknowledgedAt: string }>(
      `/dashboard/risk-cases/${encodeURIComponent(caseId)}/ack`, { method: 'POST', body: {}, token }),
  weeklyReportAiSummary: (reportId: number, token: string) =>
    request<{ reportId: number; aiSummary: string | null; aiSummaryModel: string | null; aiSummaryAt: string | null }>(`/dashboard/weekly-report/${reportId}/ai-summary`, { method: 'POST', token }),
  /* F-009 系統參數 */
  configList: (token: string) => request<ConfigListData>('/config', { token }),
  configAudit: (token: string, key = '', limit = 50) =>
    request<{ items: ConfigAuditRow[] }>(`/config/audit?limit=${limit}${key ? `&key=${encodeURIComponent(key)}` : ''}`, { token }),
  configUpdate: (key: string, value: unknown, token: string) =>
    request<ConfigUpdateResult>(`/config/${encodeURIComponent(key)}`, { method: 'PUT', body: { value }, token }),
  /* M0 AI 診斷（AI-01） */
  aiStatus: (token: string) => request<AiStatus>('/ai/status', { token }),
  /* 各頁 AI 功能開關快照（依系統參數 AI 開關計算） */
  aiFeatures: (token: string) => request<AiFeatures>('/ai/features', { token }),
  aiTest: (body: { text?: string; provider?: string }, token: string) =>
    request<AiTestResult>('/ai/test', { method: 'POST', body, token }),
  aiSetApiKey: (apiKey: string, token: string) =>
    request<AiApiKeyResult>('/ai/api-key', { method: 'PUT', body: { apiKey }, token }),
  aiClearApiKey: (token: string) =>
    request<AiApiKeyResult>('/ai/api-key', { method: 'DELETE', token }),
  aiScan: (token: string) =>
    request<{ processed: number }>('/ai/scan', { method: 'POST', body: {}, token }),
  /* AI-09 RAG 知識庫（§4.9；管理需 kb:manage，檢索/問答需 case:view 或 dashboard:view） */
  kbListDocuments: (token: string, status = '') =>
    request<{ items: KbDocument[] }>(`/ai/kb/documents${status ? `?status=${encodeURIComponent(status)}` : ''}`, { token }),
  kbIngest: (body: { docId?: string; title: string; source: string; version?: string; owner?: string; status?: string; content: string }, token: string) =>
    request<{ docId: string; chunkCount: number; model: string }>('/ai/kb/ingest', { method: 'POST', body, token }),
  kbSetStatus: (docId: string, status: string, token: string) =>
    request<KbDocument>(`/ai/kb/documents/${encodeURIComponent(docId)}/status`, { method: 'POST', body: { status }, token }),
  kbDelete: (docId: string, token: string) =>
    request<{ deleted: boolean }>(`/ai/kb/documents/${encodeURIComponent(docId)}`, { method: 'DELETE', token }),
  kbSearch: (query: string, topK: number, token: string) =>
    request<KbSearchData>('/ai/kb/search', { method: 'POST', body: { query, topK }, token }),
  kbAsk: (query: string, topK: number, token: string) =>
    request<KbAskData>('/ai/kb/ask', { method: 'POST', body: { query, topK }, token }),
  /* F-010 用戶管理 */
  listUsers: (query: string, token: string) => request<UserListData>(`/users?${query}`, { token }),
  createUser: (body: unknown, token: string) => request<UserRow>('/users', { method: 'POST', body, token }),
  updateUser: (userId: number, body: unknown, token: string) =>
    request<UserRow>(`/users/${userId}`, { method: 'PUT', body, token }),
  disableUser: (userId: number, token: string) =>
    request<{ userId: number; isActive: boolean }>(`/users/${userId}`, { method: 'DELETE', token }),
  resetUserPassword: (userId: number, token: string) =>
    request<{ userId: number; tempPassword: string }>(`/users/${userId}/reset-password`, { method: 'POST', token }),
  lockUser: (userId: number, token: string) => request<unknown>(`/users/${userId}/lock`, { method: 'POST', token }),
  unlockUser: (userId: number, token: string) => request<unknown>(`/users/${userId}/unlock`, { method: 'POST', token }),
  /* F-010 角色管理 */
  listRoles: (token: string) => request<RoleListData>('/roles', { token }),
  createRole: (body: unknown, token: string) => request<RoleRow>('/roles', { method: 'POST', body, token }),
  updateRole: (roleCode: string, body: unknown, token: string) =>
    request<RoleRow>(`/roles/${encodeURIComponent(roleCode)}`, { method: 'PUT', body, token }),
  copyRole: (body: unknown, token: string) => request<RoleRow>('/roles/copy', { method: 'POST', body, token }),
  deleteRole: (roleCode: string, token: string) =>
    request<unknown>(`/roles/${encodeURIComponent(roleCode)}`, { method: 'DELETE', token }),
  /* F-010 審計 */
  listAudit: (query: string, token: string) => request<AuditListData>(`/audit?${query}`, { token }),
  /* 屋苑主檔管理（後台「屋苑」頁） */
  listEstates: (token: string) => request<EstateListData>('/estates', { token }),
  createEstate: (body: unknown, token: string) => request<EstateItem>('/estates', { method: 'POST', body, token }),
  updateEstate: (estateCode: string, body: unknown, token: string) =>
    request<EstateItem>(`/estates/${encodeURIComponent(estateCode)}`, { method: 'PUT', body, token }),
};

/** 私有附件下載（帶 token 之 blob 下載） */
export async function downloadCaseAttachmentBlob(caseId: string, attachmentId: number, token: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/${encodeURIComponent(caseId)}/attachments/${attachmentId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const env = await parseEnvelope<null>(res);
    throw new ApiRequestError(env.code, env.message, env.data);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 以 blob 下載匯出檔（CSV/XLSX），套用目前篩選 */
export async function downloadExport(query: string, format: 'csv' | 'xlsx', token: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/export?format=${format}&${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const env = await parseEnvelope<null>(res);
    throw new ApiRequestError(env.code, env.message, env.data);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const m = disposition.match(/filename="?([^";]+)"?/);
  const filename = m ? m[1] : `feedback_cases.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 儀表板 CSV 匯出（F-008 FR-008-06 骨架；帶 token 之 blob 下載） */
export async function downloadDashboardCsv(q: Parameters<typeof dashboardQuery>[0], token: string): Promise<void> {
  const res = await fetch(`${BASE}/dashboard/export${dashboardQuery(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const env = await parseEnvelope<null>(res);
    throw new ApiRequestError(env.code, env.message, env.data);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const m = disposition.match(/filename="?([^";]+)"?/);
  const filename = m ? m[1] : 'dashboard_summary.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 以 blob 取得 QR 圖像（帶 token 呼叫 /qr/:id/image；供 <img> 預覽或下載） */
export async function qrImageBlob(qrId: number, format: 'png' | 'svg', size: number, token: string): Promise<Blob> {
  const res = await fetch(`${BASE}/qr/${qrId}/image?format=${format}&size=${size}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const env = await parseEnvelope<null>(res);
    throw new ApiRequestError(env.code, env.message, env.data);
  }
  return res.blob();
}

/** 下載 QR 圖檔：PNG 以 2048px 高解析輸出（列印用），SVG 為向量原檔 */
export async function downloadQrFile(qrId: number, format: 'png' | 'svg', token: string, filename: string): Promise<void> {
  const blob = await qrImageBlob(qrId, format, format === 'png' ? 2048 : 1024, token);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
