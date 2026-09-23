/**
 * AI 建議卡（M0 / AI-01 內容分類影子模式）。
 * - 顯示個案之 AI 分類建議（case:view 已於頁面層保證）；
 * - status=shown 且有 case:update 權限時可「採納 / 忽略」；
 * - 採納會即時套用類別/事件並重算 SLA，故需通知父層刷新個案。
 * 見 docs/AI_利用方案.md §7.1。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography, Tooltip,
} from '@mui/material';
import {
  AiSuggestionItem, AiSimilarMatch, api, ApiRequestError, authStore,
} from '../api/client';
import { useAiFeatures, featureOn } from '../aiFeatures';
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
  const [similarItems, setSimilarItems] = useState<AiSuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { features } = useAiFeatures();
  const showClassify = featureOn(features, 'classify'); // AI-01
  const showSimilar = featureOn(features, 'similar');   // AI-02

  const load = useCallback(() => {
    if (!caseId) return;
    setLoading(true);
    api
      .listAiSuggestions(caseId, authStore.getToken() || '')
      .then((rows) => {
        setItems(rows.filter((r) => r.aiType === 'classify'));
        setSimilarItems(rows.filter((r) => r.aiType === 'similar_case'));
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

  /** AI-02 確認相似個案為重複 → 關聯 original_case_id（標記二次投訴；case:update） */
  const linkCase = (s: AiSuggestionItem, targetCaseId: string) => {
    setBusyId(s.suggestionId);
    api.linkSimilarCase(caseId, s.suggestionId, targetCaseId, authStore.getToken() || '')
      .then(() => {
        onMessage(`已關聯至相似個案 ${targetCaseId}（本個案標記為二次投訴）`);
        load();
        onChanged();
      })
      .catch((e) => onMessage(e instanceof ApiRequestError ? `關聯失敗：${e.message}` : '關聯失敗'))
      .finally(() => setBusyId(null));
  };

  const shownCount = items.filter((i) => i.status === 'shown').length;
  const actionable = canUpdate && !caseClosed;

  if (!showClassify && !showSimilar) return null;

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
        {showClassify && !loading && items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            暫無 AI 分類建議（啟用「系統參數 → AI 參數」的 AI 總開關後，新個案會自動分析；有差異才會顯示建議）。
            想為此個案立即產生建議，可按右上角「重新分析」。
          </Typography>
        )}
        {showClassify && (
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
        )}
        {/* AI-02 相似個案建議（語意防重；docs/AI_利用方案.md §4.2） */}
        {showSimilar && similarItems.length > 0 && (
          <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px dashed #e3e9f2' }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: '#b26a00' }}>相似個案建議（AI-02 語意防重）</Typography>
            <Stack spacing={1.5}>
              {similarItems.map((s) => {
                const meta = STATUS_META[s.status] || STATUS_META.pending;
                const pl = (s.payload || {}) as { matches?: AiSimilarMatch[]; threshold?: number };
                const matches = pl.matches || [];
                return (
                  <Box key={s.suggestionId} sx={{ border: '1px solid #e8edf4', borderRadius: 1.5, p: 1.6, bgcolor: s.status === 'shown' ? '#fff7f5' : '#fafbfd' }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.8 }}>
                      <Chip size="small" label={meta.label} color={meta.color} />
                      <Typography variant="caption" color="text.secondary">相似度閾值 {pl.threshold != null ? pl.threshold : '—'}</Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color="text.secondary">{s.model ? s.model : ''}{s.createdAt ? ` · ${fmt(s.createdAt)}` : ''}</Typography>
                    </Stack>
                    {matches.length === 0 && s.status === 'shown' && (
                      <Typography variant="body2" color="text.secondary">暫無達到閾值的相似個案。</Typography>
                    )}
                    {matches.map((m) => (
                      <Box key={m.caseId} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, rowGap: 0.5, minWidth: 0, py: 0.6, borderTop: '1px dashed #eef1f6' }}>
                        <Link to={`/admin/cases/${encodeURIComponent(m.caseId)}`} style={{ fontFamily: '"Roboto Mono", monospace', fontWeight: 700, color: '#1a5aa6', wordBreak: 'break-all' }}>{m.caseId}</Link>
                        <Chip size="small" variant="outlined" label={labelOf(CATEGORY_OPTIONS, m.category, 'zh-Hant')} />
                        <Chip size="small" color="primary" label={`相似度 ${Math.round(m.score * 100)}%`} />
                        <Box sx={{ flex: 1, minWidth: 0 }} />
                        {s.status === 'shown' && (
                          <Button size="small" variant="contained" color="warning" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }} disabled={!actionable || busyId === s.suggestionId} onClick={() => linkCase(s, m.caseId)}>關聯為原案</Button>
                        )}
                      </Box>
                    ))}
                    {matches.length > 0 && s.status === 'accepted' && (
                      <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>已由人員確認關聯（本個案標記為二次投訴，見個案頂部提示）。</Typography>
                    )}
                    {s.status === 'shown' && !canUpdate && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>需要 case:update 權限才能關聯。</Typography>
                    )}
                    {s.status === 'shown' && caseClosed && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>個案已關閉，不能關聯。</Typography>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
