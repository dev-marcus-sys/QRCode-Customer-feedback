import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, IconButton, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DownloadIcon from '@mui/icons-material/Download';
import LogoutIcon from '@mui/icons-material/Logout';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import {
  api, ApiRequestError, authStore, downloadQrFile, qrImageBlob, QrItem, QrOverviewData,
} from '../../api/client';

type Notice = { severity: 'success' | 'error'; text: string };
type ConfirmKind = 'deactivate' | 'reactivate' | 'regenerate';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function isDeadContent(content: string | null): boolean {
  return !!content && /localhost|127\.0\.0\.1|\[::1\]/.test(content);
}

function statusMeta(item: QrItem): { label: string; color: string } {
  if (item.active === true) return { label: '啟用', color: '#2E7D32' };
  if (item.active === false) {
    if (isDeadContent(item.qrContent)) return { label: '過期（舊連結）', color: '#ED6C02' };
    return { label: '停用', color: '#9E9E9E' };
  }
  return { label: '未生成', color: '#ED6C02' };
}

/** QR 縮圖：帶 token 以 blob 載入並自動釋放 object URL */
function QrThumb({ qrId, token }: { qrId: number; token: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    qrImageBlob(qrId, 'png', 220, token)
      .then((blob) => {
        if (alive) setUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [qrId, token]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (!url) {
    return (
      <Box sx={{ width: 88, height: 88, display: 'grid', placeItems: 'center', bgcolor: '#f7f9fc', borderRadius: 1.5 }}>
        <CircularProgress size={18} />
      </Box>
    );
  }
  return <img src={url} alt="QR Code" style={{ width: 88, height: 88, borderRadius: 6, border: '1px solid #e5eaf2' }} />;
}

export function QrCodePage() {
  const navigate = useNavigate();
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const canManage = !!user?.permissions?.includes('qr:generate');
  const canView = !!user?.permissions?.includes('qr:view');

  const [overview, setOverview] = useState<QrOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  const [siteInput, setSiteInput] = useState('');
  const [siteBusy, setSiteBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; item: QrItem } | null>(null);

  const toMessage = (e: unknown): string => {
    if (e instanceof ApiRequestError) {
      if (e.code === 2001 || e.code === 2005) {
        authStore.clear();
        navigate('/admin/login', { replace: true });
      }
      return e.message;
    }
    return '操作失敗，請稍後再試';
  };

  const refresh = async () => {
    const data = await api.listQrOverview(token);
    setOverview(data);
    setSiteInput(data.siteBaseUrl || '');
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.listQrOverview(token);
        if (!alive) return;
        setOverview(data);
        setSiteInput(data.siteBaseUrl || '');
      } catch (e) {
        if (alive) setError(toMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = () => {
    authStore.clear();
    navigate('/admin/login', { replace: true });
  };

  const runAction = async (busyKey: string, fn: () => Promise<void>, successText: string) => {
    setBusy(busyKey);
    setError('');
    setNotice(null);
    try {
      await fn();
      setNotice({ severity: 'success', text: successText });
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const saveSiteUrl = () =>
    runAction('site', async () => {
      await api.saveSiteBaseUrl(siteInput.trim(), token);
      await refresh();
    }, '表單網址設定已儲存');

  const regenerate = (item: QrItem) =>
    runAction(`gen:${item.estateCode}`, async () => {
      await api.generateQr(item.estateCode, token);
      await refresh();
    }, `${item.estateNameZh} 的 QR Code 已重新生成`);

  const setQrActive = (item: QrItem, active: boolean) =>
    runAction(`st:${item.qrId}`, async () => {
      if (item.qrId == null) return;
      await api.setQrStatus(item.qrId, active, token);
      await refresh();
    }, active ? `${item.estateNameZh} 的 QR Code 已啟用` : `${item.estateNameZh} 的 QR Code 已停用`);

  const download = (item: QrItem, format: 'png' | 'svg') => {
    if (item.qrId == null) return;
    downloadQrFile(item.qrId, format, token, `QR_${item.estateCode}.${format}`).catch((e) => {
      setError(toMessage(e));
    });
  };

  const confirmDialogText = (kind: ConfirmKind, item: QrItem): { title: string; body: string; action: string } => {
    const name = item.estateNameZh;
    if (kind === 'regenerate') {
      return {
        title: `重新生成 ${name} 的 QR Code？`,
        body: '系統會停用該屋苑現行的 QR Code（張貼中的貼紙將失效）並建立全新連結。確定繼續？',
        action: '重新生成',
      };
    }
    if (kind === 'deactivate') {
      return {
        title: `停用 ${name} 的 QR Code？`,
        body: '停用後住戶掃描現行貼紙將無法進入表單，直至重新啟用或重新生成。確定繼續？',
        action: '停用',
      };
    }
    return {
      title: `啟用 ${name} 的 QR Code？`,
      body: '啟用後該屋苑其他 QR Code 將被自動停用，此碼恢復為現行可掃描連結。確定繼續？',
      action: '啟用',
    };
  };

  if (!canView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Alert severity="warning">當前帳號沒有 QR Code 管理權限（qr:view）。</Alert>
      </Box>
    );
  }

  const confirmMeta = confirm ? confirmDialogText(confirm.kind, confirm.item) : null;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff',
        borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)',
      }}>
        <Button component={Link} to="/admin/cases" size="small" startIcon={<ArrowBackIcon />}
          sx={{ color: 'text.secondary', mr: 1, whiteSpace: 'nowrap' }}>
          個案管理
        </Button>
        <Typography variant="h6" sx={{ color: '#1a5aa6', fontWeight: 600 }}>QR Code 管理</Typography>
        <Box sx={{ flex: 1 }} />
        {user && (
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>
            {user.fullName}
          </Typography>
        )}
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        {notice && <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice.text}</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* 表單網站網址設定 */}
        <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>表單網站網址設定</Typography>
                <Chip label="僅管理員" size="small" sx={{ bgcolor: '#1a5aa61A', color: '#1a5aa6', fontWeight: 600 }} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                QR Code 掃描後將開啟此網址的「客戶意見反饋」表單並自動帶入屋苑。
                留空時使用目前訪問後台的網址（本機演示預設）。格式須以 http:// 或 https:// 開頭。
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="flex-start">
                <TextField size="small" fullWidth placeholder="https://feedback.example.com"
                  value={siteInput}
                  onChange={(e) => setSiteInput(e.target.value)}
                  disabled={!canManage || siteBusy}
                  helperText={overview ? `目前 QR 指向：${overview.effectiveBaseUrl}` : ' '}
                />
                <Button variant="contained" size="medium" sx={{ whiteSpace: 'nowrap', mt: { xs: 0, md: 2 } }}
                  disabled={!canManage || siteBusy} onClick={saveSiteUrl}>
                  {siteBusy ? <CircularProgress size={16} /> : '儲存設定'}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* 屋苑 QR Code 一覽 */}
        <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', overflow: 'hidden' }}>
          {loading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 200 }}><CircularProgress /></Box>
          ) : (
            <TableContainer>
              <Table size="small" sx={{ minWidth: 960 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                    <TableCell sx={{ fontWeight: 600 }}>屋苑</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>QR Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>掃描連結內容</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>生成日期</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(overview?.items || []).map((item) => {
                    const meta = statusMeta(item);
                    const busyKey = `gen:${item.estateCode}`;
                    const stKey = `st:${item.qrId}`;
                    const rowBusy = busy === busyKey || busy === stKey;
                    return (
                      <TableRow key={item.estateCode} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.estateNameZh}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.estateCode} · {item.estateNameEn}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={meta.label} title={item.qrContent || ''}
                            sx={{ bgcolor: `${meta.color}1A`, color: meta.color, fontWeight: 600, border: `1px solid ${meta.color}66` }} />
                        </TableCell>
                        <TableCell>
                          {item.qrId != null ? (
                            <QrThumb qrId={item.qrId} token={token} />
                          ) : (
                            <Box sx={{ width: 88, height: 88, display: 'grid', placeItems: 'center', bgcolor: '#f7f9fc', borderRadius: 1.5 }}>
                              <QrCode2Icon sx={{ color: '#b9c4d4', fontSize: 34 }} />
                            </Box>
                          )}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 300 }}>
                          {item.qrContent ? (
                            <Typography variant="body2" sx={{ wordBreak: 'break-all' }} title={item.qrContent}>
                              {item.qrContent.length > 46 ? `${item.qrContent.slice(0, 46)}…` : item.qrContent}
                            </Typography>
                          ) : <Typography variant="body2" color="text.secondary">尚未生成</Typography>}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                          {fmtDate(item.generatedAt)}
                        </TableCell>
                        <TableCell>
                          {item.qrId == null ? (
                            canManage ? (
                              <Button size="small" variant="contained" startIcon={<QrCode2Icon />}
                                disabled={busy !== null} onClick={() => setConfirm({ kind: 'regenerate', item })}>
                                生成 QR
                              </Button>
                            ) : <Typography variant="caption" color="text.secondary">需 qr:generate 權限</Typography>
                          ) : (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                              <Button size="small" startIcon={<DownloadIcon />} disabled={busy !== null}
                                onClick={() => download(item, 'png')}>PNG</Button>
                              <Button size="small" startIcon={<DownloadIcon />} disabled={busy !== null}
                                onClick={() => download(item, 'svg')}>SVG</Button>
                              {canManage && (
                                <>
                                  {item.active === false && (
                                    <Button size="small" variant="outlined" disabled={rowBusy || busy !== null}
                                      onClick={() => setConfirm({ kind: 'reactivate', item })}>
                                      啟用
                                    </Button>
                                  )}
                                  {item.active === true && (
                                    <Button size="small" color="inherit" disabled={rowBusy || busy !== null}
                                      onClick={() => setConfirm({ kind: 'deactivate', item })}>
                                      停用
                                    </Button>
                                  )}
                                  <Button size="small" variant="outlined" color="primary" startIcon={<RestartAltIcon />}
                                    disabled={rowBusy || busy !== null} onClick={() => setConfirm({ kind: 'regenerate', item })}>
                                    重新生成
                                  </Button>
                                </>
                              )}
                              {rowBusy && <CircularProgress size={16} sx={{ mt: 0.8 }} />}
                            </Stack>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Box>

      {/* 確認對話框 */}
      <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)} maxWidth="xs" fullWidth>
        {confirm && confirmMeta && (
          <>
            <DialogTitle>{confirmMeta.title}</DialogTitle>
            <DialogContent>
              <DialogContentText>{confirmMeta.body}</DialogContentText>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setConfirm(null)} disabled={busy !== null}>取消</Button>
              <Button variant="contained" color={confirm.kind === 'deactivate' ? 'error' : 'primary'}
                disabled={busy !== null} onClick={() => {
                  if (confirm.kind === 'regenerate') regenerate(confirm.item);
                  else if (confirm.kind === 'deactivate') setQrActive(confirm.item, false);
                  else setQrActive(confirm.item, true);
                }}>
                {busy !== null ? <CircularProgress size={16} /> : confirmMeta.action}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
