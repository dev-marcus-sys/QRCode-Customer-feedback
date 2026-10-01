import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, IconButton, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Toolbar, Tooltip, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { api, ApiRequestError, authStore, EmailStatsData, EmailListData } from '../../api/client';
import AdminNav from '../../admin/AdminNav';
import { TopBarUser } from '../../components/TopBarUser';

const STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: 'PENDING', label: '待發送' },
  { value: 'SENT', label: '已送達' },
  { value: 'FAILED', label: '失敗' },
];
const TEMPLATE_OPTIONS = [
  { value: '', label: '全部範本' },
  { value: 'satisfaction_survey', label: '滿意度調查' },
  { value: 'satisfaction_survey_reminder', label: '滿意度提醒' },
];

function Kpi({ title, value, unit, tone }: { title: string; value: string; unit?: string; tone?: string }) {
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', p: 2, flex: 1, minWidth: 150 }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 30, fontWeight: 800, color: tone || '#1a5aa6', lineHeight: 1.1 }}>{value}</Typography>
        {unit && <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>}
      </Box>
    </Card>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; color: 'warning' | 'success' | 'error' }> = {
    PENDING: { label: '待發送', color: 'warning' },
    SENT: { label: '已送達', color: 'success' },
    FAILED: { label: '失敗', color: 'error' },
  };
  const s = map[status] || { label: status, color: 'warning' as const };
  return <Chip size="small" label={s.label} color={s.color} variant="outlined" />;
}

export function EmailDispatchPage() {
  const navigate = useNavigate();
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const [stats, setStats] = useState<EmailStatsData | null>(null);
  const [list, setList] = useState<EmailListData | null>(null);
  const [status, setStatus] = useState('');
  const [template, setTemplate] = useState('satisfaction_survey');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (template) params.set('template', template);
    Promise.all([
      api.emailStats(token),
      api.emailList(params.toString(), token),
    ])
      .then(([s, l]) => { setStats(s); setList(l); })
      .catch((e) => {
        if (e instanceof ApiRequestError) {
          setError(e.message);
          if (e.code === 2001) { authStore.clear(); navigate('/admin/login', { replace: true }); }
        } else setError('載入失敗');
      })
      .finally(() => setLoading(false));
  }, [token, status, template, navigate]);

  useEffect(() => { load(); }, [load]);

  if (!user?.permissions?.includes('dashboard:view')) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar><Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button></Toolbar>
        <Alert severity="warning">當前帳號沒有 dashboard:view 權限，無法查看郵件發送管理。</Alert>
      </Box>
    );
  }

  const onResend = async (outboxId: number) => {
    setBusy(true); setMessage('');
    try {
      const r = await api.emailResend(outboxId, token);
      setMessage(r.ok ? `已重發 outbox #${outboxId}` : `重發失敗：${r.reason || '未知'}`);
      load();
    } catch (e) {
      setMessage(`重發失敗：${e instanceof ApiRequestError ? e.message : '未知錯誤'}`);
    } finally { setBusy(false); }
  };

  const onResendFailed = async () => {
    if (!window.confirm('將重發所有「失敗」的滿意度調查信件，確定？')) return;
    setBusy(true); setMessage('');
    try {
      const r = await api.emailResendFailed(token);
      setMessage(`已重發失敗信件：重置 ${r.reset} 封，成功 ${r.sent}，失敗 ${r.failed}`);
      load();
    } catch (e) {
      setMessage(`重發失敗：${e instanceof ApiRequestError ? e.message : '未知錯誤'}`);
    } finally { setBusy(false); }
  };

  const s = stats?.satisfaction;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)' }}>
        <IconButton title="返回" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <AdminNav current="emails" />
        <Box sx={{ flex: 1 }} />
        <TopBarUser />
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="xl" mx="auto">
        <Typography variant="h6" sx={{ color: '#1a5aa6', mb: 2 }}>郵件發送管理</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          顯示透過 SMTP relay 實際寄出的郵件狀態（含滿意度調查問券）。PENDING＝待寄、SENT＝已送達、FAILED＝寄送失敗。
        </Typography>

        {message && <Alert severity={message.startsWith('已重發') || message.startsWith('已重發失敗') ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {s && (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <Kpi title="滿意度調查已發出" value={String(stats?.satisfactionTotal ?? 0)} unit="封" />
            <Kpi title="待發送" value={String(s.PENDING)} unit="封" tone="#ed6c02" />
            <Kpi title="已送達" value={String(s.SENT)} unit="封" tone="#2e7d32" />
            <Kpi title="失敗" value={String(s.FAILED)} unit="封" tone="#c62828" />
          </Stack>
        )}

        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <TextField select size="small" label="狀態" sx={{ minWidth: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="範本" sx={{ minWidth: 160 }} value={template} onChange={(e) => setTemplate(e.target.value)}>
            {TEMPLATE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <Button startIcon={<RefreshIcon />} onClick={load} disabled={busy}>重新整理</Button>
          <Button variant="contained" startIcon={<SendIcon />} color="warning" onClick={onResendFailed} disabled={busy}>
            重發全部失敗
          </Button>
        </Stack>

        <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                  <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>個案</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>範本</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>收件人</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>主旨</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>建立時間</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>送達時間</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">動作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list?.items.map((r) => (
                  <TableRow key={r.outboxId} hover>
                    <TableCell>{r.outboxId}</TableCell>
                    <TableCell>{r.caseId ?? '—'}</TableCell>
                    <TableCell>{r.template}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>{r.subject}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <StatusChip status={r.status} />
                        {r.status === 'FAILED' && r.error && (
                          <Tooltip title={r.error}><ErrorOutlineIcon fontSize="small" color="error" /></Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{r.createdAt}</TableCell>
                    <TableCell>{r.sentAt ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" startIcon={<SendIcon />} disabled={busy} onClick={() => onResend(r.outboxId)}>
                        重發
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && list && list.items.length === 0 && (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>沒有符合條件的郵件</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {loading && <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box>}
        </Paper>
      </Box>
    </Box>
  );
}
