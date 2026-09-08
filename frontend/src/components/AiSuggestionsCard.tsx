/**
 * AI 建議卡（M0 / AI-01 內容分類影子模式）。
 * - 顯示個案之 AI 分類建議（case:view 已於頁面層保證）；
 * - status=shown 且有 case:update 權限時可「採納 / 忽略」；
 * - 採納會即時套用類別/事件並重算 SLA，故需通知父層刷新個案。
 * 見 docs/AI_利用方案.md §7.1。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography, Tooltip,
} from '@mui/material';
import {
  AiSuggestionItem, api, ApiRequestError, authStore,
} from '../api/client';
import { CATEGORY_OPTIONS, EVENT_OPTIONS, labelOf } from '../admin/options';

const INTENT_LABEL: Record<string, string> = {
  COMPLAINT: '投訴',
  FEEDBACK: '意見',
  INQUIRY: '查詢',
  COMPLIMENT: '讚揚',
};

const URGENCY_LABEL: Record<string, string> = {
  URGENT: '緊急',
  NORMAL: '一般',
};

const STATUS_META: Record<string, { label: string; color: 'default' | 'primary' | 'success' | 'error' | 'info' | 'warning' }> = {
  pending: { label: '排隊中', color: 'default' },
  shown: { label: '待覆核', color: 'info' },
  accepted: { label: '已採納', color: 'success' },
  rejected: { label: '已忽略', color: 'default' },
  skipped: { label: '無差異', color: 'default' },
  failed: { label: '處理失敗', color: 'error' },
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

interface Props {
  caseId: string;
  canUpdate: boolean;
  caseClosed: boolean;
  onChanged: () => void;
  onMessage: (msg: string) => void;
}

export function AiSuggestionsCard({ caseId, canUpdate, caseClosed, onChanged, onMessage }: Props) {
  const [items, setItems] = useState<AiSuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    if (!caseId) return;
    setLoading(true);
    api
      .listAiSuggestions(caseId, authStore.getToken() || '')
      .then((rows) => {
        setItems(rows.filter((r) => r.aiType === 'classify'));
        setError('');
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : 'AI 建議載入失敗'))
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  /** 重新分析：為本個案即時產生一筆新建議（補跑開關開啟前／後台建案之個案） */
  const reanalyze = () => {
    setRefreshing(true);
    api
      .refreshAiSuggestion(caseId, authStore.getToken() || '')
      .then(() => {
        onMessage('已重新分析，請查看下方結果');
        load();
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '重新分析失敗'))
      .finally(() => setRefreshing(false));
  };

  const decide = (s: AiSuggestionItem, accept: boolean) => {
    setBusyId(s.suggestionId);
    const token = authStore.getToken() || '';
    const call = accept
      ? api.acceptAiSuggestion(caseId, s.suggestionId, token)
      : api.rejectAiSuggestion(caseId, s.suggestionId, token);
    call
      .then((r) => {
        if (accept && r.changes.length) {
          onMessage(`已採納 AI 建議：${r.changes.join('；')}`);
        } else {
          onMessage(accept ? 'AI 建議已採納（無欄位變更）' : 'AI 建議已忽略');
        }
        load();
        if (accept) onChanged();
      })
      .catch((e) => onMessage(e instanceof ApiRequestError ? `操作失敗：${e.message}` : '操作失敗'))
      .finally(() => setBusyId(null));
  };

  const shownCount = items.filter((i) => i.status === 'shown').length;
  const actionable = canUpdate && !caseClosed;

  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
      <Box sx={{ px: 2.5, py: 1.6, display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600}>AI 建議</Typography>
        <Box sx={{ flex: 1 }} />
        {shownCount > 0 && <Chip size="small" color="info" label={`${shownCount} 筆待覆核`} />}
        <Button size="small" onClick={load} disabled={loading}>重新整理</Button>
        <Tooltip title="為本個案即時產生一筆新建議（可用於補跑舊個案／後台建案）">
          <span>
            <Button size="small" variant="outlined" onClick={reanalyze}
              disabled={refreshing || !canUpdate || caseClosed}>
              {refreshing ? '分析中…' : '重新分析'}
            </Button>
          </span>
        </Tooltip>
        {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
      </Box>
      <CardContent>
        {error && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>{error}</Typography>
        )}
        {!loading && items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            暫無 AI 分類建議（啟用「系統參數 → AI 參數」的 AI 總開關後，新個案會自動分析；有差異才會顯示建議）。
            想為此個案立即產生建議，可按右上角「重新分析」。
          </Typography>
        )}
        <Stack spacing={1.5}>
          {items.map((s) => {
            const meta = STATUS_META[s.status] || STATUS_META.pending;
            const p = s.payload;
            return (
              <Box
                key={s.suggestionId}
                sx={{ border: '1px solid #e8edf4', borderRadius: 1.5, p: 1.6, bgcolor: s.status === 'shown' ? '#f5f9ff' : '#fafbfd' }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.8 }}>
                  <Chip size="small" label={meta.label} color={meta.color} />
                  {p && p.withDiff && (
                    <Typography variant="caption" color="text.secondary">
                      建議改列「{labelOf(CATEGORY_OPTIONS, p.category, 'zh-Hant')}」
                      （{labelOf(EVENT_OPTIONS, p.eventType, 'zh-Hant')} · {URGENCY_LABEL[p.urgency] || p.urgency}）
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">
                    {s.confidence != null ? `信心 ${Math.round(s.confidence * 100)}%` : ''}
                    {s.createdAt ? ` · ${fmt(s.createdAt)}` : ''}
                    {s.model ? ` · ${s.model}` : ''}
                  </Typography>
                </Stack>

                {p && p.baseline && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                    現行：{labelOf(CATEGORY_OPTIONS, p.baseline.category, 'zh-Hant')}
                    {' / '}{labelOf(EVENT_OPTIONS, p.baseline.eventType, 'zh-Hant')}
                    {' / '}{INTENT_LABEL[p.baseline.intent] || p.baseline.intent}
                    {'  →  建議：'}
                    {labelOf(CATEGORY_OPTIONS, p.category, 'zh-Hant')}
                    {' / '}{labelOf(EVENT_OPTIONS, p.eventType, 'zh-Hant')}
                    {' / '}{INTENT_LABEL[p.intent] || p.intent}
                  </Typography>
                )}
                {p && p.reason && (
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{p.reason}</Typography>
                )}
                {s.status === 'skipped' && s.error === 'no_diff' && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                    與現行規則判定一致，無需調整（影子模式基線）。
                  </Typography>
                )}
                {s.status === 'pending' && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    排隊中：rules 會即時完成；openai／ollama 由排程處理（每 60 秒一次），
                    亦可到「系統參數 → AI 連線測試」按「立即處理佇列」。
                  </Typography>
                )}
                {s.status === 'failed' && s.error && (
                  <Typography variant="caption" color="error" sx={{ display: 'block' }}>{s.error}</Typography>
                )}
                {s.status === 'accepted' && (
                  <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.3 }}>
                    {s.decidedByName ? `${s.decidedByName} 已採納 · ${fmt(s.decidedAt)}` : `已採納 · ${fmt(s.decidedAt)}`}
                    {s.decidedNote ? `（備註：${s.decidedNote}）` : ''}
                  </Typography>
                )}
                {s.status === 'rejected' && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                    {s.decidedByName ? `${s.decidedByName} 已忽略 · ${fmt(s.decidedAt)}` : `已忽略 · ${fmt(s.decidedAt)}`}
                    {s.decidedNote ? `（備註：${s.decidedNote}）` : ''}
                  </Typography>
                )}

                {s.status === 'shown' && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="primary"
                      disabled={!actionable || busyId === s.suggestionId}
                      onClick={() => decide(s, true)}
                    >
                      採納
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      disabled={!actionable || busyId === s.suggestionId}
                      onClick={() => decide(s, false)}
                    >
                      忽略
                    </Button>
                    {!canUpdate && <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>需要 case:update 權限</Typography>}
                    {caseClosed && <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>個案已關閉，不能採納</Typography>}
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
