/**
 * F-009 系統參數配置（/admin/config；config:view 可看，config:update 可編輯）。
 * 對應 docs/F008-F009_細部設計.md §8.2。骨架採「直接修改即時生效＋完整審計」。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider, IconButton, MenuItem, Snackbar, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
import TuneIcon from '@mui/icons-material/Tune';
import EditIcon from '@mui/icons-material/Edit';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  ApiRequestError, authStore, ConfigAuditRow, ConfigGroup, ConfigItem, api,
} from '../../api/client';
import { CATEGORY_OPTIONS, EVENT_OPTIONS } from '../../admin/options';
import { NotificationCenter } from '../../components/NotificationCenter';

const WEEKDAY_OPTIONS = [
  { code: 'MON', zh: '星期一' }, { code: 'TUE', zh: '星期二' }, { code: 'WED', zh: '星期三' },
  { code: 'THU', zh: '星期四' }, { code: 'FRI', zh: '星期五' }, { code: 'SAT', zh: '星期六' }, { code: 'SUN', zh: '星期日' },
];
const RESPONSE_KEYS = ['URGENT', 'NORMAL', 'COMPLEX', 'INSTANT'];
const RESPONSE_ZH: Record<string, string> = { URGENT: '緊急', NORMAL: '一般', COMPLEX: '複雜', INSTANT: '即時' };

function describe(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.entries(o).map(([k, val]) => {
      if (typeof val === 'object' && val) {
        const sub = val as Record<string, unknown>;
        return `${k}: {${Object.entries(sub).map(([kk, vv]) => `${kk}=${String(vv)}`).join(' ')}}`;
      }
      return `${k}=${String(val)}`;
    }).join('　');
  }
  return String(v);
}

export function ConfigPage() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const canEdit = !!user?.permissions?.includes('config:update');

  const [groups, setGroups] = useState<ConfigGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [editItem, setEditItem] = useState<ConfigItem | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | number | string | null>(null);
  const [saving, setSaving] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<ConfigAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .configList(token)
      .then((d) => setGroups(d.groups))
      .catch((e) => {
        setError(e instanceof ApiRequestError ? e.message : '載入配置失敗');
        if (e instanceof ApiRequestError && (e.code === 2001 || e.code === 2005)) {
          authStore.clear();
          navigate('/admin/login', { replace: true });
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const openAudit = () => {
    setAuditOpen(true);
    setAuditLoading(true);
    api
      .configAudit(token)
      .then((d) => setAudit(d.items))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入審計失敗'))
      .finally(() => setAuditLoading(false));
  };

  if (!user?.permissions?.includes('config:view')) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button>
        </Toolbar>
        <Alert severity="warning">當前帳號沒有 config:view 權限，無法查看系統參數。</Alert>
      </Box>
    );
  }

  const logout = () => {
    authStore.clear();
    navigate('/admin/login', { replace: true });
  };

  const setObj = (path: string, value: unknown) => {
    setDraft((prev) => {
      const base = (prev && typeof prev === 'object' ? JSON.parse(JSON.stringify(prev)) : {}) as Record<string, unknown>;
      const keys = path.split('.');
      let cur: Record<string, unknown> = base;
      for (let i = 0; i < keys.length - 1; i += 1) {
        const k = keys[i];
        if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k] as Record<string, unknown>;
      }
      cur[keys[keys.length - 1]] = value;
      return base;
    });
  };

  const num = (v: string) => (v === '' ? 0 : Number(v));

  const editBody = () => {
    if (!editItem) return null;
    const d = draft as Record<string, unknown>;
    switch (editItem.type) {
      case 'int':
        return (
          <TextField type="number" label={editItem.labelZh} autoFocus value={String(draft ?? '')}
            onChange={(e) => setDraft(num(e.target.value))} fullWidth />
        );
      case 'minutesMap':
        return (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {RESPONSE_KEYS.map((k) => (
              <TextField key={k} type="number" label={`${editItem.labelZh}（${RESPONSE_ZH[k]}，分鐘）`}
                value={String((d[k] as number) ?? '')} onChange={(e) => setObj(k, num(e.target.value))} fullWidth />
            ))}
          </Stack>
        );
      case 'reminder': {
        const rl = (d.responseLeadMinutes || {}) as Record<string, number>;
        return (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {RESPONSE_KEYS.map((k) => (
              <TextField key={k} type="number" label={`回應提醒提前（${RESPONSE_ZH[k]}，分鐘）`}
                value={String(rl[k] ?? '')} onChange={(e) => setObj(`responseLeadMinutes.${k}`, num(e.target.value))} fullWidth />
            ))}
            <TextField type="number" label="關閉提醒提前（天）" value={String((d.closureLeadDays as number) ?? '')}
              onChange={(e) => setObj('closureLeadDays', num(e.target.value))} fullWidth />
          </Stack>
        );
      }
      case 'eventMapping':
        return (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {CATEGORY_OPTIONS.map((c) => (
              <TextField key={c.code} select size="small" label={`${c.labelZh} → 事件類型`} fullWidth
                value={String((d[c.code] as { base?: string } | undefined)?.base || 'NORMAL')}
                onChange={(e) => setObj(`${c.code}.base`, e.target.value)}>
                {EVENT_OPTIONS.map((ev) => (<MenuItem key={ev.code} value={ev.code}>{ev.labelZh}（{ev.code}）</MenuItem>))}
              </TextField>
            ))}
          </Stack>
        );
      case 'weeklySchedule': {
        const day = String((d.dayOfWeek as string) || 'MON');
        const time = String((d.time as string) || '09:00');
        return (
          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <TextField select label="星期" value={day} onChange={(e) => setObj('dayOfWeek', e.target.value)} sx={{ minWidth: 160 }}>
              {WEEKDAY_OPTIONS.map((w) => (<MenuItem key={w.code} value={w.code}>{w.zh}</MenuItem>))}
            </TextField>
            <TextField label="時間（HH:mm）" value={time} onChange={(e) => setObj('time', e.target.value)} sx={{ minWidth: 160 }} />
          </Stack>
        );
      }
      case 'formStyle':
        return (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <input type="color" style={{ width: 56, height: 40, border: '1px solid #ddd', borderRadius: 6, padding: 2 }}
                value={String((d.primaryColor as string) || '#1a5aa6')} onChange={(e) => setObj('primaryColor', e.target.value)} />
              <TextField label="主色（#RRGGBB）" value={String((d.primaryColor as string) || '')}
                onChange={(e) => setObj('primaryColor', e.target.value)} fullWidth />
            </Stack>
            <TextField label="表單標語（中文）" value={String((d.sloganZh as string) || '')} onChange={(e) => setObj('sloganZh', e.target.value)} fullWidth />
            <TextField label="表單標語（英文）" value={String((d.sloganEn as string) || '')} onChange={(e) => setObj('sloganEn', e.target.value)} fullWidth />
          </Stack>
        );
      default:
        return <DialogContentText>唯讀參數無法編輯。</DialogContentText>;
    }
  };

  const save = () => {
    if (!editItem) return;
    setSaving(true);
    setError('');
    api
      .configUpdate(editItem.key, draft, token)
      .then((r) => {
        setToast(`已更新 ${r.labelZh}（${r.key}）`);
        setEditItem(null);
        return api.configList(token);
      })
      .then((d) => setGroups(d.groups))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '儲存失敗'))
      .finally(() => setSaving(false));
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)' }}>
        <IconButton title="返回個案列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1 }}>系統參數配置</Typography>
        <Box sx={{ flex: 1 }} />
        {user && <Typography variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>{user.fullName}</Typography>}
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="md" mx="auto">
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip icon={<TuneIcon />} label={canEdit ? '可編輯模式（修改即時生效＋完整審計）' : '唯讀檢視（config:view）'} size="small" color={canEdit ? 'primary' : 'default'} />
          <Button size="small" variant="outlined" startIcon={<HistoryIcon />} onClick={openAudit}>更新紀錄</Button>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>重新整理</Button>
          <Box sx={{ flex: 1 }} />
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          骨架採「直接修改即時生效＋完整審計」；規格書 FR-009-02 之「建議→審批」兩段流程暫以
          <strong> 系統管理員直接更新 </strong>替代（sys_config_audit 已預留 PROPOSE/APPROVE/REJECT）。更新後
          ADMIN 與客服主管會收到站內通知。
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={2}>
            {groups.map((g) => (
              <Card key={g.key} elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2' }}>
                <Box sx={{ px: 2.5, py: 1.4, borderBottom: '1px solid #eef1f6', bgcolor: '#fbfcfe', borderRadius: '12px 12px 0 0' }}>
                  <Typography fontWeight={600} sx={{ color: '#1a5aa6' }}>{g.labelZh}</Typography>
                </Box>
                <CardContent sx={{ p: 0 }}>
                  {g.items.map((it, idx) => (
                    <Box key={it.key}>
                      {idx > 0 && <Divider />}
                      <Box sx={{ px: 2.5, py: 1.6, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ minWidth: 170, flex: 1 }}>
                          <Typography variant="body2" fontWeight={600}>{it.labelZh}</Typography>
                          <Typography variant="caption" color="text.secondary">{it.key}</Typography>
                          {it.updatedAt && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              更新：{it.updatedBy || '—'}　{it.updatedAt}
                            </Typography>
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ flex: 1.4, color: it.editable ? '#1a5aa6' : 'text.secondary', fontFamily: 'Consolas, monospace', fontSize: 13, wordBreak: 'break-all' }}>
                          {describe(it.value)}
                        </Typography>
                        {canEdit && it.editable ? (
                          <Button size="small" variant="outlined" startIcon={<EditIcon />}
                            onClick={() => { setEditItem(it); setDraft(it.value == null ? null : JSON.parse(JSON.stringify(it.value))); }}>
                            編輯
                          </Button>
                        ) : (
                          <Chip label={it.editable ? '僅 ADMIN 可編輯' : '唯讀'} size="small" variant="outlined" />
                        )}
                      </Box>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Dialog open={!!editItem} onClose={() => setEditItem(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editItem?.labelZh} <Typography component="span" variant="caption" color="text.secondary">{editItem?.key}</Typography></DialogTitle>
        <DialogContent dividers>
          <DialogContentText variant="body2" sx={{ mb: 1 }}>修改將即時生效；完整前後值會記錄於審計（sys_config_audit）。</DialogContentText>
          {editBody()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditItem(null)}>取消</Button>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={saving} onClick={save}>{saving ? '儲存中…' : '儲存'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={auditOpen} onClose={() => setAuditOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>配置變更審計（最近 50 筆）</DialogTitle>
        <DialogContent dividers>
          {auditLoading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={28} /></Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                    <TableCell sx={{ fontWeight: 600 }}>時間</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>參數</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>操作人</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>動作</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>前值 → 新值</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {audit.map((r) => (
                    <TableRow key={r.auditId} hover>
                      <TableCell><Typography variant="caption">{r.createdAt}</Typography></TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{r.configKey}</TableCell>
                      <TableCell>{r.actorName}</TableCell>
                      <TableCell><Chip size="small" label={r.action} variant="outlined" /></TableCell>
                      <TableCell sx={{ maxWidth: 260, fontFamily: 'Consolas, monospace', fontSize: 12 }}>
                        {describe(r.oldValue)} <Box component="span" sx={{ color: '#1a5aa6' }}>→</Box> {describe(r.newValue)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!audit.length && (
                    <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', color: '#999', py: 3 }}>暫無變更紀錄</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAuditOpen(false)}>關閉</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}
