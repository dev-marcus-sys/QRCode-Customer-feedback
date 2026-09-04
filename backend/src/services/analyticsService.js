/**
 * F-008 數據分析與儀表板（規格書 6.4 KPI / FR-008-01~09）。
 * - 即時 SQL 聚合（不另建彙總表；骨架資料量級下即時可滿足，FR-008-09）
 * - 期間切面：一律以香港時區日期換算 UTC 邊界（資料庫存 UTC 字串）
 * - 屋苑篩選／數據範圍：與 surveyService.surveyStats 同一模式
 * - KPI 定義見 docs/F008-F009_細部設計.md §5
 */
'use strict';
const { getConfig } = require('../db/configStore');
const { STATUS_META, EVENT_TYPE } = require('../config/constants');
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const { parseDb, toDb, dateRangeUtc } = require('../utils/time');

const DAY_MS = 24 * 60 * 60 * 1000;
const HK_MS = 8 * 60 * 60 * 1000;

/** 單一真源：KPI 顯示 meta 與計算語意（§5 表格） */
const KPI_META = {
  KPI_01: { labelZh: '累計意見宗數', unit: '宗', target: null, good: null, dec: 0 },
  KPI_02: { labelZh: '平均結案時效', unit: '天', target: 3, good: 'down', dec: 1 },
  KPI_03: { labelZh: '未關閉個案', unit: '宗', target: null, good: null, dec: 0 },
  KPI_04: { labelZh: 'QR 提交量', unit: '宗', target: null, good: null, dec: 0 },
  KPI_05: { labelZh: '二次投訴比率', unit: '%', target: 2, good: 'down', dec: 1 },
  KPI_06: { labelZh: '首次回應及時率', unit: '%', target: 95, good: 'up', dec: 1 },
  KPI_07: { labelZh: '7 天關閉達標率', unit: '%', target: 90, good: 'up', dec: 1 },
  KPI_08: { labelZh: '問卷回覆率', unit: '%', target: 30, good: 'up', dec: 1 },
  KPI_09: { labelZh: '平均滿意度', unit: '分', target: 4.0, good: 'up', dec: 2 },
  KPI_10: { labelZh: '低分個案比率', unit: '%', target: 5, good: 'down', dec: 1 },
  KPI_11: { labelZh: '逾期／升級個案', unit: '宗', target: 0, good: 'down', dec: 0 },
  KPI_12: { labelZh: '分派處理時效', unit: '小時', target: 1, good: 'down', dec: 1 },
};

const INTENT_LABEL = {
  COMPLAINT: { labelZh: '投訴', labelEn: 'Complaint' },
  FEEDBACK: { labelZh: '反饋意見', labelEn: 'Feedback' },
  INQUIRY: { labelZh: '查詢', labelEn: 'Inquiry' },
  COMPLIMENT: { labelZh: '讚揚', labelEn: 'Compliment' },
};

const CATEGORY_LABEL_DEFAULT = {
  MO_SERVICE: { labelZh: '管理處人員服務', labelEn: 'Property Management Service' },
  SECURITY: { labelZh: '保安人員服務', labelEn: 'Security Service' },
  MAINTENANCE: { labelZh: '維修事宜', labelEn: 'Maintenance' },
  CLEANLINESS: { labelZh: '衞生事宜', labelEn: 'Cleanliness' },
  NUISANCE: { labelZh: '滋擾事宜', labelEn: 'Nuisance' },
  OTHER: { labelZh: '其他', labelEn: 'Others' },
};

/* ---------------- 香港時區日期工具 ---------------- */

function hkParts(nowMs) {
  const h = new Date(nowMs + HK_MS);
  return { y: h.getUTCFullYear(), m: h.getUTCMonth(), date: h.getUTCDate(), dow: h.getUTCDay() };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function hkYmd(utcDate) {
  const h = new Date(utcDate.getTime() + HK_MS);
  return `${h.getUTCFullYear()}-${pad2(h.getUTCMonth() + 1)}-${pad2(h.getUTCDate())}`;
}

/** 香港時區 y/m/d 之午夜（回傳 UTC ms） */
function hkMidMs(y, m0, d) {
  return Date.UTC(y, m0, d, 0, 0, 0) - HK_MS;
}

const RANGE_LABEL = {
  today: '本日',
  thisWeek: '本週',
  thisMonth: '本月',
  thisQuarter: '本季',
  thisYear: '本年',
  custom: '自訂區間',
};

function assertDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ApiError(ERR.VALIDATION, '日期格式須為 YYYY-MM-DD');
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ApiError(ERR.VALIDATION, '日期不合法');
  return s;
}

function utcFrom(dateStr) {
  return parseDb(dateRangeUtc(dateStr, false)).getTime();
}

/**
 * 解析期間（香港日）→ HK 日期標籤與起訖 ms。
 * @returns {{ from, to, fromMs, toMs, labelZh }}
 */
function periodRange(preset = 'thisMonth', from, to, nowMs = Date.now()) {
  const parts = hkParts(nowMs);
  let fd;
  let td;
  const p = preset || 'thisMonth';
  switch (p) {
    case 'today':
      fd = `${parts.y}-${pad2(parts.m + 1)}-${pad2(parts.date)}`;
      td = fd;
      break;
    case 'thisWeek': {
      const monday = new Date(hkMidMs(parts.y, parts.m, parts.date) - ((parts.dow + 6) % 7) * DAY_MS);
      fd = hkYmd(monday);
      td = hkYmd(new Date(monday.getTime() + 6 * DAY_MS));
      break;
    }
    case 'thisMonth':
      fd = `${parts.y}-${pad2(parts.m + 1)}-01`;
      td = hkYmd(new Date(Date.UTC(parts.y, parts.m + 1, 0))); // 該月最後一天
      break;
    case 'thisQuarter': {
      const qs = Math.floor(parts.m / 3) * 3;
      fd = `${parts.y}-${pad2(qs + 1)}-01`;
      td = hkYmd(new Date(Date.UTC(parts.y, qs + 3, 0)));
      break;
    }
    case 'thisYear':
      fd = `${parts.y}-01-01`;
      td = `${parts.y}-12-31`;
      break;
    case 'custom': {
      fd = assertDate(from);
      td = assertDate(to);
      if (fd > td) throw new ApiError(ERR.VALIDATION, '開始日期不得晚於結束日期');
      break;
    }
    default:
      throw new ApiError(ERR.VALIDATION, '不支援的期間');
  }
  const fromMs = utcFrom(fd);
  const toMs = parseDb(dateRangeUtc(td, true)).getTime();
  return { from: fd, to: td, fromMs, toMs, labelZh: RANGE_LABEL[p] || '自訂區間' };
}

/** 上週（香港週一~週日）；供週報與「與上期比較」共用 */
function lastWeekRange(nowMs = Date.now()) {
  const parts = hkParts(nowMs);
  const monday = new Date(hkMidMs(parts.y, parts.m, parts.date) - ((parts.dow + 6) % 7) * DAY_MS);
  const lastMon = new Date(monday.getTime() - 7 * DAY_MS);
  return { from: hkYmd(lastMon), to: hkYmd(new Date(lastMon.getTime() + 6 * DAY_MS)) };
}

/* ---------------- 範圍與權限 ---------------- */

function effectiveEstate(user, filters) {
  if (user && user.estateCode && user.estateCode !== 'ALL') return user.estateCode;
  return filters && filters.estate ? filters.estate : '';
}

function estateScope(user, filters) {
  const estate = effectiveEstate(user, filters);
  if (!estate) return { where: '', params: [] };
  return { where: ' AND c.estate_code = ?', params: [estate] };
}

function nowDbAt(nowMs) {
  return toDb(new Date(nowMs));
}

/* ---------------- 核心指標（SQL 聚合） ---------------- */

function computeMetrics(db, fromDb, toDb, scope, nowDb) {
  const s = scope.where;
  const createdWhere = `c.created_at BETWEEN ? AND ?${s}`;
  const createdP = [fromDb, toDb, ...scope.params];

  const agg = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN c.case_source = 'QR' THEN 1 ELSE 0 END), 0) AS qrCount,
            COALESCE(SUM(CASE WHEN c.is_second_complaint = 1 THEN 1 ELSE 0 END), 0) AS secondCount,
            COALESCE(SUM(CASE WHEN c.case_status <> 'CLOSED' THEN 1 ELSE 0 END), 0) AS openCount
       FROM \`case\` c WHERE ${createdWhere}`
  ).get(...createdP);

  const resp = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN c.response_sla_due IS NOT NULL AND c.event_type <> 'N/A' THEN 1 ELSE 0 END), 0) AS respDue,
            COALESCE(SUM(CASE WHEN c.response_sla_met = 1 THEN 1 ELSE 0 END), 0) AS respMet
       FROM \`case\` c WHERE ${createdWhere}`
  ).get(...createdP);

  const closed = db.prepare(
    `SELECT COUNT(*) AS closedCount,
            AVG(c.handling_days) AS avgDays,
            COALESCE(SUM(CASE WHEN c.closure_sla_met = 1 THEN 1 ELSE 0 END), 0) AS closureMet,
            COALESCE(SUM(CASE WHEN c.closure_sla_due IS NOT NULL THEN 1 ELSE 0 END), 0) AS closureDue
       FROM \`case\` c WHERE c.closed_at BETWEEN ? AND ? AND c.case_status = 'CLOSED'${s}`
  ).get(fromDb, toDb, ...scope.params);

  const survey = db.prepare(
    `SELECT COUNT(*) AS sent,
            COALESCE(SUM(CASE WHEN s.status = 'SUBMITTED' THEN 1 ELSE 0 END), 0) AS submitted,
            COALESCE(SUM(CASE WHEN s.status = 'SUBMITTED' AND s.is_low_score = 1 THEN 1 ELSE 0 END), 0) AS lowCount,
            AVG(CASE WHEN s.status = 'SUBMITTED' THEN s.rating_overall END) AS avgOverall
       FROM \`case\` c JOIN satisfaction_survey s ON s.case_id = c.case_id
      WHERE ${createdWhere}`
  ).get(...createdP);

  // KPI-12：分派後首次進入 IN_PROGRESS 之平均時效（小時）
  const dispatch = db.prepare(
    `SELECT AVG(dh) AS avgHours FROM (
        SELECT (julianday(l.mi) - julianday(c.assigned_at)) * 24 AS dh
          FROM (SELECT c.case_id, c.assigned_at
                  FROM \`case\` c
                 WHERE c.assigned_at IS NOT NULL AND ${createdWhere}) c
          JOIN (SELECT case_id AS cid, MIN(action_at) AS mi
                  FROM case_log WHERE new_status = 'IN_PROGRESS'
                 GROUP BY case_id) l ON l.cid = c.case_id
     )`
  ).get(...createdP);

  // 逾時（實時；RESOLVED 於審核中不視為逾時，與 SLA 掃描一致）
  const overdue = db.prepare(
    `SELECT COUNT(*) AS c FROM \`case\` c
      WHERE c.closed_at IS NULL AND c.case_status NOT IN ('CLOSED','RESOLVED')${s}
        AND ((c.response_sla_due IS NOT NULL AND c.first_response_at IS NULL AND c.response_sla_due < ?)
          OR (c.closure_sla_due IS NOT NULL AND c.closure_sla_due < ?))`
  ).get(...scope.params, nowDb, nowDb).c;

  return {
    total: Number(agg.total || 0),
    qrCount: Number(agg.qrCount || 0),
    secondCount: Number(agg.secondCount || 0),
    openCount: Number(agg.openCount || 0),
    respDue: Number(resp.respDue || 0),
    respMet: Number(resp.respMet || 0),
    closedCount: Number(closed.closedCount || 0),
    avgDays: closed.avgDays == null ? null : Number(closed.avgDays),
    closureDue: Number(closed.closureDue || 0),
    closureMet: Number(closed.closureMet || 0),
    sent: Number(survey.sent || 0),
    submitted: Number(survey.submitted || 0),
    lowCount: Number(survey.lowCount || 0),
    avgOverall: survey.avgOverall == null ? null : Number(survey.avgOverall),
    avgHours: dispatch.avgHours == null ? null : Number(dispatch.avgHours),
    overdueCount: Number(overdue || 0),
  };
}

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

function derive(m) {
  return {
    total: Number(m.total),
    avgDays: m.avgDays == null ? null : r1(m.avgDays),
    openCount: Number(m.openCount),
    qrCount: Number(m.qrCount),
    secondRate: pct(m.secondCount, m.total),
    firstRespRate: pct(m.respMet, m.respDue),
    closureRate: pct(m.closureMet, m.closureDue),
    replyRate: pct(m.submitted, m.sent),
    avgOverall: m.avgOverall == null ? null : r2(m.avgOverall),
    lowRate: pct(m.lowCount, m.submitted),
    overdueCount: Number(m.overdueCount),
    avgHours: m.avgHours == null ? null : r1(m.avgHours),
  };
}

function metOf(def, v) {
  if (!def.target || v == null) return null;
  if (def.good === 'up') return v >= def.target;
  if (def.good === 'down') return v <= def.target;
  return null;
}

function fmtValue(def, v) {
  if (v == null) return null;
  if (def.dec === 2) return r2(v);
  if (def.dec === 1) return r1(v);
  return Math.round(v);
}

function diffOf(def, a, b) {
  if (a == null || b == null) return a == null ? null : (def.dec === 2 ? r2(a) : def.dec === 1 ? r1(a) : Math.round(a));
  const d = a - b;
  if (def.dec === 2) return r2(d);
  if (def.dec === 1) return r1(d);
  return Math.round(d);
}

/** 組裝 12 張 KPI 卡（現期 vs 上期；KPI-11 為實時值，無 delta） */
function assembleKpi(m, p) {
  const now = derive(m);
  const prev = p ? derive(p) : null;
  const fields = {
    KPI_01: 'total', KPI_02: 'avgDays', KPI_03: 'openCount', KPI_04: 'qrCount',
    KPI_05: 'secondRate', KPI_06: 'firstRespRate', KPI_07: 'closureRate',
    KPI_08: 'replyRate', KPI_09: 'avgOverall', KPI_10: 'lowRate',
    KPI_11: 'overdueCount', KPI_12: 'avgHours',
  };
  return Object.entries(fields).map(([key, field]) => {
    const def = KPI_META[key];
    const cur = now[field];
    const pr = prev ? prev[field] : null;
    return {
      key,
      labelZh: def.labelZh,
      unit: def.unit,
      target: def.target,
      good: def.good,
      value: fmtValue(def, cur),
      delta: key === 'KPI_11' ? null : diffOf(def, cur, pr),
      met: metOf(def, fmtValue(def, cur)),
    };
  });
}

/* ---------------- 異常（計數與清單） ---------------- */

function overdueRows(db, scope, nowDb) {
  const rows = db.prepare(
    `SELECT c.case_id AS caseId, c.case_status AS status, c.estate_code AS estateCode,
            e.estate_name_zh AS estateNameZh, c.response_sla_due AS responseDue,
            c.closure_sla_due AS closureDue, c.first_response_at AS firstResponseAt,
            c.closed_at AS closedAt, c.created_at AS createdAt
       FROM \`case\` c JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE c.closed_at IS NULL AND c.case_status NOT IN ('CLOSED','RESOLVED')${scope.where}
        AND ((c.response_sla_due IS NOT NULL AND c.first_response_at IS NULL AND c.response_sla_due < ?)
          OR (c.closure_sla_due IS NOT NULL AND c.closure_sla_due < ?))
      ORDER BY c.created_at DESC LIMIT 500`
  ).all(...scope.params, nowDb, nowDb);
  const out = [];
  for (const r of rows) {
    const list = [];
    if (r.responseDue && !r.firstResponseAt && r.responseDue < nowDb) list.push({ kind: 'response', due: r.responseDue });
    if (r.closureDue && !r.closedAt && r.closureDue < nowDb) list.push({ kind: 'closure', due: r.closureDue });
    if (!list.length) continue;
    const earliest = list.sort((a, b) => (a.due < b.due ? -1 : 1))[0];
    out.push({
      type: 'OVERDUE',
      aspect: earliest.kind === 'response' ? '首應逾期' : '關閉逾期',
      caseId: r.caseId,
      estateCode: r.estateCode,
      estateNameZh: r.estateNameZh,
      status: r.status,
      dueAt: toDb2Iso(earliest.due),
      createdAt: toDb2Iso(r.createdAt),
    });
  }
  return out;
}

function lowScoreRows(db, scope, limit) {
  return db.prepare(
    `SELECT s.case_id AS caseId, c.case_status AS status, c.estate_code AS estateCode,
            e.estate_name_zh AS estateNameZh, s.submitted_at AS submittedAt
       FROM satisfaction_survey s
       JOIN \`case\` c ON c.case_id = s.case_id
       JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE s.status = 'SUBMITTED' AND s.is_low_score = 1${scope.where}
      ORDER BY s.submitted_at DESC LIMIT ?`
  ).all(...scope.params, limit).map((r) => ({
    type: 'LOW_SCORE',
    caseId: r.caseId,
    estateCode: r.estateCode,
    estateNameZh: r.estateNameZh,
    status: r.status,
    createdAt: toDb2Iso(r.submittedAt),
  }));
}

function secondRows(db, scope, limit) {
  return db.prepare(
    `SELECT c.case_id AS caseId, c.case_status AS status, c.estate_code AS estateCode,
            e.estate_name_zh AS estateNameZh, c.created_at AS createdAt
       FROM \`case\` c JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE c.is_second_complaint = 1${scope.where}
      ORDER BY c.created_at DESC LIMIT ?`
  ).all(...scope.params, limit).map((r) => ({
    type: 'SECOND',
    caseId: r.caseId,
    estateCode: r.estateCode,
    estateNameZh: r.estateNameZh,
    status: r.status,
    createdAt: toDb2Iso(r.createdAt),
  }));
}

function toDb2Iso(s) {
  const d = parseDb(s);
  if (!d) return null;
  const hk = new Date(d.getTime() + HK_MS);
  return `${hk.getUTCFullYear()}-${pad2(hk.getUTCMonth() + 1)}-${pad2(hk.getUTCDate())}T${pad2(hk.getUTCHours())}:${pad2(hk.getUTCMinutes())}:${pad2(hk.getUTCSeconds())}+08:00`;
}

/**
 * 異常清單（實時；可依屋苑數據範圍）。
 * @returns {{ counts: {OVERDUE:number,LOW_SCORE:number,SECOND:number}, items: [] }}
 */
function anomalies(db, user, filters = {}, { limit = 100 } = {}) {
  const scope = estateScope(user, filters);
  const nowDb = nowDbAt(Date.now());
  const over = overdueRows(db, scope, nowDb);
  const low = lowScoreRows(db, scope, 500);
  const sec = secondRows(db, scope, 500);
  const items = [...over, ...low, ...sec]
    .sort((a, b) => ((b.createdAt || '') < (a.createdAt || '') ? -1 : 1))
    .slice(0, limit);
  return {
    counts: {
      OVERDUE: over.length,
      LOW_SCORE: low.length,
      SECOND: sec.length,
    },
    items,
  };
}

/* ---------------- 分布 / 趨勢 / 處理人員 ---------------- */

function categoryLabel(db, code) {
  const cfg = getConfig(db, 'form.categories', {});
  const c = cfg[code] || CATEGORY_LABEL_DEFAULT[code];
  return c ? c.labelZh : code;
}

function distributions(db, user, filters = {}) {
  const pr = periodRange(filters.range, filters.from, filters.to);
  const scope = estateScope(user, filters);
  const fromDb = toDb(new Date(pr.fromMs));
  const toDbEnd = toDb(new Date(pr.toMs));
  const s = scope.where;
  const baseP = [fromDb, toDbEnd, ...scope.params];
  const where = `c.created_at BETWEEN ? AND ?${s}`;
  const run = (col, label) =>
    db.prepare(
      `SELECT ${col} AS code, COUNT(*) AS count
         FROM \`case\` c WHERE ${where}
        GROUP BY ${col} ORDER BY count DESC`
    ).all(...baseP).map((r) => ({
      code: r.code,
      labelZh: label(r.code),
      count: Number(r.count),
    }));
  const total = run('c.case_status', () => '').reduce((a, r) => a + r.count, 0);
  const fillRate = (arr) => arr.map((r) => ({ ...r, rate: total ? Math.round((r.count / total) * 1000) / 10 : 0 }));

  const estate = db.prepare(
    `SELECT c.estate_code AS code, e.estate_name_zh AS labelZh, COUNT(*) AS count
       FROM \`case\` c JOIN sys_estate e ON e.estate_code = c.estate_code
      WHERE ${where} GROUP BY c.estate_code ORDER BY count DESC`
  ).all(...baseP).map((r) => ({ code: r.code, labelZh: r.labelZh, count: Number(r.count) }));

  const withRate = (arr) => arr.map((r) => ({ ...r, rate: total ? Math.round((r.count / total) * 1000) / 10 : 0 }));

  return {
    total,
    intent: withRate(run('c.intent_type', (code) => (INTENT_LABEL[code] || {}).labelZh || code)),
    category: withRate(run('c.category_code', (code) => categoryLabel(db, code))),
    status: withRate(run('c.case_status', (code) => (STATUS_META[code] || {}).labelZh || code)),
    estate: withRate(estate),
  };
}

/** 最近 12 個香港月之建案/關閉趨勢 */
function trend(db, user, filters = {}) {
  const scope = estateScope(user, filters);
  const parts = hkParts(Date.now());
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(parts.y, parts.m - i, 1));
    months.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  const fromDb = toDb(new Date(Date.UTC(parts.y, parts.m - 11, 1) - HK_MS));
  const toDbEnd = toDb(new Date(Date.UTC(parts.y, parts.m + 1, 1) - HK_MS - 1));
  const s = scope.where;
  const createdMap = new Map(
    db.prepare(
      `SELECT strftime('%Y-%m', c.created_at, '+8 hours') AS ym, COUNT(*) AS c
         FROM \`case\` c WHERE c.created_at BETWEEN ? AND ?${s}
        GROUP BY ym`
    ).all(fromDb, toDbEnd, ...scope.params).map((r) => [r.ym, Number(r.c)])
  );
  const closedMap = new Map(
    db.prepare(
      `SELECT strftime('%Y-%m', c.closed_at, '+8 hours') AS ym, COUNT(*) AS c
         FROM \`case\` c
        WHERE c.closed_at IS NOT NULL AND c.closed_at BETWEEN ? AND ?${s}
        GROUP BY ym`
    ).all(fromDb, toDbEnd, ...scope.params).map((r) => [r.ym, Number(r.c)])
  );
  return months.map((ym) => ({ ym, created: createdMap.get(ym) || 0, closed: closedMap.get(ym) || 0 }));
}

function handlers(db, user, filters = {}) {
  const pr = periodRange(filters.range, filters.from, filters.to);
  const scope = estateScope(user, filters);
  const fromDb = toDb(new Date(pr.fromMs));
  const toDbEnd = toDb(new Date(pr.toMs));
  const rows = db.prepare(
    `SELECT c.assigned_to AS userId, u.full_name AS fullName,
            e2.estate_name_zh AS estateNameZh,
            COUNT(*) AS caseCount,
            COALESCE(SUM(CASE WHEN c.case_status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS closedCount,
            AVG(CASE WHEN c.case_status = 'CLOSED' THEN c.handling_days END) AS avgDays,
            AVG(s.avgSat) AS avgSat
       FROM \`case\` c
       JOIN sys_user u ON u.user_id = c.assigned_to
       LEFT JOIN sys_estate e2 ON e2.estate_code = u.estate_code
       LEFT JOIN (SELECT case_id AS cid, AVG(rating_overall) AS avgSat
                    FROM satisfaction_survey
                   WHERE status = 'SUBMITTED'
                   GROUP BY case_id) s ON s.cid = c.case_id
      WHERE c.assigned_to IS NOT NULL AND c.created_at BETWEEN ? AND ?${scope.where}
      GROUP BY c.assigned_to
      ORDER BY caseCount DESC LIMIT 20`
  ).all(fromDb, toDbEnd, ...scope.params);
  return rows.map((r) => ({
    userId: r.userId,
    fullName: r.fullName,
    estateNameZh: r.estateNameZh || '',
    caseCount: Number(r.caseCount),
    closedCount: Number(r.closedCount),
    avgHandlingDays: r.avgDays == null ? null : r1(Number(r.avgDays)),
    avgSatisfaction: r.avgSat == null ? null : r2(Number(r.avgSat)),
  }));
}

/* ---------------- KPI 摘要（含上期 delta） ---------------- */

const ALL_SCOPE_USER = { userId: 0, username: 'SYSTEM', estateCode: 'ALL' };

/**
 * @param {object} [opts] { nowMs, withPrev }
 * @returns {{ range, estate, kpi, statusCounts, anomalySummary }}
 */
function summary(db, user = ALL_SCOPE_USER, filters = {}, opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  const pr = periodRange(filters.range, filters.from, filters.to, nowMs);
  const scope = estateScope(user, filters);
  const fromDb = toDb(new Date(pr.fromMs));
  const toDbEnd = toDb(new Date(pr.toMs));
  const nowDb = nowDbAt(nowMs);
  const m = computeMetrics(db, fromDb, toDbEnd, scope, nowDb);

  let prev = null;
  if (opts.withPrev !== false) {
    const lenMs = pr.toMs - pr.fromMs + 1;
    const prevTo = new Date(pr.fromMs - 1);
    const prevFrom = new Date(pr.fromMs - lenMs + 1);
    prev = computeMetrics(db, toDb(prevFrom), toDb(prevTo), scope, nowDb);
  }

  const kpi = assembleKpi(m, prev);
  const statusCounts = db.prepare(
    `SELECT c.case_status AS status, COUNT(*) AS count
       FROM \`case\` c WHERE c.created_at BETWEEN ? AND ?${scope.where}
      GROUP BY c.case_status`
  ).all(fromDb, toDbEnd, ...scope.params).map((r) => ({ status: r.status, count: Number(r.count) }));

  return {
    range: { from: pr.from, to: pr.to, labelZh: pr.labelZh },
    estate: effectiveEstate(user, filters) || 'ALL',
    kpi,
    statusCounts,
    anomalySummary: {
      OVERDUE: Number(m.overdueCount),
      LOW_SCORE: db.prepare(
        `SELECT COUNT(*) AS c FROM satisfaction_survey s
           JOIN \`case\` c ON c.case_id = s.case_id
          WHERE s.status = 'SUBMITTED' AND s.is_low_score = 1${scope.where}`
      ).get(...scope.params).c,
      SECOND: db.prepare(
        `SELECT COUNT(*) AS c FROM \`case\` c WHERE c.is_second_complaint = 1${scope.where}`
      ).get(...scope.params).c,
    },
  };
}

/* ---------------- CSV 匯出（FR-008-06 骨架：CSV UTF-8 BOM） ---------------- */

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildExportCsv(db, user, filters = {}) {
  const pr = periodRange(filters.range, filters.from, filters.to);
  const scope = estateScope(user, filters);
  const fromDb = toDb(new Date(pr.fromMs));
  const toDbEnd = toDb(new Date(pr.toMs));
  const nowDb = nowDbAt(Date.now());
  const m = computeMetrics(db, fromDb, toDbEnd, scope, nowDb);
  const lenMs = pr.toMs - pr.fromMs + 1;
  const prevTo = new Date(pr.fromMs - 1);
  const prevFrom = new Date(pr.fromMs - lenMs + 1);
  const pm = computeMetrics(db, toDb(prevFrom), toDb(prevTo), scope, nowDb);
  const dist = distributions(db, user, { range: filters.range, from: filters.from, to: filters.to });
  const hd = handlers(db, user, { range: filters.range, from: filters.from, to: filters.to });
  const an = anomalies(db, user, {}, { limit: 100 });

  const L = [];
  const push = (row) => L.push(row.map(csvEscape).join(','));
  push(['QRCode 客戶意見反饋 — 儀表板匯出', toDb2Iso(nowDb)]);
  push([`期間：${pr.labelZh} ${pr.from} ~ ${pr.to}`, `屋苑：${effectiveEstate(user, filters) || '全部'}`]);
  push([]);
  push(['-- KPI --', '數值', '單位', '目標', '與上期比較']);
  for (const k of assembleKpi(m, pm)) {
    push([k.labelZh, k.value, k.unit, k.target == null ? '—' : k.target, k.delta == null ? '—' : k.delta]);
  }
  push([]);
  const distSec = [['意見性質', dist.intent], ['事項類別', dist.category], ['屋苑', dist.estate], ['狀態', dist.status]];
  for (const [name, arr] of distSec) {
    push([`-- ${name}分布 --`, '宗數', '佔比%']);
    for (const r of arr) push([r.labelZh, r.count, r.rate]);
    push([]);
  }
  push(['-- 處理人員績效 --', '屋苑', '處理宗數', '結案', '平均結案(天)', '平均滿意度']);
  for (const r of hd) push([r.fullName, r.estateNameZh, r.caseCount, r.closedCount, r.avgHandlingDays == null ? '—' : r.avgHandlingDays, r.avgSatisfaction == null ? '—' : r.avgSatisfaction]);
  push([]);
  push(['-- 異常清單 --', '類型', '個案', '屋苑', '狀態']);
  for (const r of an.items) push([r.type, r.aspect || r.type, r.caseId, r.estateNameZh, r.status]);

  const stamp = toDb2Iso(nowDb).slice(0, 16).replace(/[-:T]/g, '');
  return {
    buffer: Buffer.from(`\uFEFF${L.join('\r\n')}`, 'utf8'),
    filename: `dashboard_${effectiveEstate(user, filters) || 'ALL'}_${stamp}.csv`,
  };
}

module.exports = {
  summary,
  trend,
  distributions,
  handlers,
  anomalies,
  buildExportCsv,
  periodRange,
  lastWeekRange,
  KPI_META,
};
