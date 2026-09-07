/**
 * F-008 數據分析儀表板（/admin/dashboard；dashboard:view）
 * 對應 docs/F008-F009_細部設計.md §8.1。圖表以 MUI 純元件組合（不引入圖表庫）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, LinearProgress, MenuItem, Paper, Snackbar, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import {
  AnomalyData, AnomalyRow, AnomalyType, ApiRequestError, authStore, DashboardSummaryData,
  DistributionData, HandlerRow, KpiCard, RangePreset, TrendPoint, WeeklyReportItem, api,
  downloadDashboardCsv,
} from '../../api/client';
import { STATUS_COLORS } from '../../admin/options';
import { useEstates } from '../../admin/useEstates';
import { NotificationCenter } from '../../components/NotificationCenter';

const RANGES: { code: RangePreset; label: string }[] = [
  { code: 'today', label: '本日' },
  { code: 'thisWeek', label: '本週' },
  { code: 'thisMonth', label: '本月' },
  { code: 'thisQuarter', label: '本季' },
  { code: 'thisYear', label: '本年' },
  { code: 'custom', label: '自訂' },
];

const ANOMALY_META: Record<AnomalyType, { label: string; color: string }> = {
  OVERDUE: { label: '逾期', color: '#ed6c02' },
  LOW_SCORE: { label: '低分問卷', color: '#c62828' },
  SECOND: { label: '二次投訴', color: '#6a1b9a' },
};

function fmt(v: number | null, dec = 0): string {
  if (v == null) return '—';
  if (dec === 0) return String(Math.round(v));
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(dec).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function deltaTone(k: KpiCard, arrow: string | null): string {
  if (!arrow || arrow === '—') return '#1a5aa6';
  const up = arrow === '▲';
  if (k.good === 'down') return up ? '#c62828' : '#2e7d32';
  if (k.good === 'up') return up ? '#2e7d32' : '#c62828';
  return '#1a5aa6';
}

function KpiBox({ k }: { k: KpiCard }) {
  const tone = k.met === false ? '#c62828' : k.met === true ? '#2e7d32' : '#1a5aa6';
  const arrow = k.delta == null ? null : k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '—';
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: `1px solid ${k.met === false ? '#f5c6c6' : '#e5eaf2'}`, p: 1.8 }}>
      <Typography variant="caption" color="text.secondary">{k.labelZh}</Typography>
      <Box sx={{ mt: 0.4, display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 26, fontWeight: 800, color: tone, lineHeight: 1.15 }}>{fmt(k.value, k.key === 'KPI_09' ? 2 : 1)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>{k.unit}</Typography>
      </Box>
      <Box sx={{ mt: 0.6, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {k.delta != null && (
          <Chip
            size="small"
            label={`${arrow}${fmt(Math.abs(k.delta), 1)} 較上期`}
            sx={{ height: 20, fontSize: 11, color: deltaTone(k, arrow), bgcolor: '#f5f7fa' }}
          />
        )}
        {k.target != null && <Typography variant="caption" color="text.secondary">目標 {k.target}{k.unit}</Typography>}
      </Box>
    </Card>
  );
}

function BarRow({ label, value, rate, color = '#1a5aa6' }: { label: string; value: number; rate: number; color?: string }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" fontWeight={600}>{value} <Typography component="span" variant="caption" color="text.secondary">({fmt(rate, 1)}%)</Typography></Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(rate, 100)}
        sx={{ height: 7, borderRadius: 4, mt: 0.4, bgcolor: '#e6ebf3', '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 4 } }}
      />
    </Box>
  );
}

function TrendCard({ items }: { items: TrendPoint[] }) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.created, i.closed)));
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', flex: 1 }}>
      <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600}>月度趨勢（最近 12 個月，香港月）</Typography>
      </Box>
      <CardContent>
        <Stack direction="row" spacing={0.5} alignItems="flex-end" sx={{ height: 150 }}>
          {items.map((m) => {
            const h = Math.round((m.created / max) * 130);
            const h2 = Math.round((m.closed / max) * 130);
            return (
              <Box key={m.ym} sx={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '2px', height: 150 }}>
                <Box title={`${m.ym} 建案 ${m.created}`}
                  sx={{ width: '38%', minWidth: 6, bgcolor: '#1a5aa6', borderRadius: '3px 3px 0 0', height: Math.max(h, 2) }} />
                <Box title={`${m.ym} 關閉 ${m.closed}`}
                  sx={{ width: '38%', minWidth: 6, bgcolor: '#67a5e0', borderRadius: '3px 3px 0 0', height: Math.max(h2, 2) }} />
              </Box>
            );
          })}
        </Stack>
        <Box sx={{ mt: 1, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: '#1a5aa6', borderRadius: '2px' }} /><Typography variant="caption" color="text.secondary">建案</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: '#67a5e0', borderRadius: '2px' }} /><Typography variant="caption" color="text.secondary">關閉</Typography>
          </Box>
        </Box>
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between' }}>
          {items.map((m) => (<Typography key={m.ym} variant="caption" color="text.secondary">{m.ym.slice(2)}</Typography>))}
        </Box>
      </CardContent>
    </Card>
  );
}

function statusLabelZh(code: string): string {
  const hit = [
    { code: 'PENDING', zh: '待分派' }, { code: 'ASSIGNED', zh: '已分派' }, { code: 'IN_PROGRESS', zh: '處理中' },
    { code: 'WAITING', zh: '待客戶回覆' }, { code: 'RESOLVED', zh: '已完結（待審核）' }, { code: 'CLOSED', zh: '已關閉' },
    { code: 'REOPENED', zh: '已重開' },
  ].find((s) => s.code === code);
  return hit ? hit.zh : code;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const locked = !!user && user.estateCode !== 'ALL';
  const estates = useEstates();

  const [range, setRange] = useState<RangePreset>('thisMonth');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [estate, setEstate] = useState('');
  const effectiveEstate = locked ? user?.estateCode || '' : estate;
  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [dist, setDist] = useState<DistributionData | null>(null);
  const [handlers, setHandlers] = useState<HandlerRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyData | null>(null);
  const [reports, setReports] = useState<WeeklyReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [running, setRunning] = useState(false);
  const [reportOpen, setReportOpen] = useState<WeeklyReportItem | null>(null);

  const query = { range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined, estate: effectiveEstate };

  const load = useCallback(() => {
    if (range === 'custom' && (!from || !to)) {
      setLoading(false);
      setSummary(null);
      setDist(null);
      setTrend([]);
      setHandlers([]);
      return;
    }
    setLoading(true);
    setError('');
    Promise.all([
      api.dashboardSummary(query, token),
      api.dashboardTrend(query, token),
      api.dashboardDistribution(query, token),
      api.dashboardHandlers(query, token),
      api.dashboardAnomalies(effectiveEstate, token),
      api.weeklyReportList(token),
    ])
      .then(([s, t, d, h, a, w]) => {
        setSummary(s);
        setTrend(t.items);
        setDist(d);
        setHandlers(h.items);
        setAnomalies(a);
        setReports(w.items);
      })
      .catch((e) => {
        setError(e instanceof ApiRequestError ? e.message : '載入儀表板失敗');
        if (e instanceof ApiRequestError && (e.code === 2001 || e.code === 2005)) {
          authStore.clear();
          navigate('/admin/login', { replace: true });
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, range, from, to, estate, locked]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user?.permissions?.includes('dashboard:view')) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button>
        </Toolbar>
        <Alert severity="warning">當前帳號沒有 dashboard:view 權限，無法查看儀表板。</Alert>
      </Box>
    );
  }

  const logout = () => {
    authStore.clear();
    navigate('/admin/login', { replace: true });
  };

  const runWeekly = () => {
    setRunning(true);
    setError('');
    api
      .weeklyReportRun(token)
      .then((r) => {
        setToast(r.duplicate ? `上週（${r.report?.periodStart || ''}）週報已產生過，略過` : `上週週報已產生（收件人 ${r.recipients}，已排佇列 ${r.emailQueued}）`);
        return api.weeklyReportList(token);
      })
      .then((w) => setReports(w.items))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '產生週報失敗'))
      .finally(() => setRunning(false));
  };

  const exportCsv = () => {
    downloadDashboardCsv(query, token).catch((e) => setError(e instanceof ApiRequestError ? e.message : '匯出失敗'));
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)' }}>
        <IconButton title="返回個案列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1 }}>數據分析儀表板</Typography>
        <Box sx={{ flex: 1 }} />
        {user && <Typography variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>{user.fullName}</Typography>}
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="xl" mx="auto">
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          {RANGES.map((r) => (
            <Button
              key={r.code} size="small" variant={range === r.code ? 'contained' : 'outlined'}
              sx={{ minWidth: 56 }} onClick={() => setRange(r.code)}
            >
              {r.label}
            </Button>
          ))}
          {range === 'custom' && (
            <>
              <TextField type="date" size="small" label="自" value={from} onChange={(e) => setFrom(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ maxWidth: 160 }} />
              <TextField type="date" size="small" label="至" value={to} onChange={(e) => setTo(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ maxWidth: 160 }} />
            </>
          )}
          <TextField select size="small" label="屋苑" sx={{ minWidth: 160 }} disabled={locked}
            value={effectiveEstate}
            onChange={(e) => setEstate(e.target.value)}>
            <MenuItem value="">全部屋苑</MenuItem>
            {estates.activeOptions.map((x) => (<MenuItem key={x.estateCode} value={x.estateCode}>{x.estateNameZh}</MenuItem>))}
          </TextField>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>重新整理</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>匯出 CSV</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading && <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>}

        {!loading && summary && (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1.5, mb: 2 }}>
              {summary.kpi.map((k) => (<KpiBox key={k.key} k={k} />))}
            </Box>

            <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
              <Chip icon={<DashboardIcon />} label={`期間：${summary.range.labelZh} ${summary.range.from} ~ ${summary.range.to}`} variant="outlined" size="small" />
              {summary.statusCounts.map((s) => (
                <Chip key={s.status} size="small" label={`${statusLabelZh(s.status)} ${s.count} 宗`}
                  sx={{ bgcolor: '#fff', color: STATUS_COLORS[s.status] || '#333', border: `1px solid ${STATUS_COLORS[s.status] || '#ddd'}` }} />
              ))}
              {summary.anomalySummary && (
                <Chip size="small" sx={{ bgcolor: '#fff3e0', color: '#e65100', fontWeight: 600 }}
                  label={`異常：逾期 ${summary.anomalySummary.OVERDUE} ／ 低分 ${summary.anomalySummary.LOW_SCORE} ／ 二次 ${summary.anomalySummary.SECOND}`} />
              )}
            </Stack>

            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TrendCard items={trend} />
            </Stack>

            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', flex: 1 }}>
                <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6' }}>
                  <Typography fontWeight={600}>事項類別分布（共 {dist?.total || 0} 宗）</Typography>
                </Box>
                <CardContent>
                  {dist?.category.map((r) => (<BarRow key={r.code} label={r.labelZh} value={r.count} rate={r.rate} />))}
                  {!dist?.category.length && <Typography variant="body2" color="text.secondary">本期暫無數據</Typography>}
                </CardContent>
              </Card>
              <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', flex: 1 }}>
                <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6' }}>
                  <Typography fontWeight={600}>意見性質分布</Typography>
                </Box>
                <CardContent>
                  {dist?.intent.map((r) => (<BarRow key={r.code} label={r.labelZh} value={r.count} rate={r.rate} color="#00838f" />))}
                  {!dist?.intent.length && <Typography variant="body2" color="text.secondary">本期暫無數據</Typography>}
                </CardContent>
              </Card>
              <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', flex: 1 }}>
                <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6' }}>
                  <Typography fontWeight={600}>屋苑分布</Typography>
                </Box>
                <CardContent>
                  {dist?.estate.map((r) => (<BarRow key={r.code} label={`${r.labelZh}（${r.code}）`} value={r.count} rate={r.rate} color="#2e7d32" />))}
                  {!dist?.estate.length && <Typography variant="body2" color="text.secondary">本期暫無數據</Typography>}
                </CardContent>
              </Card>
            </Stack>

            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', overflow: 'hidden', flex: 1.4 }}>
                <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography fontWeight={600}>異常清單（點擊前往個案）</Typography>
                  {anomalies && (
                    <Stack direction="row" spacing={0.6}>
                      {(Object.keys(ANOMALY_META) as (keyof typeof ANOMALY_META)[]).map((t) => (
                        <Chip key={t} size="small" label={`${ANOMALY_META[t].label} ${anomalies.counts[t]}`}
                          sx={{ color: ANOMALY_META[t].color, bgcolor: '#fff', border: `1px solid ${ANOMALY_META[t].color}` }} />
                      ))}
                    </Stack>
                  )}
                </Box>
                <TableContainer sx={{ maxHeight: 260 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                        <TableCell sx={{ fontWeight: 600 }}>類型</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>個案</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>屋苑</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>時間</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {anomalies?.items.map((a: AnomalyRow, i: number) => (
                        <TableRow key={`${a.caseId}-${i}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/cases/${encodeURIComponent(a.caseId)}`)}>
                          <TableCell>
                            <Chip size="small" label={a.aspect || ANOMALY_META[a.type].label}
                              sx={{ color: ANOMALY_META[a.type].color, bgcolor: '#fff', border: `1px solid ${ANOMALY_META[a.type].color}` }} />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, color: '#1a5aa6' }}>{a.caseId}</TableCell>
                          <TableCell>{a.estateNameZh}</TableCell>
                          <TableCell>{statusLabelZh(a.status)}</TableCell>
                          <TableCell><Typography variant="caption" color="text.secondary">{a.dueAt || a.createdAt || ''}</Typography></TableCell>
                        </TableRow>
                      ))}
                      {!anomalies?.items.length && (
                        <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', color: '#999', py: 3 }}>目前沒有異常個案</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', flex: 1 }}>
                <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6' }}>
                  <Typography fontWeight={600}>處理人員績效</Typography>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                        <TableCell sx={{ fontWeight: 600 }}>人員</TableCell>
                        <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>處理宗數</TableCell>
                        <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>結案</TableCell>
                        <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>平均時效(天)</TableCell>
                        <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>平均滿意度</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {handlers.map((h) => (
                        <TableRow key={h.userId} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{h.fullName}<Typography variant="caption" display="block" color="text.secondary">{h.estateNameZh}</Typography></TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{h.caseCount}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{h.closedCount}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{h.avgHandlingDays == null ? '—' : h.avgHandlingDays}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{h.avgSatisfaction == null ? '—' : h.avgSatisfaction}</TableCell>
                        </TableRow>
                      ))}
                      {!handlers.length && (
                        <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', color: '#999', py: 3 }}>本期暫無分派記錄</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            </Stack>

            <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2' }}>
              <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography fontWeight={600}>自動週報（每週一 09:00 產生上週摘要）</Typography>
                <Button size="small" variant="contained" startIcon={<EventRepeatIcon />} disabled={running} onClick={runWeekly}>
                  {running ? '產生中…' : '＋ 產生上週週報'}
                </Button>
                <Box sx={{ flex: 1 }} />
                {reports.slice(0, 3).map((r) => (
                  <Button key={r.reportId} size="small" onClick={() => setReportOpen(r)}>
                    {r.periodStart}（{r.anomalyCount} 異常）
                  </Button>
                ))}
              </Box>
              <CardContent>
                <Typography variant="body2" color="text.secondary">
                  週報涵蓋上週一至週日之全屋苑 KPI 摘要與異常清單，產生後自動排入 email_outbox 佇列
                  （ADMIN／客服主管／各屋苑主管）。排程依 WEEKLY_REPORT_CHECK_MS 環境變數啟用，預設停用。
                </Typography>
              </CardContent>
            </Card>
          </>
        )}
      </Box>

      <Snackbar open={!!toast} autoHideDuration={3500} message={toast} onClose={() => setToast('')} />

      <Dialog open={!!reportOpen} onClose={() => setReportOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>週報 {reportOpen?.periodStart} ~ {reportOpen?.periodEnd}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            產生時間：{reportOpen?.generatedAt}　異常宗數：{reportOpen?.anomalyCount}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                <TableCell sx={{ fontWeight: 600 }}>指標</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>數值</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>目標</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportOpen?.summary?.kpi.map((k) => (
                <TableRow key={k.key}>
                  <TableCell>{k.labelZh}</TableCell>
                  <TableCell sx={{ textAlign: 'right', fontWeight: 600 }}>{fmt(k.value, k.key === 'KPI_09' ? 2 : 1)} {k.unit}</TableCell>
                  <TableCell sx={{ textAlign: 'right', color: 'text.secondary' }}>{k.target ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReportOpen(null)}>關閉</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
