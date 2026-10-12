import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, CircularProgress, IconButton, MenuItem, Select, Snackbar, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { api, ApiRequestError, authStore } from '../../api/client';
import { AdminPageToolbar } from '../../components/AdminPageToolbar';
import AdminNav from '../../admin/AdminNav';

/** 問卷固定四題基準指標；key 鎖定，下拉以中文顯示 */
const BASE_QUESTIONS = [
  { key: 'overall', zh: '整體滿意度' },
  { key: 'response', zh: '回應速度' },
  { key: 'attitude', zh: '處理人員態度' },
  { key: 'resolution', zh: '問題解決程度' },
];

const BASE_KEYS = BASE_QUESTIONS.map((b) => b.key);
const KEY_RE = /^[a-z][a-z0-9_]*$/;

/** 新增自訂題時可下拉選擇的建議 key */
const SUGGESTED_KEYS = [
  { key: 'cleanliness', zh: '環境清潔' },
  { key: 'professionalism', zh: '專業能力' },
  { key: 'communication', zh: '溝通說明' },
  { key: 'timeliness', zh: '處理時效' },
  { key: 'courtesy', zh: '禮貌親切' },
  { key: 'followup', zh: '後續追蹤' },
  { key: 'recommend', zh: '推薦意願' },
];

interface QuestionItem { key: string; zh: string; en: string; }

function loadItems(value: any): QuestionItem[] {
  const zh: any[] = Array.isArray(value?.zh) ? value.zh : [];
  const en: any[] = Array.isArray(value?.en) ? value.en : [];
  const zhMap: Record<string, string> = {};
  const enMap: Record<string, string> = {};
  zh.forEach((q: any) => { if (q && q.key) zhMap[q.key] = q.label; });
  en.forEach((q: any) => { if (q && q.key) enMap[q.key] = q.label; });
  const order = (zh.map((q: any) => q?.key).filter(Boolean) as string[]);
  const seen = new Set<string>();
  const out: QuestionItem[] = [];
  // 基準題固定在前，依 BASE 順序
  for (const b of BASE_QUESTIONS) {
    out.push({ key: b.key, zh: zhMap[b.key] || '', en: enMap[b.key] || '' });
    seen.add(b.key);
  }
  // 其後接自訂題（依儲存順序）
  for (const k of order) {
    if (seen.has(k)) continue;
    out.push({ key: k, zh: zhMap[k] || '', en: enMap[k] || '' });
    seen.add(k);
  }
  return out;
}

function toPayload(items: QuestionItem[]) {
  return {
    zh: items.map((it) => ({ key: it.key, label: it.zh })),
    en: items.map((it) => ({ key: it.key, label: it.en })),
  };
}

function validateItems(items: QuestionItem[]): string | null {
  if (items.length < 1 || items.length > 20) return '題數須為 1–20';
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.key) return '題目 key 不得為空';
    if (!KEY_RE.test(it.key)) return `key「${it.key}」須為小寫英文/數字/底線，且以英文字母開頭`;
    if (!it.zh.trim() || !it.en.trim()) return `題目「${it.key}」的繁中與英文標籤均不得為空`;
    if (seen.has(it.key)) return `key 重複：${it.key}`;
    seen.add(it.key);
  }
  for (const k of BASE_KEYS) if (!seen.has(k)) return `必須保留基準題目：${BASE_KEYS.join('/')}`;
  return null;
}

export function SurveyTemplatePage() {
  const navigate = useNavigate();
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const permissions: string[] = user?.permissions || [];
  const canView = permissions.includes('config:view');
  const canEdit = permissions.includes('config:update');

  const [items, setItems] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.configList(token).then((d) => {
      const found = d.groups.flatMap((g) => g.items).find((it) => it.key === 'survey.questions');
      setItems(found ? loadItems(found.value) : loadItems({}));
    }).catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入失敗'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { if (canView) load(); else setLoading(false); }, [canView, load]);

  const updateItem = (idx: number, patch: Partial<QuestionItem>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { key: '', zh: '', en: '' }]);
  const removeItem = (idx: number) => setItems((arr) => arr.filter((_, i) => i !== idx));
  const moveItem = (idx: number, dir: -1 | 1) => setItems((arr) => {
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return arr;
    const copy = [...arr];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    return copy;
  });

  const onSave = async () => {
    const err = validateItems(items);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await api.configUpdate('survey.questions', toPayload(items), token);
      setSnack('已儲存問卷範本');
      load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')} sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>個案管理</Button>
        </Toolbar>
        <Alert severity="warning" sx={{ mt: 2 }}>當前帳號沒有 config:view 權限，無法檢視問卷範本。</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <AdminPageToolbar title="問卷範本" />
      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="xl" mx="auto">
        <AdminNav current="survey-templates" />
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2, mb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>問卷範本</Typography>
            <Typography variant="caption" color="text.secondary">修改後即時套用於未來新產生的滿意度調查問卷（不影響已發出者）。</Typography>
          </Box>
          {canEdit && (
            <Button startIcon={<AddIcon />} variant="outlined" onClick={addItem} disabled={items.length >= 20}>新增題目</Button>
          )}
        </Stack>

        {error && <Alert severity="error" sx={{ mt: 1, mb: 1 }} onClose={() => setError('')}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mt: 1 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>題目 key</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>繁中標籤</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>English 標籤</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 80 }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((it, idx) => {
                    const isBase = BASE_KEYS.includes(it.key);
                    const usedKeys = new Set(items.map((x) => x.key).filter((k) => k !== it.key));
                    return (
                      <TableRow key={it.key || `c-${idx}`}>
                        <TableCell>
                          {isBase ? (
                            <Select
                              size="small" fullWidth disabled
                              value={it.key}
                              onChange={() => {}}
                            >
                              {BASE_QUESTIONS.map((b) => (
                                <MenuItem key={b.key} value={b.key}>{b.zh}（{b.key}）</MenuItem>
                              ))}
                            </Select>
                          ) : (
                            <Autocomplete
                              freeSolo
                              size="small"
                              fullWidth
                              disabled={!canEdit}
                              options={SUGGESTED_KEYS
                                .filter((s) => !usedKeys.has(s.key))
                                .map((s) => s.key)}
                              value={it.key}
                              getOptionLabel={(opt) => {
                                const s = SUGGESTED_KEYS.find((x) => x.key === (opt as string));
                                return s ? `${s.zh}（${s.key}）` : (opt as string);
                              }}
                              onInputChange={(_, v, reason) => {
                                if (reason !== 'reset') updateItem(idx, { key: v.trim().toLowerCase() });
                              }}
                              renderOption={(props, opt) => {
                                const hint = SUGGESTED_KEYS.find((s) => s.key === opt);
                                return <li {...props} key={opt}>{hint ? `${hint.zh}（${opt}）` : opt}</li>;
                              }}
                              renderInput={(params) => (
                                <TextField {...params} size="small" placeholder="下拉選擇或輸入 key" />
                              )}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <TextField size="small" fullWidth value={it.zh} disabled={!canEdit}
                            onChange={(e) => updateItem(idx, { zh: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" fullWidth value={it.en} disabled={!canEdit}
                            onChange={(e) => updateItem(idx, { en: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          {canEdit ? (
                            <Stack direction="row" spacing={0.25} alignItems="center">
                              <IconButton size="small" disabled={idx === 0} onClick={() => moveItem(idx, -1)} title="上移">
                                <ArrowUpwardIcon fontSize="small" />
                              </IconButton>
                              <IconButton size="small" disabled={idx === items.length - 1} onClick={() => moveItem(idx, 1)} title="下移">
                                <ArrowDownwardIcon fontSize="small" />
                              </IconButton>
                              {!isBase && (
                                <IconButton size="small" color="error" onClick={() => removeItem(idx)} title="刪除題目">
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              )}
                            </Stack>
                          ) : isBase ? (
                            <Typography variant="caption" color="text.secondary">基準</Typography>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <CardContent>
              <Alert severity="info">「整體滿意度 / 回應速度 / 處理人員態度 / 問題解決程度」四題為基準題目（以中文下拉鎖定、不可刪除），問卷分析 KPI 依此計算；可新增自訂題目並調整順序，但須保留四基準 key。</Alert>
              {canEdit && (
                <Box sx={{ mt: 1.5, textAlign: 'right' }}>
                  <Button startIcon={<SaveIcon />} variant="contained" disabled={saving} onClick={onSave}>
                    {saving ? '儲存中…' : '儲存'}
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>
        )}

        {!canEdit && !loading && (
          <Alert severity="info" sx={{ mt: 2 }}>當前帳號僅可檢視（config:view）；如需編輯請具備 config:update 權限。</Alert>
        )}

        <Snackbar open={!!snack} autoHideDuration={2500} onClose={() => setSnack('')} message={snack} />
      </Box>
    </Box>
  );
}
