/**
 * AI-05 問卷開放意見分析卡（docs/AI_利用方案.md §4.5）。
 * - 對已提交問卷之開放文字做主題分類＋情緒分析，供管理層／屋苑主管洞察；
 * - 顯示主題分佈（筆數／平均分／負面率）、情緒分佈與逐份明細；
 * - 可手動觸發批次分析（補跑既有已提交問卷）；排程亦會自動處理。
 * - 權限 dashboard:view；屋苑範圍由服務層依 user.estateCode 收斂。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, LinearProgress, Stack, Typography,
} from '@mui/material';
import { api, ApiRequestError, authStore, SurveyInsightsData, FeedbackSentiment } from '../api/client';

interface Props {
  estate?: string;
}

const SENTIMENT_META: Record<FeedbackSentiment, { label: string; color: 'success' | 'default' | 'error' }> = {
  positive: { label: '正面', color: 'success' },
  neutral: { label: '中性', color: 'default' },
  negative: { label: '負面', color: 'error' },
};

export function SurveyInsightsCard({ estate = '' }: Props) {
  const [data, setData] = useState<SurveyInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (estate) params.set('estate', estate);
    api
      .surveyInsights(params.toString(), authStore.getToken() || '')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '意見分析載入失敗'))
      .finally(() => setLoading(false));
  }, [estate]);

  useEffect(() => {
    load();
  }, [load]);

  const run = () => {
    setRunning(true);
    setError('');
    api
      .runSurveyInsights(50, authStore.getToken() || '')
      .then((r) => {
        setError('');
        load();
        // eslint-disable-next-line no-console
        console.info('[AI-05] 批次分析完成', r.processed);
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '批次分析失敗'))
      .finally(() => setRunning(false));
  };

  const maxCount = data && data.topics.length ? Math.max(...data.topics.map((t) => t.count)) : 0;

  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2, mt: 2 }}>
      <Box sx={{ px: 2.5, py: 1.6, display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600}>AI 意見分析（AI-05）</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={load} disabled={loading}>重新整理</Button>
        <Button size="small" variant="outlined" onClick={run} disabled={running || loading} sx={{ ml: 1 }}>
          {running ? '分析中…' : '立即分析'}
        </Button>
        {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
      </Box>
      <CardContent>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5, fontSize: 13 }}>{error}</Alert>
        )}

        {!loading && data && data.total === 0 && (
          <Alert severity="info" sx={{ fontSize: 13 }}>
            尚無意見分析結果。請於「系統參數 → AI 參數」開啟 AI 總開關與「AI-05 問卷意見分析」，
            系統會由排程自動處理已提交問卷；亦可按右上方「立即分析」補跑。
          </Alert>
        )}

        {!loading && data && data.total > 0 && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>情緒分佈（共 {data.total} 份）</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {(['positive', 'neutral', 'negative'] as FeedbackSentiment[]).map((k) => (
                  <Chip
                    key={k}
                    size="small"
                    color={SENTIMENT_META[k].color}
                    variant={k === 'negative' ? 'filled' : 'outlined'}
                    label={`${SENTIMENT_META[k].label} ${data.sentiment[k]}`}
                  />
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>主題分佈</Typography>
              <Stack spacing={1.2}>
                {data.topics.map((t) => (
                  <Box key={t.topic}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                      <Typography variant="body2">{t.topic}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                        {t.count} 筆 · 平均 {t.avgOverall == null ? '—' : t.avgOverall.toFixed(2)} · 負面 {Math.round(t.negativeRate * 100)}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={maxCount ? (t.count / maxCount) * 100 : 0}
                      sx={{ height: 8, borderRadius: 4, mt: 0.4, bgcolor: '#e3e9f2', '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: t.negativeRate >= 0.5 ? '#c62828' : '#1a5aa6' } }}
                    />
                  </Box>
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>逐份意見（最近 {Math.min(data.items.length, 20)} 份）</Typography>
              <Stack spacing={1}>
                {data.items.slice(0, 20).map((it) => (
                  <Box
                    key={it.surveyId}
                    sx={{ border: '1px solid #e8edf4', borderRadius: 1.5, p: 1.4, bgcolor: it.isLowScore ? '#fff7f5' : '#fafbfd' }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                      <Link
                        to={`/admin/cases/${encodeURIComponent(it.caseId)}`}
                        style={{ fontFamily: '"Roboto Mono", monospace', fontWeight: 700, color: '#1a5aa6' }}
                      >
                        {it.caseId}
                      </Link>
                      <Chip size="small" variant="outlined" label={it.estateNameZh || it.estateCode} />
                      <Chip
                        size="small"
                        color={SENTIMENT_META[it.sentiment].color}
                        variant="outlined"
                        label={SENTIMENT_META[it.sentiment].label}
                      />
                      {it.overall != null && <Chip size="small" variant="outlined" label={`${it.overall} 分`} />}
                      {it.isLowScore && <Chip size="small" color="error" label="低分" />}
                      <Box sx={{ flex: 1 }} />
                      {it.topics.map((t) => (
                        <Chip key={t} size="small" color="primary" variant="outlined" label={t} />
                      ))}
                    </Stack>
                    {it.summary && (
                      <Typography variant="body2" sx={{ mt: 0.6, whiteSpace: 'pre-wrap' }}>{it.summary}</Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
