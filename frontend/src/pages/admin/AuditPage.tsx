/**
 * F-010 操作審計日誌查閱（/admin/audit；audit:view）。
 * 對應 docs/F010_細部設計.md。append-only 日誌，僅供查閱（依 action/操作人/目標/時間範圍過濾）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, MenuItem, Snackbar, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
import {
  ApiRequestError, AuditRow, authStore, api,
} from '../../api/client';
import { NotificationCenter } from '../../components/NotificationCenter';
import AdminNav from '../../admin/AdminNav';

const ACTION_LABEL: Record<string, string> = {
  LOGIN: '登入', LOGOUT: '登出', CASE_CREATE: '建案', CASE_ASSIGN: '分派',
  CASE_STATUS: '狀態變更', CASE_REOPEN: '重開', CONFIG_CHANGE: '參數變更', EXPORT: '匯出',
  QR_GENERATE: 'QR 產生', QR_DEACTIVATE: 'QR 停用', QR_REACTIVATE: 'QR 啟用',
  USER_MANAGE: '用戶管理', ROLE_MANAGE: '角色管理', WEEKLY_REPORT: '週報', SURVEY: '問卷',
};

export function AuditPage() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const perms = user?.permissions || [];
  const canView = perms.includes('audit:view');

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [action, setAction] = useState('');
  const [username, setUsername] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (username) params.set('username', username);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    api.listAudit(params.toString(), token)
      .then((d) => { setRows(d.items); setTotal(d.total); setActions(d.actions); })
      .catch((e) => {
        setError(e instanceof ApiRequestError ? e.message : '載入失敗');
        if (e instanceof ApiRequestError && (e.code === 2001 || e.code === 2005)) { authStore.clear(); navigate('/admin/login', { replace: true }); }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, action, username, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar><Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button></Toolbar>
        <Alert severity="warning">當前帳號沒有 audit:view 權限，無法查閱審計日誌。</Alert>
      </Box>
    );
  }

  const logout = () => { authStore.clear(); navigate('/admin/login', { replace: true }); };

  const detailText = (r: AuditRow) => {
    if (!r.detail) return '';
    try { return JSON.stringify(r.detail); } catch { return String(r.detail); }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', borderBottom: '1px solid #e5eaf2' }}>
        <IconButton title="返回個案列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1 }}>操作審計</Typography>
        <Box sx={{ flex: 1 }} />
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        <AdminNav current="audit" />

        <Stack direction="row" spacing={1} sx={{ mb: 2, mt: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" select label="操作類型" value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">全部</MenuItem>
            {actions.map((a) => <MenuItem key={a} value={a}>{ACTION_LABEL[a] || a}</MenuItem>)}
          </TextField>
          <TextField size="small" label="操作人" value={username} onChange={(e) => setUsername(e.target.value)} sx={{ minWidth: 150 }} />
          <TextField size="small" type="date" label="起" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="迄" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button size="small" variant="contained" onClick={load}>查詢</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
        ) : (
          <TableContainer sx={{ bgcolor: '#fff', borderRadius: 2, border: '1px solid #e5eaf2' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                  <TableCell sx={{ fontWeight: 600 }}>時間</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>操作人</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>操作</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>目標</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>明細</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.auditId} hover>
                    <TableCell><Typography variant="caption">{r.createdAt}</Typography></TableCell>
                    <TableCell>{r.username}</TableCell>
                    <TableCell><Chip size="small" label={ACTION_LABEL[r.action] || r.action} /></TableCell>
                    <TableCell>{r.targetType ? `${r.targetType}#${r.targetId}` : '—'}</TableCell>
                    <TableCell><Typography variant="caption" sx={{ fontFamily: 'Consolas, monospace' }}>{detailText(r)}</Typography></TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', color: '#999', py: 3 }}>暫無紀錄</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>共 {total} 筆（日誌不可竄改，保留 1 年）</Typography>
      </Box>

      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}
