/**
 * 冪等資料補正（每次啟動執行，相容任何環境既有 DB，不需重置）：
 * 1. 補 `case` F-005 一次性標記欄位（既有 DB ALTER；新庫 schema.sql 已含）；
 * 2. 補權限碼（qr:generate / sla:run / case:resolve … / F-010 user:*、role:*、audit:*）；
 * 3. 補角色—權限綁定（含 F-004~F-007 操作權限，以及 F-010 用戶/角色管理權限）；
 * 4. 補系統參數（form.site_base_url / sla.reminder / survey.* / F-010 pwd.max_age_days）；
 * 5. 作廢指向 localhost / 127.0.0.1 的舊 QR 死碼；
 * 6. 補插種子屋苑。
 */
'use strict';

const ESTATES = [
  { estate_code: 'CWC', estate_name_zh: '灣景中心', estate_name_en: 'Bayview Centre', company_code: 'CRPM' },
  { estate_code: 'YPR', estate_name_zh: '攸壆路', estate_name_en: 'Yau Pok Road', company_code: 'PML' },
  { estate_code: 'CHNG', estate_name_zh: '頌雅苑', estate_name_en: 'Chung Nga Court', company_code: 'SMS' },
  { estate_code: 'DAHF', estate_name_zh: '大夫第', estate_name_en: 'Dai Fu House', company_code: 'SMS' },
];

/** 既有 DB 補欄位（新庫由 schema.sql 建表時已含） */
function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(\`${table}\`)`).all().map((c) => c.name);
  if (cols.includes(column)) return;
  db.exec(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${ddl}`);
}

const NEW_COLUMNS = [
  ['case', 'response_reminded_at', 'TEXT'],
  ['case', 'closure_reminded_at', 'TEXT'],
  ['case', 'response_escalated_at', 'TEXT'],
  ['case', 'closure_escalated_at', 'TEXT'],
  // QR Code 有效日期（NULL = 永不自動停用）
  ['qr_code', 'valid_until', 'TEXT'],
];

/** 權限碼、名稱 → 需綁定之角色（維持 seed 一致，舊 DB 靠此補齊） */
const PERM_BINDINGS = [
  { code: 'qr:generate', module: 'qr', name: 'QR 生成/停用', roles: ['ADMIN'] },
  { code: 'qr:view', module: 'qr', name: 'QR 查閱', roles: ['ADMIN', 'CC_SUPERVISOR'] },
  { code: 'sla:run', module: 'sla', name: 'SLA 提醒掃描', roles: ['ADMIN', 'CC_SUPERVISOR'] },
  { code: 'case:resolve', module: 'case', name: '完結申請', roles: ['ESTATE_STAFF', 'ESTATE_SUPERVISOR', 'CC_STAFF'] },
  // F-008/F-009（既有 DB 補齊權限碼與綁定）
  { code: 'dashboard:view', module: 'dashboard', name: '儀表板', roles: ['CC_STAFF', 'AUDITOR'] },
  { code: 'config:update', module: 'config', name: '參數更新', roles: ['ADMIN'] },
  { code: 'config:approve', module: 'config', name: '參數審批', roles: ['ADMIN'] },
  // F-010 用戶與權限管理（user:list 開放給可管轄用戶之人員；操作類限 ADMIN）
  { code: 'user:list', module: 'user', name: '用戶管理', roles: ['ADMIN', 'CC_SUPERVISOR', 'ESTATE_SUPERVISOR'] },
  { code: 'user:create', module: 'user', name: '用戶新增', roles: ['ADMIN'] },
  { code: 'user:update', module: 'user', name: '用戶修改', roles: ['ADMIN', 'CC_SUPERVISOR', 'ESTATE_SUPERVISOR'] },
  { code: 'user:disable', module: 'user', name: '用戶停用', roles: ['ADMIN'] },
  { code: 'user:reset_pwd', module: 'user', name: '重設密碼', roles: ['ADMIN'] },
  { code: 'user:lock', module: 'user', name: '鎖定/解鎖', roles: ['ADMIN'] },
  { code: 'role:list', module: 'role', name: '角色查閱', roles: ['ADMIN', 'CC_SUPERVISOR', 'ESTATE_SUPERVISOR'] },
  { code: 'role:manage', module: 'role', name: '角色管理', roles: ['ADMIN'] },
  { code: 'audit:view', module: 'audit', name: '審計查閱', roles: ['ADMIN', 'CC_SUPERVISOR', 'ESTATE_SUPERVISOR', 'AUDITOR'] },
  // 屋苑主檔管理（後台「屋苑」頁；下拉用 GET 僅需登入，不需本權限）
  { code: 'estate:list', module: 'estate', name: '屋苑查閱', roles: ['ADMIN', 'CC_SUPERVISOR', 'ESTATE_SUPERVISOR'] },
  { code: 'estate:manage', module: 'estate', name: '屋苑管理', roles: ['ADMIN'] },
];

/** 需確保存在之系統參數（INSERT OR IGNORE） */
const CONFIG_DEFAULTS = [
  ['form.site_base_url', 'FORM_STYLE'],
  ['sla.reminder', 'SLA'],
  ['survey.expiry_days', 'SLA'],
  ['survey.questions', 'SLA'],
  ['weekly_report.schedule', 'SYSTEM'],
  ['pwd.max_age_days', 'SYSTEM'],
];

function configValue(key) {
  const values = {
    'form.site_base_url': '',
    'sla.reminder': { responseLeadMinutes: { URGENT: 10, NORMAL: 30, COMPLEX: 30, INSTANT: 30 }, closureLeadDays: 1 },
    'weekly_report.schedule': { dayOfWeek: 'MON', time: '09:00' },
    'pwd.max_age_days': 90,
    'survey.expiry_days': 14,
    'survey.questions': {
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
    },
  };
  return values[key];
}

function ensureDefaults(db) {
  // 1) case 標記欄位（既有 DB 相容）
  for (const [table, col, ddl] of NEW_COLUMNS) ensureColumn(db, table, col, ddl);

  // 2) 權限碼
  const insPerm = db.prepare('INSERT OR IGNORE INTO sys_permission (perm_code, module, perm_name, perm_type) VALUES (?, ?, ?, ?)');
  for (const p of PERM_BINDINGS) insPerm.run(p.code, p.module, p.name, 'ACTION');

  const permId = (code) => db.prepare('SELECT permission_id FROM sys_permission WHERE perm_code = ?').get(code);
  const roleId = (code) => db.prepare('SELECT role_id FROM sys_role WHERE role_code = ?').get(code);

  // 3) 角色—權限綁定
  const link = db.prepare('INSERT OR IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)');
  for (const p of PERM_BINDINGS) {
    const pid = permId(p.code);
    if (!pid) continue;
    for (const rc of p.roles) {
      const rid = roleId(rc);
      if (rid) link.run(rid.role_id, pid.permission_id);
    }
  }

  // 4) 系統參數
  const insCfg = db.prepare('INSERT OR IGNORE INTO sys_config (config_key, config_value, config_type) VALUES (?, ?, ?)');
  for (const [key, type] of CONFIG_DEFAULTS) {
    insCfg.run(key, JSON.stringify(configValue(key)), type);
  }

  // 5) 作廢舊 localhost 死碼
  db.prepare(
    `UPDATE qr_code
        SET is_active = 0, invalidated_at = COALESCE(invalidated_at, datetime('now'))
      WHERE is_active = 1
        AND (qr_content LIKE 'http://localhost%'
          OR qr_content LIKE 'http://127.0.0.1%'
          OR qr_content LIKE 'http://[::1]%')`
  ).run();

  // 6) 種子屋苑（空庫保險）
  const insEstate = db.prepare(
    'INSERT OR IGNORE INTO sys_estate (estate_code, estate_name_zh, estate_name_en, company_code) VALUES (?, ?, ?, ?)'
  );
  for (const e of ESTATES) insEstate.run(e.estate_code, e.estate_name_zh, e.estate_name_en, e.company_code);
}

module.exports = { ensureDefaults, ensureColumn };
