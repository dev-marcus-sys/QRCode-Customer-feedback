import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Fade, IconButton,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TableSortLabel, TextField, Toolbar, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import LogoutIcon from '@mui/icons-material/Logout';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import InsightsIcon from '@mui/icons-material/Insights';
import TuneIcon from '@mui/icons-material/Tune';
import { api, ApiRequestError, authStore, CaseListData, downloadExport } from '../../api/client';
import { NotificationCenter } from '../../components/NotificationCenter';
import AdminNav from '../../admin/AdminNav';
import { BatchActions } from '../../components/BatchActions';
import {
  CATEGORY_OPTIONS, ESTATE_OPTIONS, EVENT_OPTIONS, PRIORITY_OPTIONS,
  labelOf, STATUS_OPTIONS,
} from '../../admin/options';
import { StatusChip } from '../../components/StatusChip';

type SortKey = 'caseId' | 'createdAt' | 'responseSlaDue' | 'closureSlaDue';

interface Filters {
  estate?: string;
  category?: string;
  status?: string;
  eventType?: string;
  priority?: string;
  second?: string;
  dateFrom?: string;
  dateTo?: string;
}

const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: 'caseId', label: '案號' },
  { key: 'createdAt', label: '提交時間' },
  { key: 'responseSlaDue', label: '首應期限' },
  { key: 'closureSlaDue', label: '關閉期限' },
];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function remainText(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return { text: `已逾期 ${Math.max(0, Math.ceil(-diff / 60000))} 分鐘`, overdue: true };
  const m = Math.floor(diff / 60000);
  if (m < 60) return { text: `剩 ${m} 分鐘`, overdue: false };
  const h = Math.floor(m / 60);
  if (h < 24) return { text: `剩 ${h} 小時`, overdue: false };
  return { text: `剩 ${Math.floor(h / 24)} 天 ${h % 24} 小時`, overdue: false };
}

export function CaseListPage() {
  const navigate = useNavigate();
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const estateLocked = !!user && user.estateCode !== 'ALL';
  const canExport = !!user?.permissions?.includes('case:export');

  const [filters, setFilters] = useState<Filters>({});
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<CaseListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [sortBy, setSortBy] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState('');

  const pageIds = (data?.items || []).map((r) => r.caseId);
  const toggleSelect = (caseId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  const toggleAllPage = () => {
    const allOnPage = pageIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allOnPage ? next.delete(id) : next.add(id)));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const batchDone = (msg: string) => {
    setToast(msg);
    clearSelection();
    setTick((t) => t + 1);
    window.setTimeout(() => setToast(''), 6000);
  };

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setPage(0);
  };

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    if (keyword.trim()) p.set('keyword', keyword.trim());
    p.set('sortBy', sortBy);
    p.set('sortDir', sortDir);
    p.set('page', String(page + 1));
    p.set('pageSize', String(rowsPerPage));
    return p.toString();
  }, [filters, keyword, sortBy, sortDir, page, rowsPerPage]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .listCases(query, token)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive) {
          setError(e instanceof ApiRequestError ? e.message : '載入失敗，請稍後再試');
          if (e instanceof ApiRequestError && (e.code === 2001 || e.code === 2005)) {
            authStore.clear();
            navigate('/admin/login', { replace: true });
          }
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, token, navigate, tick]);

  const handleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('desc');
    }
    setPage(0);
  };

  const resetAll = () => {
    setFilters({});
    setKeyword('');
    setPage(0);
    setSortBy('createdAt');
    setSortDir('desc');
  };

  const doExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
      if (keyword.trim()) p.set('keyword', keyword.trim());
      await downloadExport(p.toString(), format, token);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '匯出失敗');
    } finally {
      setExporting(false);
    }
  };

  const logout = () => {
    authStore.clear();
    navigate('/admin/login', { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar
        sx={{
          position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff',
          borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)',
        }}
      >
        <Typography variant="h6" sx={{ color: '#1a5aa6' }}>個案管理</Typography>
        {user?.permissions?.includes('qr:view') && (
          <Button component={Link} to="/admin/qr" size="small" startIcon={<QrCode2Icon />}
            sx={{ ml: 2, whiteSpace: 'nowrap' }}>
            QR Code 管理
          </Button>
        )}
        {user?.permissions?.includes('dashboard:view') && (
          <Button component={Link} to="/admin/surveys" size="small" startIcon={<FactCheckIcon />}
            sx={{ ml: 1, whiteSpace: 'nowrap' }}>
            問卷統計
          </Button>
        )}
        {user?.permissions?.includes('dashboard:view') && (
          <Button component={Link} to="/admin/dashboard" size="small" startIcon={<InsightsIcon />}
            sx={{ ml: 1, whiteSpace: 'nowrap' }}>
            數據分析儀表板
          </Button>
        )}
        {user?.permissions?.includes('config:view') && (
          <Button component={Link} to="/admin/config" size="small" startIcon={<TuneIcon />}
            sx={{ ml: 1, whiteSpace: 'nowrap' }}>
            系統參數
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {user && (
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>
            {user.fullName} · {estateLocked ? ESTATE_OPTIONS.find((e) => e.code === user.estateCode)?.nameZh || user.estateCode : '全部屋苑'}
          </Typography>
        )}
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.5 }} maxWidth="lg" mx="auto">
        <AdminNav current="cases" />
      </Box>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        {/* 批次工具列（F-004） */}
        {selected.size > 0 && (
          <Box sx={{ mb: 2 }}>
            <BatchActions caseIds={Array.from(selected)} onCleared={clearSelection} onDone={batchDone} />
          </Box>
        )}
        {toast && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setToast('')}>{toast}</Alert>
        )}
        {/* 篩選區 */}
        <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  select size="small" label="屋苑" sx={{ minWidth: 170 }} disabled={estateLocked}
                  value={filters.estate || ''}
                  onChange={(e) => setFilter('estate', e.target.value)}
                >
                  <MenuItem value="">全部</MenuItem>
                  {ESTATE_OPTIONS.map((o) => (
                    <MenuItem key={o.code} value={o.code}>{o.nameZh}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select size="small" label="意見種類" sx={{ minWidth: 180 }}
                  value={filters.category || ''} onChange={(e) => setFilter('category', e.target.value)}
                >
                  <MenuItem value="">全部</MenuItem>
                  {CATEGORY_OPTIONS.map((o) => (
                    <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select size="small" label="狀態" sx={{ minWidth: 170 }}
                  value={filters.status || ''} onChange={(e) => setFilter('status', e.target.value)}
                >
                  <MenuItem value="">全部</MenuItem>
                  {STATUS_OPTIONS.map((o) => (
                    <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select size="small" label="事件類型" sx={{ minWidth: 140 }}
                  value={filters.eventType || ''} onChange={(e) => setFilter('eventType', e.target.value)}
                >
                  <MenuItem value="">全部</MenuItem>
                  {EVENT_OPTIONS.map((o) => (
                    <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select size="small" label="優先級" sx={{ minWidth: 120 }}
                  value={filters.priority || ''} onChange={(e) => setFilter('priority', e.target.value)}
                >
                  <MenuItem value="">全部</MenuItem>
                  {PRIORITY_OPTIONS.map((o) => (
                    <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select size="small" label="二次投訴" sx={{ minWidth: 120 }}
                  value={filters.second || ''} onChange={(e) => setFilter('second', e.target.value)}
                >
                  <MenuItem value="">全部</MenuItem>
                  <MenuItem value="1">是</MenuItem>
                  <MenuItem value="0">否</MenuItem>
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="center">
                <TextField size="small" label="關鍵字（案號/姓名/內容）" sx={{ minWidth: 260 }}
                  value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <TextField size="small" type="date" label="由" sx={{ width: 150 }}
                  value={filters.dateFrom || ''} onChange={(e) => setFilter('dateFrom', e.target.value)}
                  InputLabelProps={{ shrink: true }} />
                <TextField size="small" type="date" label="至" sx={{ width: 150 }}
                  value={filters.dateTo || ''} onChange={(e) => setFilter('dateTo', e.target.value)}
                  InputLabelProps={{ shrink: true }} />
                <Button variant="contained" size="small" onClick={() => setPage(0)}>套用</Button>
                <Button variant="outlined" size="small" onClick={resetAll}>重設</Button>
                <Box sx={{ flex: 1 }} />
                <Button size="small" startIcon={<FileDownloadIcon />} disabled={exporting || !canExport}
                  onClick={() => doExport('csv')}>
                  CSV
                </Button>
                <Button size="small" startIcon={<DownloadIcon />} disabled={exporting || !canExport}
                  onClick={() => doExport('xlsx')}>
                  Excel
                </Button>
                {exporting && <CircularProgress size={16} />}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!user?.permissions?.includes('case:list') && (
          <Alert severity="warning" sx={{ mb: 2 }}>當前帳號沒有 case:list 權限。</Alert>
        )}

        <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', overflow: 'hidden' }}>
          <TableContainer>
            <Fade in key={`${query}-${data?.total ?? 0}`}>
              <Table size="small" sx={{ minWidth: 1180 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                    <TableCell padding="checkbox" sx={{ pl: 1.5 }}>
                      <Checkbox
                        size="small"
                        indeterminate={pageIds.some((id) => selected.has(id)) && !pageIds.every((id) => selected.has(id))}
                        checked={pageIds.length > 0 && pageIds.every((id) => selected.has(id))}
                        onChange={toggleAllPage}
                        inputProps={{ 'aria-label': '選取整頁' }}
                      />
                    </TableCell>
                    {SORT_COLS.map((c) => (
                      <TableCell key={c.key} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <TableSortLabel
                          active={sortBy === c.key}
                          direction={sortBy === c.key ? sortDir : 'desc'}
                          onClick={() => handleSort(c.key)}
                        >
                          {c.label}
                        </TableSortLabel>
                      </TableCell>
                    ))}
                    <TableCell sx={{ fontWeight: 600 }}>屋苑 / 種類</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>客戶</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>處理人</TableCell>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>SLA 到期 / 剩餘</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!loading && data?.items.map((row) => {
                    const overdueRow = row.slaOverdue;
                    const rem = remainText(row.responseSlaDue || row.closureSlaDue);
                    return (
                      <TableRow
                        key={row.caseId}
                        hover
                        sx={{
                          cursor: 'pointer',
                          bgcolor: overdueRow ? 'rgba(211,47,47,.05)' : undefined,
                          '& td': { borderBottom: '1px solid #eef1f6' },
                        }}
                        onClick={() => navigate(`/admin/cases/${encodeURIComponent(row.caseId)}`)}
                      >
                        <TableCell padding="checkbox" sx={{ pl: 1.5 }} onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            size="small"
                            checked={selected.has(row.caseId)}
                            onChange={() => toggleSelect(row.caseId)}
                            inputProps={{ 'aria-label': `選取 ${row.caseId}` }}
                          />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <Link
                            to={`/admin/cases/${encodeURIComponent(row.caseId)}`}
                            style={{ fontFamily: '"Roboto Mono", monospace', color: '#1a5aa6', textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.caseId}
                          </Link>
                          {row.isSecondComplaint && (
                            <Chip size="small" label="二次" sx={{ ml: 1, bgcolor: '#b71c1c14', color: '#b71c1c', border: '1px solid #b71c1c44', fontSize: 11, height: 20 }} />
                          )}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmt(row.createdAt)}</TableCell>
                        <TableCell sx={{ fontSize: 13 }}>{fmt(row.responseSlaDue)}</TableCell>
                        <TableCell sx={{ fontSize: 13 }}>{fmt(row.closureSlaDue)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                          {row.estateNameZh}
                          <Box component="span" sx={{ color: 'text.secondary', ml: 0.5, fontSize: 12 }}>
                            {labelOf(CATEGORY_OPTIONS, row.categoryCode, 'zh-Hant')}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <StatusChip status={row.caseStatus} lang="zh-Hant" />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                          {row.customerTitle}{row.customerName}
                          <Typography variant="caption" color="text.secondary" display="block">
                            {labelOf(EVENT_OPTIONS, row.eventType, 'zh-Hant')} · {labelOf(PRIORITY_OPTIONS, row.priority, 'zh-Hant')}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                          {row.assignedTo ? row.assignedTo.fullName : <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>}
                        </TableCell>
                        <TableCell sx={{ fontSize: 13 }}>
                          <Typography variant="caption" display="block" color={rem?.overdue ? 'error' : 'text.secondary'}>
                            {rem?.text || '—'}
                          </Typography>
                          {row.slaOverdue && (
                            <Typography variant="caption" color="error" fontWeight={600}>SLA 逾期</Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Fade>
          </TableContainer>
          {loading && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
          )}
          {!loading && !data?.items.length && (
            <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>沒有符合條件的個案</Box>
          )}
          <TablePagination
            component="div"
            count={data?.total ?? 0}
            page={Math.min(page, Math.max(0, Math.ceil((data?.total ?? 0) / rowsPerPage) - 1))}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50]}
            labelRowsPerPage="每頁"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
          />
        </Paper>
      </Box>
    </Box>
  );
}
