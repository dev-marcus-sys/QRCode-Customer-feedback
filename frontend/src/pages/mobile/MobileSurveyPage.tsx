import { useEffect, useState } from 'react';
import { Alert, Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api, ApiRequestError, authStore, SurveyStatsData } from '../../api/client';
import { useEstates } from '../../admin/useEstates';
import { useAiFeatures, featureOn } from '../../aiFeatures';
import { SurveyInsightsCard } from '../../components/SurveyInsightsCard';
import { KpiTile, SectionCard, BarRow } from '../../mobile/MobileParts';

const AVG_LABELS: { key: 'overall' | 'response' | 'attitude' | 'resolution'; zh: string }[] = [
  { key: 'overall', zh: '整體滿意度' },
  { key: 'response', zh: '回應速度' },
  { key: 'attitude', zh: '服務態度' },
  { key: 'resolution', zh: '問題解決' },
];

/** 手機版問卷統計 /m/surveys：大字 KPI ＋ 各題平均分條＋ 屋苑卡片。 */
export function MobileSurveyPage() {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const scopeCodes = user && user.estateCodes && user.estateCodes.length && !user.estateCodes.includes('ALL')
    ? user.estateCodes : null;
  const estates = useEstates();
  const { features } = useAiFeatures();
  const showFeedback = featureOn(features, 'feedback');

  const [estate, setEstate] = useState('');
  const [data, setData] = useState<SurveyStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .surveyStats(token, scopeCodes ? (estate || scopeCodes[0]) : estate)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive) {
          setError(e instanceof ApiRequestError ? e.message : '載入統計失敗');
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
  }, [token, estate]);

  const o = data?.overall;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <TextField
          select size="small" label="屋苑" sx={{ minWidth: 170 }} disabled={!!scopeCodes && scopeCodes.length <= 1}
          value={scopeCodes ? (estate || scopeCodes[0]) : estate}
          onChange={(e) => setEstate(e.target.value)}
        >
          {!scopeCodes && <MenuItem value="">全部屋苑</MenuItem>}
          {(scopeCodes
            ? scopeCodes.map((c) => ({ code: c, zh: estates.nameOf(c) }))
            : estates.activeOptions.map((x) => ({ code: x.estateCode, zh: x.estateNameZh }))
          ).map((x) => (<MenuItem key={x.code} value={x.code}>{x.zh}</MenuItem>))}
        </TextField>
        <Chip label="匿名問卷，僅顯示統計" variant="outlined" size="small" />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>載入中…</Typography>}

      {!loading && o && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5, mb: 2 }}>
            <KpiTile label="已發送問卷" value={o.sent} unit="封" />
            <KpiTile label="已回覆" value={o.submitted} unit="份" tone="#2e7d32" />
            <KpiTile label="回覆率" value={o.replyRate.toFixed(1)} unit="%" tone="#2e7d32" />
            <KpiTile label="低分（≤2）" value={o.lowScoreCount} unit="份" tone="#c62828" />
          </Box>

          <SectionCard title="各題平均分（1–5）">
            {AVG_LABELS.map((q) => {
              const val = o.avg[q.key];
              return (
                <BarRow
                  key={q.key}
                  label={q.zh}
                  value={val == null ? '—' : val.toFixed(2)}
                  rate={Math.round((val ?? 0) * 20)}
                  color={val == null || val < 3 ? '#c62828' : '#1a5aa6'}
                />
              );
            })}
          </SectionCard>

          <SectionCard title="各屋苑">
            {data?.byEstate.map((r) => (
              <Box key={r.estateCode} sx={{ mb: 1.4, pb: 1.4, borderBottom: '1px dashed #edf0f5', '&:last-child': { borderBottom: 0, mb: 0, pb: 0 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Typography variant="body2" fontWeight={600}>{r.estateNameZh}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.estateCode}</Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  發送 {r.sent} · 回覆 {r.submitted} · 過期 {r.expired} · 低分{' '}
                  <Box component="span" color={r.lowScoreCount ? '#c62828' : 'inherit'}>{r.lowScoreCount}</Box> · 回覆率 {r.replyRate.toFixed(1)}%
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.3 }}>
                  平均分：<Box component="span" fontWeight={700} color={r.avgOverall == null ? 'text.secondary' : r.avgOverall < 3 ? '#c62828' : '#1a5aa6'}>
                    {r.avgOverall == null ? '—' : r.avgOverall.toFixed(2)}
                  </Box>
                </Typography>
              </Box>
            ))}
          </SectionCard>
        </>
      )}

      {showFeedback && <SurveyInsightsCard estate={scopeCodes ? (estate || scopeCodes[0]) : estate} />}
    </Box>
  );
}
