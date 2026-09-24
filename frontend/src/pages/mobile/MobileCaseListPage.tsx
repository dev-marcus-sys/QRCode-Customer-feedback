import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Card, CardActionArea, Chip, Fab, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import { api, ApiRequestError, authStore, CaseListData } from '../../api/client';
import {
  CATEGORY_OPTIONS, EVENT_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS, labelOf,
} from '../../admin/options';
import { StatusChip } from '../../components/StatusChip';
import { CreateCaseDialog } from '../../components/CreateCaseDialog';
import { useEstates } from '../../admin/useEstates';

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

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

/** 手機版個案清單 /m/cases：卡片式（替代桌面表格）＋ 關鍵字／狀態篩選＋分頁。 */
export function MobileCaseListPage() {
  const navigate = useNavigate();
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const scopeCodes = user && user.estateCodes && user.estateCodes.length && !user.estateCodes.includes('ALL')
    ? user.estateCodes : null;
  const estates = useEstates();

  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [estate, setEstate] = useState('');
  const [data, setData] = useState<CaseListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const [createOpen, setCreateOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (keyword.trim()) p.set('keyword', keyword.trim());
    if (status) p.set('status', status);
    if (estate) p.set('estate', estate);
    p.set('sortBy', 'createdAt');
    p.set('sortDir', 'desc');
    p.set('page', String(page + 1));
    p.set('pageSize', String(pageSize));
    return p.toString();
  }, [keyword, status, estate, page, refresh]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .listCases(query, token)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive) {
          setError(e instanceof ApiRequestError ? e.message : '載入失敗');
          if (e instanceof ApiRequestError && e.code === 2001) {
            authStore.clear();
            window.location.assign('/m/login');
          }
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, token]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <Box>
      <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2, p: 1.5 }}>
        <Stack spacing={1.2}>
          <TextField
            size="small" fullWidth placeholder="搜尋案號 / 姓名 / 內容"
            value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              select size="small" label="狀態" sx={{ flex: 1 }} value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(0); }}
            >
              <MenuItem value="">全部</MenuItem>
              {STATUS_OPTIONS.map((o) => (<MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>))}
            </TextField>
            <TextField
              select size="small" label="屋苑" sx={{ flex: 1 }}
              disabled={!!scopeCodes && scopeCodes.length <= 1}
              value={scopeCodes ? (estate || scopeCodes[0]) : estate}
              onChange={(e) => { setEstate(e.target.value); setPage(0); }}
            >
              {!scopeCodes && <MenuItem value="">全部</MenuItem>}
              {(scopeCodes
                ? scopeCodes.map((c) => ({ code: c, zh: estates.nameOf(c) }))
                : estates.activeOptions.map((x) => ({ code: x.estateCode, zh: x.estateNameZh }))
              ).map((x) => (<MenuItem key={x.code} value={x.code}>{x.zh}</MenuItem>))}
            </TextField>
          </Stack>
        </Stack>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>載入中…</Typography>}

      {!loading && data && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            共 {data.total} 宗
          </Typography>
          {data.items.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>沒有符合條件的個案</Typography>
          )}
          <Stack spacing={1.5}>
            {data.items.map((row) => {
              const rem = remainText(row.responseSlaDue || row.closureSlaDue);
              return (
                <Card key={row.caseId} elevation={0} sx={{ borderRadius: 2, border: `1px solid ${row.slaOverdue ? '#f3c2c2' : '#e5eaf2'}`, bgcolor: row.slaOverdue ? '#fdf5f5' : '#fff' }}>
                  <CardActionArea onClick={() => navigate(`/m/cases/${encodeURIComponent(row.caseId)}`)} sx={{ p: 1.8 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: 14, fontWeight: 700, color: '#1a5aa6' }}>
                        {row.caseId}
                      </Typography>
                      <StatusChip status={row.caseStatus} lang="zh-Hant" />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.customerTitle}{row.customerName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.estateNameZh} · {labelOf(CATEGORY_OPTIONS, row.categoryCode, 'zh-Hant')} ·{' '}
                      {labelOf(EVENT_OPTIONS, row.eventType, 'zh-Hant')}/{labelOf(PRIORITY_OPTIONS, row.priority, 'zh-Hant')}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.6 }}>
                      <Typography variant="caption" color="text.secondary">{fmt(row.createdAt)}</Typography>
                      {row.isSecondComplaint && (
                        <Chip size="small" label="二次" sx={{ bgcolor: '#b71c1c14', color: '#b71c1c', fontSize: 11, height: 20 }} />
                      )}
                    </Box>
                    {rem && (
                      <Typography variant="caption" sx={{ color: rem.overdue ? '#c62828' : '#ed6c02', fontWeight: 600 }}>
                        {rem.text}
                      </Typography>
                    )}
                  </CardActionArea>
                </Card>
              );
            })}
          </Stack>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
            <Chip
              label="上一頁" clickable disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))} color="primary" variant="outlined"
            />
            <Typography variant="caption" color="text.secondary">第 {page + 1} / {totalPages} 頁</Typography>
            <Chip
              label="下一頁" clickable disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} color="primary" variant="outlined"
            />
          </Box>
        </>
      )}

      {user?.permissions?.includes('case:create') && (
        <Fab color="primary" aria-label="新增個案" sx={{ position: 'fixed', right: 16, bottom: 16 }}
          onClick={() => setCreateOpen(true)}>
          <AddIcon />
        </Fab>
      )}

      <CreateCaseDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setPage(0);
          setRefresh((r) => r + 1);
        }}
      />
    </Box>
  );
}
