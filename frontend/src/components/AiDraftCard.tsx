/**
 * AI-04 草擬回覆／個案摘要卡（docs/AI_利用方案.md §4.4）。
 * - 產生「個案摘要」或「回覆草稿」建議（AI 只出草稿，不自動對外發送）；
 * - 人員必須於文字框內編輯／確認後按「存入個案紀錄」，才寫入 case_log（AI_DRAFT_USED）；
 * - 需 case:update 權限；個案已關閉時不可存入。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, TextField, Typography,
} from '@mui/material';
import { api, ApiRequestError, authStore, AiSuggestionItem, AiDraftPayload } from '../api/client';

interface Props {
  caseId: string;
  canUpdate: boolean;
  caseClosed: boolean;
  onChanged: () => void;
  onMessage: (msg: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  summary: '個案摘要',
  reply: '回覆草稿',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

export function AiDraftCard({ caseId, canUpdate, caseClosed, onChanged, onMessage }: Props) {
  const [items, setItems] = useState<AiSuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'summary' | 'reply' | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    if (!caseId) return;
    setLoading(true);
    api
      .listAiSuggestions(caseId, authStore.getToken() || '')
      .then((rows) => {
        setItems(rows.filter((r) => r.aiType === 'draft'));
        setError('');
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : 'AI 草稿載入失敗'))
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  /** 供外部（如重新整理）重載後清掉暫存編輯內容 */
  useEffect(() => {
    const next: Record<number, string> = {};
    for (const it of items) {
      const pl = (it.payload || {}) as AiDraftPayload;
      next[it.suggestionId] = drafts[it.suggestionId] != null ? drafts[it.suggestionId] : (pl.text || '');
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const generate = (kind: 'summary' | 'reply') => {
    setBusy(kind);
    setError('');
    api
      .createAiDraft(caseId, kind, 'zh-Hant', authStore.getToken() || '')
      .then((r) => {
        setDrafts((cur) => ({ ...cur, [r.suggestionId]: r.payload.text || '' }));
        onMessage(`已產生${KIND_LABEL[kind] || kind}草稿，請編修後存入個案紀錄`);
        load();
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '草稿產生失敗'))
      .finally(() => setBusy(null));
  };

  const save = (s: AiSuggestionItem) => {
    const content = String(drafts[s.suggestionId] || '').trim();
    if (!content) {
      setError('請先填寫／確認草稿內容');
      return;
    }
    setSavingId(s.suggestionId);
    setError('');
    api
      .useAiDraft(caseId, s.suggestionId, content, authStore.getToken() || '')
      .then(() => {
        onMessage('草稿已存入個案紀錄（時間軸可見）');
        load();
        onChanged();
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '存入失敗'))
      .finally(() => setSavingId(null));
  };

  const actionable = canUpdate && !caseClosed;

  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
      <Box sx={{ px: 2.5, py: 1.6, display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600}>AI 草稿／摘要</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={load} disabled={loading}>重新整理</Button>
        {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
      </Box>
      <CardContent>
        {error && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>{error}</Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={!actionable || busy !== null}
            onClick={() => generate('summary')}
          >
            {busy === 'summary' ? '產生中…' : '產生個案摘要'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={!actionable || busy !== null}
            onClick={() => generate('reply')}
          >
            {busy === 'reply' ? '產生中…' : '產生回覆草稿'}
          </Button>
          {!canUpdate && <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>需要 case:update 權限</Typography>}
          {canUpdate && caseClosed && <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>個案已關閉</Typography>}
        </Stack>

        {!loading && items.length === 0 && (
          <Alert severity="info" sx={{ fontSize: 13 }}>
            尚無 AI 草稿。按上方按鈕產生摘要或回覆草稿（需於「系統參數 → AI 參數」開啟 AI 總開關與「AI-04 草擬回覆／個案摘要」）。
            草稿只供參考，必須經人手編修後存入，系統不會自動寄出。
          </Alert>
        )}

        <Stack spacing={1.5}>
          {items.map((s) => {
            const pl = (s.payload || {}) as AiDraftPayload;
            const kind = pl.kind || 'summary';
            return (
              <Box
                key={s.suggestionId}
                sx={{ border: '1px solid #e8edf4', borderRadius: 1.5, p: 1.6, bgcolor: s.status === 'shown' ? '#f5f9ff' : '#fafbfd' }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Chip size="small" color="primary" variant="outlined" label={KIND_LABEL[kind] || kind} />
                  {pl.fallback && <Chip size="small" color="warning" label="遠端失敗已回落範本" />}
                  <Chip
                    size="small"
                    label={s.status === 'accepted' ? '已存入' : s.status === 'shown' ? '待編修' : s.status}
                    color={s.status === 'accepted' ? 'success' : s.status === 'shown' ? 'info' : 'default'}
                  />
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">
                    {s.confidence != null ? `信心 ${Math.round(s.confidence * 100)}%` : ''}
                    {s.model ? ` · ${s.model}` : ''}
                    {s.createdAt ? ` · ${fmt(s.createdAt)}` : ''}
                  </Typography>
                </Stack>

                {pl.points && pl.points.length > 0 && (
                  <Box sx={{ mb: 1 }}>
                    {pl.points.map((p, i) => (
                      <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                        {p.label}：{p.text}
                      </Typography>
                    ))}
                  </Box>
                )}

                <TextField
                  fullWidth
                  multiline
                  minRows={6}
                  size="small"
                  value={drafts[s.suggestionId] != null ? drafts[s.suggestionId] : (pl.text || '')}
                  onChange={(e) => setDrafts((cur) => ({ ...cur, [s.suggestionId]: e.target.value }))}
                  disabled={s.status === 'accepted'}
                  helperText="可自由編修；送出後會以「經人手編輯後採用」寫入個案時間軸。"
                />

                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={s.status === 'accepted' || !actionable || savingId === s.suggestionId}
                    onClick={() => save(s)}
                  >
                    {savingId === s.suggestionId ? '存入中…' : '存入個案紀錄'}
                  </Button>
                  {s.status === 'accepted' && (
                    <Typography variant="caption" color="success.main" sx={{ ml: 1 }}>
                      已於 {fmt(s.decidedAt)} 存入（{s.decidedByName || s.decidedNote || '已採納'}）
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
