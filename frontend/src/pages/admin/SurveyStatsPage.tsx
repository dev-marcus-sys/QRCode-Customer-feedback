import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, IconButton, LinearProgress,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { api, ApiRequestError, authStore, SurveyStatsData } from '../../api/client';
import { useEstates } from '../../admin/useEstates';
import { NotificationCenter } from '../../components/NotificationCenter';

const AVG_LABELS: { key: 'overall' | 'response' | 'attitude' | 'resolution'; zh: string }[] = [
  { key: 'overall', zh: '整體滿意度' },
  { key: 'response', zh: '回應速度' },
  { key: 'attitude', zh: '服務態度' },
  { key: 'resolution', zh: '問題解決' },
];

function KpiCard({ title, value, unit, tone }: { title: string; value: string; unit?: string; tone?: string }) {
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', p: 2, flex: 1, minWidth: 150 }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 30, fontWeight: 800, color: tone || '#1a5aa6', lineHeight: 1.1 }}>
          {value}
        </Typography>
        {unit && <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>}
      </Box>
    </Card>
  );
}

export function SurveyStatsPage() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const locked = !!user && user.estateCode !== 'ALL';
  const estates = useEstates();
  const [estate, setEstate] = useState('');
  const [data, setData] = useState<SurveyStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .surveyStats(token, locked ? user.estateCode : estate)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive) {
          setError(e instanceof ApiRequestError ? e.message : '載入統計失敗');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, estate]);

  if (!user?.permissions?.includes('dashboard:view')) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button>
        </Toolbar>
        <Alert severity="warning">當前帳號沒有 dashboard:view 權限，無法查看問卷統計。</Alert>
      </Box>
    );
  }

  const logout = () => {
    authStore.clear();
    navigate('/admin/login', { replace: true });
  };

  const o = data?.overall;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar
        sx={{
          position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff',
          borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)',
        }}
      >
        <IconButton title="返回個案列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1 }}>問卷統計</Typography>
        <Box sx={{ flex: 1 }} />
        {user && <Typography variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>{user.fullName}</Typography>}
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <TextField
            select size="small" label="屋苑" sx={{ minWidth: 180 }} disabled={locked}
            value={locked ? user.estateCode : estate}
            onChange={(e) => setEstate(e.target.value)}
          >
            <MenuItem value="">全部屋苑</MenuItem>
            {estates.activeOptions.map((x) => (
              <MenuItem key={x.estateCode} value={x.estateCode}>{x.estateNameZh}</MenuItem>
            ))}
          </TextField>
          <Chip icon={<FactCheckIcon />} label="匿名問卷，僅顯示統計" variant="outlined" size="small" />
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {o && (
          <>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <KpiCard title="已發送問卷" value={String(o.sent)} unit="封" />
              <KpiCard title="已回覆" value={String(o.submitted)} unit="份" />
              <KpiCard title="回覆率" value={o.replyRate.toFixed(1)} unit="%" tone="#2e7d32" />
              <KpiCard title="待客戶回覆" value={String(o.pending)} unit="份" tone="#ed6c02" />
              <KpiCard title="低分（≤2）" value={String(o.lowScoreCount)} unit="份" tone="#c62828" />
            </Stack>

            <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
              <Box sx={{ px: 2.5, py: 1.6, borderBottom: '1px solid #eef1f6' }}>
                <Typography fontWeight={600}>各題平均分（1–5）</Typography>
              </Box>
              <CardContent>
                <Stack spacing={1.5}>
                  {AVG_LABELS.map((q) => {
                    const val = o.avg[q.key];
                    return (
                      <Box key={q.key}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2">{q.zh}</Typography>
                          <Typography variant="body2" fontWeight={600} color={val == null || val < 3 ? '#c62828' : '#1a5aa6'}>
                            {val == null ? '—' : val.toFixed(2)}
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={(val ?? 0) * 20}
                          sx={{ height: 8, borderRadius: 4, mt: 0.5, bgcolor: '#e3e9f2', '& .MuiLinearProgress-bar': { borderRadius: 4 } }}
                        />
                      </Box>
                    );
                  })}
                </Stack>
              </CardContent>
            </Card>

            <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', overflow: 'hidden' }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                      <TableCell sx={{ fontWeight: 600 }}>屋苑</TableCell>
                      <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>已發送</TableCell>
                      <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>已回覆</TableCell>
                      <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>已過期</TableCell>
                      <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>低分</TableCell>
                      <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>回覆率</TableCell>
                      <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>平均分</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data?.byEstate.map((r) => (
                      <TableRow key={r.estateCode} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{r.estateNameZh} <Typography component="span" variant="caption" color="text.secondary">{r.estateCode}</Typography></TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>{r.sent}</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>{r.submitted}</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>{r.expired}</TableCell>
                        <TableCell sx={{ textAlign: 'right', color: r.lowScoreCount ? '#c62828' : undefined }}>{r.lowScoreCount}</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>{r.replyRate.toFixed(1)}%</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontWeight: 600 }}>{r.avgOverall == null ? '—' : r.avgOverall.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {loading && <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box>}
            </Paper>
          </>
        )}
      </Box>
    </Box>
  );
}
