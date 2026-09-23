/**
 * AI-09 RAG 知識庫管理／查詢頁（docs/AI_利用方案.md §4.9）。
 * - 管理（kb:manage）：入庫 wiki／Markdown 文件、啟用／停用、刪除。
 * - 查詢（case:view 或 dashboard:view）：檢索 top-k 段落（附章節來源）或問答（附引用）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { api, authStore, KbDocument } from '../../api/client';
import { useAiFeatures, featureOn } from '../../aiFeatures';

type TabKey = 'docs' | 'query';

export default function KnowledgeBasePage() {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const perms = useMemo(() => new Set(user?.permissions || []), [user]);
  const canManage = perms.has('kb:manage');
  const canRead = perms.has('case:view') || perms.has('dashboard:view');
  const { features } = useAiFeatures();
  const kbEnabled = featureOn(features, 'kb'); // AI-09 知識庫檢索開關

  const [tab, setTab] = useState<TabKey>(canManage ? 'docs' : 'query');
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 入庫表單
  const [form, setForm] = useState({ title: '', source: '', version: '1', owner: user?.fullName || '', status: 'active', content: '' });
  const [submitting, setSubmitting] = useState(false);

  // 查詢
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [search, setSearch] = useState<{ results: any[] } | null>(null);
  const [answer, setAnswer] = useState<{ answer: string; fallback: boolean; generated: boolean; model: string | null } | null>(null);
  const [querying, setQuerying] = useState(false);

  async function loadDocs() {
    if (!canManage) return;
    try { const d = await api.kbListDocuments(token); setDocs(d.items || []); } catch (e: any) { setMsg({ kind: 'err', text: e.message || '載入失敗' }); }
  }
  useEffect(() => { loadDocs(); /* eslint-disable-next-line */ }, []);

  async function submitIngest() {
    setSubmitting(true); setMsg(null);
    try {
      const r = await api.kbIngest({ ...form }, token);
      setMsg({ kind: 'ok', text: `已入庫 ${form.title}（${r.chunkCount} 塊）` });
      setForm({ ...form, title: '', source: '', content: '' });
      await loadDocs();
    } catch (e: any) { setMsg({ kind: 'err', text: e.message || '入庫失敗' }); }
    finally { setSubmitting(false); }
  }

  async function setStatus(doc: KbDocument, status: string) {
    try { await api.kbSetStatus(doc.docId, status, token); setMsg({ kind: 'ok', text: `已將「${doc.title}」設為 ${status}` }); await loadDocs(); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message || '操作失敗' }); }
  }
  async function del(doc: KbDocument) {
    if (!confirm(`確定刪除知識文件「${doc.title}」？`)) return;
    try { await api.kbDelete(doc.docId, token); setMsg({ kind: 'ok', text: `已刪除 ${doc.title}` }); await loadDocs(); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message || '刪除失敗' }); }
  }

  async function doSearch() {
    if (!query.trim()) return;
    setQuerying(true); setAnswer(null); setMsg(null);
    try { const r = await api.kbSearch(query, topK, token); setSearch({ results: r.results }); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message || '檢索失敗' }); }
    finally { setQuerying(false); }
  }
  async function doAsk() {
    if (!query.trim()) return;
    setQuerying(true); setSearch(null); setMsg(null);
    try { const r = await api.kbAsk(query, topK, token); setAnswer({ answer: r.answer, fallback: r.fallback, generated: r.generated, model: r.model }); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message || '問答失敗' }); }
    finally { setQuerying(false); }
  }

  const statusColor: Record<string, 'success' | 'default' | 'warning'> = { active: 'success', disabled: 'default', pending_review: 'warning' };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>AI-09 知識庫（RAG）</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        以規格書／手冊／FAQ 等 wiki／Markdown 文件建立內部知識庫，輔助回覆與內部查詢（答錯有後果，故答案一律附來源）。
      </Typography>

      {msg && <Alert severity={msg.kind === 'ok' ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {!kbEnabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          AI-09 知識庫功能尚未啟用。請於「系統參數 → AI 參數」開啟「AI-09 知識庫檢索開關」後，重新整理本頁。
        </Alert>
      )}

      {kbEnabled && (
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        {canManage && <Tab value="docs" label="知識文件管理" />}
        {canRead && <Tab value="query" label="檢索 / 問答" />}
      </Tabs>
      )}

      {kbEnabled && tab === 'docs' && canManage && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
          <Paper sx={{ p: 2, flex: 1, width: '100%' }}>
            <Typography variant="subtitle1" gutterBottom>知識文件清單</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>標題</TableCell><TableCell>來源</TableCell><TableCell>版本</TableCell>
                  <TableCell>狀態</TableCell><TableCell>塊數</TableCell><TableCell>擁有者</TableCell><TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.docId}>
                    <TableCell>{d.title}</TableCell>
                    <TableCell>{d.source}</TableCell>
                    <TableCell>{d.version}</TableCell>
                    <TableCell><Chip size="small" label={d.status} color={statusColor[d.status]} /></TableCell>
                    <TableCell>{d.chunkCount}</TableCell>
                    <TableCell>{d.owner || '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {d.status !== 'active' && <Button size="small" onClick={() => setStatus(d, 'active')}>啟用</Button>}
                        {d.status === 'active' && <Button size="small" color="warning" onClick={() => setStatus(d, 'disabled')}>停用</Button>}
                        <Button size="small" color="error" onClick={() => del(d)}>刪除</Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {!docs.length && <TableRow><TableCell colSpan={7}>尚無知識文件</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Paper>

          <Paper sx={{ p: 2, flex: 1, width: '100%' }}>
            <Typography variant="subtitle1" gutterBottom>入庫新文件（wiki／Markdown）</Typography>
            <Stack spacing={1.5}>
              <TextField label="標題" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <TextField label="來源（wiki 路徑／檔名／URL）" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              <Stack direction="row" spacing={1}>
                <TextField label="版本" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} sx={{ width: 120 }} />
                <TextField label="擁有者" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} sx={{ flex: 1 }} />
                <TextField select label="狀態" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} sx={{ width: 160 }}
                  SelectProps={{ native: true }}>
                  <option value="active">active（啟用）</option>
                  <option value="pending_review">pending_review（待審）</option>
                </TextField>
              </Stack>
              <TextField label="Markdown 內容" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                multiline minRows={10} placeholder={'# 章節一\n\n## 小節\n內容…\n\n# 章節二\n…'} />
              <Button variant="contained" onClick={submitIngest} disabled={submitting || !form.title || !form.content}>
                {submitting ? '入庫中…' : '入庫'}
              </Button>
            </Stack>
          </Paper>
        </Stack>
      )}

      {kbEnabled && tab === 'query' && canRead && (
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ mb: 2 }}>
            <TextField label="問題" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} />
            <TextField label="top-k" type="number" value={topK} onChange={(e) => setTopK(Number(e.target.value))} sx={{ width: 100 }} />
            <Button variant="outlined" onClick={doSearch} disabled={querying}>檢索</Button>
            <Button variant="contained" onClick={doAsk} disabled={querying}>問答</Button>
          </Stack>

          {answer && (
            <Box sx={{ mb: 2 }}>
              <Alert severity={answer.fallback ? 'info' : 'success'} sx={{ mb: 1 }}>
                {answer.fallback ? '未啟用 LLM 生成，以下為檢索片段（請人工核對後引用）' : `已生成附引用答案（模型 ${answer.model || '—'}）`}
              </Alert>
              <Paper variant="outlined" sx={{ p: 2, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>
                <Typography variant="body1">{answer.answer}</Typography>
              </Paper>
            </Box>
          )}

          {search && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>檢索結果（{search.results.length} 筆，附章節來源）</Typography>
              <Divider sx={{ mb: 1 }} />
              <Stack spacing={1.5}>
                {search.results.map((r, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Chip size="small" label={`${i + 1}`} color="primary" />
                      <Typography variant="subtitle2" fontWeight={600}>{r.title} › {r.headingPath.join(' › ') || r.heading || '（引言）'}</Typography>
                      <Chip size="small" label={r.source} variant="outlined" />
                      <Typography variant="caption" color="text.secondary">相似度 {r.score}</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{r.snippet}</Typography>
                  </Paper>
                ))}
                {!search.results.length && <Typography variant="body2" color="text.secondary">無相關段落</Typography>}
              </Stack>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
