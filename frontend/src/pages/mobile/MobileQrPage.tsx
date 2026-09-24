import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { api, ApiRequestError, authStore, downloadQrFile, qrImageBlob, QrItem, QrOverviewData } from '../../api/client';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}
function statusMeta(item: QrItem): { label: string; color: string } {
  if (item.expired) return { label: '已過期', color: '#d32f2f' };
  if (item.active === true) return { label: '啟用', color: '#2E7D32' };
  if (item.active === false) return { label: '停用', color: '#9E9E9E' };
  return { label: '未生成', color: '#ED6C02' };
}

function QrThumb({ qrId, token }: { qrId: number; token: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    qrImageBlob(qrId, 'png', 240, token)
      .then((blob) => alive && setUrl(URL.createObjectURL(blob)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [qrId, token]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (!url) {
    return <Box sx={{ width: 120, height: 120, display: 'grid', placeItems: 'center', bgcolor: '#f7f9fc', borderRadius: 2 }}><CircularProgress size={22} /></Box>;
  }
  return <img src={url} alt="QR Code" style={{ width: 120, height: 120, borderRadius: 8, border: '1px solid #e5eaf2' }} />;
}

/** 手機版 QR Code 管理 /m/qr：每苑一卡，含縮圖、連結複製、下載、啟用/停用、重新生成。 */
export function MobileQrPage() {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const canManage = !!user?.permissions?.includes('qr:generate');
  const canView = !!user?.permissions?.includes('qr:view');

  const [overview, setOverview] = useState<QrOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const d = await api.listQrOverview(token);
    setOverview(d);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.listQrOverview(token);
        if (alive) setOverview(d);
      } catch (e) {
        if (alive) setError(e instanceof ApiRequestError ? e.message : '載入失敗');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canView) {
    return <Alert severity="warning">當前帳號沒有 QR Code 管理權限（qr:view）。</Alert>;
  }

  const toMessage = (e: unknown): string => {
    if (e instanceof ApiRequestError) {
      if (e.code === 2001) {
        authStore.clear();
        window.location.assign('/m/login');
      }
      return e.message;
    }
    return '操作失敗，請稍後再試';
  };

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setNotice('連結已複製');
  };

  const regenerate = (item: QrItem) => {
    if (!window.confirm(`重新生成 ${item.estateNameZh} 的 QR Code？\n現行張貼中的貼紙將失效。`)) return;
    run(`gen:${item.estateCode}`, async () => { await api.generateQr(item.estateCode, token); await refresh(); },
      `${item.estateNameZh} 的 QR Code 已重新生成`);
  };

  const setActive = (item: QrItem, active: boolean) => {
    if (item.qrId == null) return;
    const msg = active
      ? `啟用 ${item.estateNameZh} 的 QR Code？其他 QR Code 將自動停用。`
      : `停用 ${item.estateNameZh} 的 QR Code？住戶掃描現行貼紙將無法進入表單。`;
    if (!window.confirm(msg)) return;
    run(`st:${item.qrId}`, async () => { await api.setQrStatus(item.qrId as number, active, token); await refresh(); },
      active ? `${item.estateNameZh} 的 QR Code 已啟用` : `${item.estateNameZh} 的 QR Code 已停用`);
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {loading && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>載入中…</Typography>}

      {!loading && overview && (
        <Stack spacing={1.5}>
          {overview.items.map((item) => {
            const meta = statusMeta(item);
            const activeBusy = busy === `st:${item.qrId}`;
            const genBusy = busy === `gen:${item.estateCode}`;
            return (
              <Card key={item.estateCode} elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    {item.qrId != null
                      ? <QrThumb qrId={item.qrId} token={token} />
                      : <Box sx={{ width: 120, height: 120, display: 'grid', placeItems: 'center', bgcolor: '#f7f9fc', borderRadius: 2, color: 'text.secondary', fontSize: 12, textAlign: 'center', px: 1 }}>尚未生成</Box>}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={700}>{item.estateNameZh}</Typography>
                      <Typography variant="caption" color="text.secondary">{item.estateCode}</Typography>
                      <Chip size="small" label={meta.label} sx={{ mt: 0.5, display: 'block', width: 'fit-content', color: meta.color, border: `1px solid ${meta.color}`, bgcolor: 'transparent' }} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        生成 {fmtDate(item.generatedAt)}　{item.validUntil ? `有效期至 ${item.validUntil.slice(0, 10)}` : '永久有效'}
                      </Typography>
                    </Box>
                  </Box>

                  {item.qrContent && (
                    <Box sx={{ mt: 1, display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', flex: 1, minWidth: 0, lineHeight: 1.5 }}>{item.qrContent}</Typography>
                      <IconButton size="small" onClick={() => copyLink(item.qrContent as string)} sx={{ flexShrink: 0, mt: -0.5 }}><ContentCopyIcon fontSize="small" /></IconButton>
                    </Box>
                  )}

                  <Stack direction="row" spacing={1} sx={{ mt: 1.2 }} flexWrap="wrap" useFlexGap>
                    {item.qrId != null && (
                      <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadQrFile(item.qrId as number, 'png', token, `QR_${item.estateCode}.png`).catch((e) => setError(toMessage(e)))}>
                        下載
                      </Button>
                    )}
                    {canManage && item.qrId == null && (
                      <Button size="small" variant="contained" disabled={genBusy} onClick={() => regenerate(item)}>生成</Button>
                    )}
                    {canManage && item.qrId != null && (
                      <Button size="small" variant="outlined" startIcon={<RestartAltIcon />} disabled={genBusy} onClick={() => regenerate(item)}>重新生成</Button>
                    )}
                    {canManage && item.qrId != null && (
                      <Button
                        size="small" color={item.active ? 'warning' : 'success'} variant="outlined"
                        disabled={activeBusy}
                        onClick={() => setActive(item, !item.active)}
                      >
                        {item.active ? '停用' : '啟用'}
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
