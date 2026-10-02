import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, FormControlLabel,
  Paper, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow,
  Tabs, Tab, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import StorageIcon from '@mui/icons-material/Storage';
import { api, ApiRequestError, authStore } from '../../api/client';
import AdminNav from '../../admin/AdminNav';

type TabKey = 'schema' | 'preview';

function renderCell(v: unknown) {
  if (v === null || v === undefined) return <span style={{ color: '#9aa7b4' }}>NULL</span>;
  if (typeof v === 'object') return <span style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(v)}</span>;
  return String(v);
}

function toCsv(columns: string[], rows: Record<string, unknown>[]) {
  const esc = (val: unknown) => {
    if (val === null || val === undefined) return '';
    const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(esc).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n');
  return '﻿' + head + '\n' + body;
}

export function DatabasePage() {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const canAccess = (user?.permissions || []).includes('db:query');

  const [tables, setTables] = useState<{ name: string; type: string; system: boolean }[]>([]);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [loadingTables, setLoadingTables] = useState(true);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<TabKey>('schema');
  const [schema, setSchema] = useState<{ columns: { name: string; type: string; pk: boolean; notnull: boolean }[]; createSql: string } | null>(null);
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[]; limit: number } | null>(null);
  const [previewLimit, setPreviewLimit] = useState(100);
  const [loadingTable, setLoadingTable] = useState(false);

  const [sql, setSql] = useState('SELECT * FROM sys_estate LIMIT 100;');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ kind: 'read' | 'write'; columns?: string[]; rows?: Record<string, unknown>[]; rowCount?: number; truncated?: boolean; changes?: number; lastInsertRowid?: number } | null>(null);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const loadTables = useCallback(() => {
    setLoadingTables(true);
    api.listDbTables(includeSystem, token).then((r) => setTables(r.tables)).catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入資料表失敗')).finally(() => setLoadingTables(false));
  }, [includeSystem, token]);

  useEffect(() => { if (canAccess) loadTables(); else setLoadingTables(false); }, [canAccess, loadTables]);

  const selectTable = useCallback((name: string) => {
    setSelected(name);
    setTab('schema');
    setLoadingTable(true);
    setSchema(null);
    setPreview(null);
    Promise.all([
      api.dbTableSchema(name, token),
      api.dbTablePreview(name, previewLimit, token),
    ]).then(([s, p]) => { setSchema(s as any); setPreview(p as any); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入資料表內容失敗'))
      .finally(() => setLoadingTable(false));
  }, [token, previewLimit]);

  const runSqlNow = useCallback(() => {
    if (!sql.trim()) { setError('請輸入 SQL 語句'); return; }
    setRunning(true);
    setError('');
    api.runDbSql(sql, token).then((r) => { setResult(r); if (r.kind === 'write') setSnack(`執行成功：影響 ${r.changes} 筆`); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : 'SQL 執行失敗'))
      .finally(() => setRunning(false));
  }, [sql, token]);

  const exportCsv = useCallback(() => {
    if (!result || result.kind !== 'read' || !result.columns || !result.rows) { setError('尚無可匯出的查詢結果'); return; }
    const csv = toCsv(result.columns, result.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `db_query_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const previewColumns = useMemo(() => preview?.columns || [], [preview]);

  if (!canAccess) {
    return (
      <Box sx={{ p: 3 }}>
        <AdminNav current="database" />
        <Alert severity="warning" sx={{ mt: 2 }}>當前帳號沒有 db:query 權限，無法使用資料庫控制台（僅 ADMIN 可存取）。</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <AdminNav current="database" />
      <Typography variant="h6" sx={{ fontWeight: 700, mt: 2 }}>資料庫控制台</Typography>
      <Typography variant="caption" color="text.secondary">
        僅允許 SELECT / WITH / INSERT / UPDATE / DELETE / REPLACE / EXPLAIN；結構變更（DDL）與多語句皆被拒絕。寫入型 SQL 會記錄至審計日誌。
      </Typography>

      {error && <Alert severity="error" sx={{ mt: 1, mb: 1 }} onClose={() => setError('')}>{error}</Alert>}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }} alignItems="stretch">
        {/* 左側：資料表清單 */}
        <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', width: { md: 280 }, flexShrink: 0 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <StorageIcon fontSize="small" color="primary" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>資料表</Typography>
            </Stack>
            <FormControlLabel
              control={<Switch size="small" checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)} />}
              label={<Typography variant="caption">顯示系統表</Typography>}
            />
            <Divider sx={{ my: 1 }} />
            {loadingTables ? (
              <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}><CircularProgress size={24} /></Box>
            ) : (
              <Stack spacing={0.5} sx={{ maxHeight: 520, overflow: 'auto' }}>
                {tables.map((t) => (
                  <Button
                    key={t.name}
                    size="small"
                    onClick={() => selectTable(t.name)}
                    sx={{
                      justifyContent: 'flex-start', textTransform: 'none',
                      color: selected === t.name ? '#fff' : 'text.primary',
                      bgcolor: selected === t.name ? 'primary.main' : 'transparent',
                      '&:hover': { bgcolor: selected === t.name ? 'primary.dark' : '#f0f4fa' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{t.name}</span>
                      <Chip size="small" label={t.type} sx={{ height: 18, fontSize: 10, ml: 'auto' }} />
                    </Box>
                  </Button>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        {/* 右側：結構 / 預覽 + SQL 編輯器 */}
        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
          <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2' }}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)}>
                  <Tab label="結構" value="schema" />
                  <Tab label="預覽" value="preview" />
                </Tabs>
                {tab === 'preview' && (
                  <ToggleButtonGroup size="small" exclusive value={previewLimit}
                    onChange={(_, v: number | null) => { if (v) setPreviewLimit(v); }}>
                    <ToggleButton value={100}>100</ToggleButton>
                    <ToggleButton value={500}>500</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Stack>
              {loadingTable ? (
                <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={24} /></Box>
              ) : !selected ? (
                <Typography variant="body2" color="text.secondary">選取左側資料表以檢視結構與內容。</Typography>
              ) : tab === 'schema' ? (
                <>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>欄位</TableCell><TableCell>型別</TableCell>
                        <TableCell>主鍵</TableCell><TableCell>非空</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {schema?.columns.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{c.name}</TableCell>
                          <TableCell>{c.type}</TableCell>
                          <TableCell>{c.pk ? '是' : '—'}</TableCell>
                          <TableCell>{c.notnull ? '是' : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>建表語句</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, bgcolor: '#0f172a', color: '#cbd5e1', overflowX: 'auto' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{schema?.createSql}</Typography>
                  </Paper>
                </>
              ) : (
                <Box sx={{ overflowX: 'auto', maxHeight: 420 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {previewColumns.map((c) => <TableCell key={c} sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{c}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview?.rows.map((r, i) => (
                        <TableRow key={i}>
                          {previewColumns.map((c) => <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{renderCell(r[c])}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview && preview.rows.length >= preview.limit && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>僅顯示前 {preview.limit} 筆。</Typography>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>

          <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2' }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>SQL 執行</Typography>
              <TextField
                fullWidth multiline minRows={5} maxRows={14}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder="SELECT * FROM sys_estate LIMIT 100;"
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Button startIcon={<PlayArrowIcon />} variant="contained" disabled={running} onClick={runSqlNow}>
                  {running ? '執行中…' : '執行'}
                </Button>
                <Button startIcon={<FileDownloadIcon />} variant="outlined" disabled={!result || result.kind !== 'read'} onClick={exportCsv}>
                  匯出 CSV
                </Button>
              </Stack>

              {result && (
                <Box sx={{ mt: 2 }}>
                  {result.kind === 'write' ? (
                    <Alert severity="success">寫入成功：影響 {result.changes} 筆（lastInsertRowid={result.lastInsertRowid}）。已記錄至審計日誌。</Alert>
                  ) : (
                    <Box sx={{ overflowX: 'auto', maxHeight: 460 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            {result.columns?.map((c) => <TableCell key={c} sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{c}</TableCell>)}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {result.rows?.map((r, i) => (
                            <TableRow key={i}>
                              {result.columns?.map((c) => <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{renderCell(r[c])}</TableCell>)}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        共 {result.rowCount} 筆{result.truncated ? '（已截斷至上限）' : ''}。
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Stack>

      <Snackbar open={!!snack} autoHideDuration={2500} onClose={() => setSnack('')} message={snack} />
    </Box>
  );
}
