/**
 * AI-03 智能分派建議卡（§4.3 級一：規則＋SQL 統計）。
 * - 顯示依「類別對應偏好角色＋近 N 日同類別處理量／速度／質素」排序的候選人；
 * - enabled=false 時靜默提示（AI 總開關或分派開關未啟用）；
 * - 具 case:assign 權限且個案處於 PENDING/REOPENED 時，可「採納此建議並分派」。
 * 採納仍走現有分派 API（caseService.assignCase），不改寫建議本身。
 * 見 docs/AI_利用方案.md §4.3。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography,
} from '@mui/material';
import { api, ApiRequestError, authStore, AiAssigneeSuggestion } from '../api/client';
import { CATEGORY_OPTIONS, ROLE_OPTIONS, labelOf } from '../admin/options';

interface Props {
  caseId: string;
  canAssign: boolean;
  caseClosed: boolean;
  caseStatus: string;
  onChanged: () => void;
  onMessage: (msg: string) => void;
}

function fmtScore(score: number): string {
  return `${Math.round(score * 100)} 分`;
}

export function AiAssigneeCard({ caseId, canAssign, caseClosed, caseStatus, onChanged, onMessage }: Props) {
  const [data, setData] = useState<AiAssigneeSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!caseId) return;
    setLoading(true);
    api
      .aiAssigneeSuggestion(caseId, authStore.getToken() || '')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : 'AI 分派建議載入失敗'))
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const adopt = () => {
    if (!data || data.suggestedUserId == null) return;
    setBusy(true);
    api
      .assignCase(caseId, { assigneeId: data.suggestedUserId }, authStore.getToken() || '')
      .then(() => {
        onMessage(`已採納 AI 分派建議，分派給 ${data.suggestedUserName || data.suggestedUserId}`);
        onChanged();
        load();
      })
      .catch((e) => onMessage(e instanceof ApiRequestError ? `採納分派失敗：${e.message}` : '採納分派失敗'))
      .finally(() => setBusy(false));
  };

  const canAdopt = canAssign && !caseClosed && (caseStatus === 'PENDING' || caseStatus === 'REOPENED');

  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
      <Box sx={{ px: 2.5, py: 1.6, display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600}>AI 分派建議</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={load} disabled={loading}>重新整理</Button>
        {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
      </Box>
      <CardContent>
        {error && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>{error}</Typography>
        )}
        {!loading && data && !data.enabled && (
          <Alert severity="info" sx={{ fontSize: 13 }}>
            AI 智能分派建議未啟用（請於「系統參數 → AI 參數」開啟 AI 總開關與「智能分派」開關）。
          </Alert>
        )}
        {!loading && data && data.enabled && (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1.2 }} alignItems="center">
              <Chip size="small" variant="outlined" label={`類別：${labelOf(CATEGORY_OPTIONS, data.category, 'zh-Hant')}`} />
              <Chip size="small" variant="outlined" label={`偏好角色：${labelOf(ROLE_OPTIONS, data.preferredRole, 'zh-Hant') || '—'}`} />
              <Chip size="small" variant="outlined" label={`統計窗口：${data.lookbackDays} 日`} />
            </Stack>

            {data.suggestedUserId != null && (
              <Box sx={{ border: '1px solid #d7e7ff', borderRadius: 1.5, p: 1.6, bgcolor: '#f3f9ff', mb: 1.5 }}>
                <Typography variant="subtitle2" color="#1565c0">
                  建議分派：{data.suggestedUserName}
                  <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 400 }}>
                    （評分 {fmtScore(data.candidates.find((c) => c.userId === data.suggestedUserId)?.score || 0)}）
                  </Box>
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    disabled={!canAdopt || busy}
                    onClick={adopt}
                  >
                    {busy ? '分派中…' : '採納此建議並分派'}
                  </Button>
                  {!canAssign && <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>需要 case:assign 權限</Typography>}
                  {canAssign && caseClosed && <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>個案已關閉，不能分派</Typography>}
                  {canAssign && !caseClosed && caseStatus !== 'PENDING' && caseStatus !== 'REOPENED' && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>僅待分派／已重開狀態可採納分派</Typography>
                  )}
                </Box>
              </Box>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
              候選人依「偏好角色＋處理量／速度／質素」綜合評分排序（{data.candidates.length} 人）：
            </Typography>
            <Stack spacing={1}>
              {data.candidates.map((c) => (
                <Box
                  key={c.userId}
                  sx={{
                    border: '1px solid #e8edf4', borderRadius: 1.5, p: 1.4,
                    bgcolor: c.userId === data.suggestedUserId ? '#f3f9ff' : '#fafbfd',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" fontWeight={600}>{c.fullName}</Typography>
                    {c.isPreferredRole && <Chip size="small" color="primary" label="偏好角色" />}
                    <Chip size="small" variant="outlined" label={fmtScore(c.score)} />
                    <Box sx={{ flex: 1 }} />
                    {c.roleCodes.map((rc) => (
                      <Chip key={rc} size="small" variant="outlined" label={labelOf(ROLE_OPTIONS, rc, 'zh-Hant')} />
                    ))}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {c.reason}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    同類別 {c.stats.sameCategoryCount} 宗 · 平均結案 {c.stats.avgHandlingDays != null ? `${c.stats.avgHandlingDays.toFixed(1)} 日` : '—'} · 逾期 {c.stats.overdue}/{c.stats.judged || 0} · 進行中 {c.stats.openCount}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
