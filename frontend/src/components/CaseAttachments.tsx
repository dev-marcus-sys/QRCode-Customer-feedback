import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, List, ListItem, ListItemText, Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import {
  api, ApiRequestError, authStore, downloadCaseAttachmentBlob, fetchCaseAttachmentBlobUrl, AttachmentInsight,
} from '../api/client';
import { useAiFeatures, featureOn } from '../aiFeatures';

export interface AttachmentMeta {
  attachmentId: number;
  attachmentName: string;
  attachmentSize: number | null;
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png'];
const ALLOWED = IMAGE_EXT;
const MAX_BYTES = 10 * 1024 * 1024;

function isImage(name: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return IMAGE_EXT.includes(ext);
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 附件縮圖：以私有 blob 載入圖片，點擊觸發預覽。 */
function AttachmentThumb({ caseId, attachmentId, token, onClick }: {
  caseId: string;
  attachmentId: number;
  token: string;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let created: string | null = null;
    fetchCaseAttachmentBlobUrl(caseId, attachmentId, token)
      .then((u) => { if (active) { setUrl(u); created = u; } })
      .catch(() => undefined);
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [caseId, attachmentId, token]);

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      sx={{
        width: 44, height: 44, borderRadius: 1, overflow: 'hidden', flexShrink: 0,
        cursor: 'pointer', bgcolor: '#eef1f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <AttachFileIcon fontSize="small" color="primary" />
      )}
    </Box>
  );
}

/** F-004 FR-004-08 附件清單與上傳（僅 jpg/jpeg/png 圖片 ≤10MB，可多選，點圖預覽）
 *  AI-07 附件影像理解（§4.7）：每附件顯示影像類別／OCR／描述，並可由 case:update 觸發分析。 */
export function CaseAttachments({ caseId, items, canManage, canAnalyze = false, onChanged }: {
  caseId: string;
  items: AttachmentMeta[];
  canManage: boolean;
  canAnalyze?: boolean;
  onChanged: (msg: string) => void;
}) {
  const token = authStore.getToken() || '';
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* AI-07 影像理解結果（attachmentId → 最新一筆） */
  const [insights, setInsights] = useState<Record<number, AttachmentInsight>>({});
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  /* 圖片預覽（Dialog） */
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  /* 刪除確認（系統 Dialog） */
  const [confirmTarget, setConfirmTarget] = useState<AttachmentMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { features } = useAiFeatures();
  const showAi = featureOn(features, 'attachment'); // AI-07 附件影像理解

  const loadInsights = useCallback(() => {
    api
      .listAttachmentInsights(caseId, token)
      .then((d) => {
        const map: Record<number, AttachmentInsight> = {};
        for (const it of d.items) map[it.attachmentId] = it;
        setInsights(map);
      })
      .catch(() => setInsights({})); // AI-07 停用或未產生結果時靜默略過
  }, [caseId, token]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  // 預覽 URL 在關閉／元件卸載時釋放，避免記憶體洩漏
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = preview?.url ?? null;
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [preview]);
  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const openPreview = (a: AttachmentMeta) => {
    if (!isImage(a.attachmentName)) return;
    setError('');
    fetchCaseAttachmentBlobUrl(caseId, a.attachmentId, token)
      .then((url) => setPreview({ name: a.attachmentName, url }))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '預覽失敗'));
  };

  const runAnalyze = (attachmentId: number) => {
    setAnalyzing(attachmentId);
    setError('');
    api
      .analyzeAttachment(caseId, attachmentId, token)
      .then((r) => {
        setInsights((prev) => ({ ...prev, [attachmentId]: r }));
        onChanged(r.visionUsed ? `AI 影像分析完成：${r.categoryZh}` : '已分析（規則模式，未使用視覺模型）');
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : 'AI 影像分析失敗'))
      .finally(() => setAnalyzing(null));
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError('');
    const files = Array.from(fileList);
    for (const file of files) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED.includes(ext)) {
        setError('僅接受 jpg / jpeg / png 圖片檔案');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`檔案「${file.name}」超過 10 MB`);
        return;
      }
    }
    setBusy(true);
    Promise.all(
      files.map((file) => new Promise<{ fileName: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const data = String(reader.result || '').split(',')[1] || '';
          api
            .uploadAttachment(caseId, file.name, data, token)
            .then((r) => resolve(r))
            .catch(reject);
        };
        reader.onerror = () => reject(new Error('讀取檔案失敗'));
        reader.readAsDataURL(file);
      })),
    )
      .then((results) => onChanged(`已上傳 ${results.length} 個附件：${results.map((r) => r.fileName).join('、')}`))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '上傳失敗，請稍後再試'))
      .finally(() => {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      });
  };

  const confirmDelete = () => {
    const a = confirmTarget;
    if (!a) return;
    setDeleting(true);
    setError('');
    api
      .deleteAttachment(caseId, a.attachmentId, token)
      .then(() => {
        setConfirmTarget(null);
        onChanged(`已刪除附件：${a.attachmentName}`);
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '刪除失敗'))
      .finally(() => setDeleting(false));
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {canManage && (
        <Button
          size="small"
          variant="contained"
          color="primary"
          disabled={busy}
          startIcon={<CloudUploadIcon />}
          onClick={() => inputRef.current?.click()}
          sx={{ mb: 1 }}
        >
          {busy ? '上傳中…' : '上傳圖片'}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">暫無附件</Typography>
      ) : (
        <List dense disablePadding>
          {items.map((a) => {
            const ins = insights[a.attachmentId];
            const image = isImage(a.attachmentName);
            return (
              <ListItem key={a.attachmentId} disableGutters sx={{ py: 0.3, display: 'block' }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {image ? (
                    <AttachmentThumb caseId={caseId} attachmentId={a.attachmentId} token={token} onClick={() => openPreview(a)} />
                  ) : (
                    <Box
                      sx={{
                        width: 44, height: 44, borderRadius: 1, overflow: 'hidden', flexShrink: 0,
                        bgcolor: '#eef1f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <AttachFileIcon fontSize="small" color="primary" />
                    </Box>
                  )}
                  <ListItemText
                    sx={{ ml: 1 }}
                    primary={a.attachmentName}
                    secondary={fmtSize(a.attachmentSize)}
                    primaryTypographyProps={{ fontSize: 13.5 }}
                  />
                  {canAnalyze && showAi && (
                    <IconButton
                      size="small"
                      title="AI 影像理解（AI-07）"
                      disabled={analyzing === a.attachmentId}
                      onClick={() => runAnalyze(a.attachmentId)}
                    >
                      <AutoFixHighIcon fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton
                    size="small"
                    title="下載"
                    onClick={() => {
                      downloadCaseAttachmentBlob(caseId, a.attachmentId, token, a.attachmentName).catch((e) => {
                        setError(e instanceof ApiRequestError ? e.message : '下載失敗');
                      });
                    }}
                  >
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                  {canManage && (
                    <IconButton
                      size="small"
                      title="刪除"
                      color="error"
                      onClick={() => setConfirmTarget(a)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>

                {/* AI-07 影像理解結果（docs/AI_利用方案.md §4.7） */}
                {showAi && ins && (
                  <Box sx={{ ml: 6, mb: 1, p: 1.2, borderRadius: 1.5, bgcolor: '#f3f7fd', border: '1px solid #e3ecf8' }}>
                    <Typography variant="subtitle2" sx={{ color: '#1a5aa6', fontSize: 13, mb: 0.4 }}>
                      AI 影像理解：{ins.categoryZh}
                      <Chip size="small" sx={{ ml: 1, height: 18, fontSize: 11 }} variant="outlined"
                        color={ins.visionUsed ? 'primary' : 'warning'}
                        label={ins.visionUsed ? `模型 ${ins.model || '—'}` : '未使用視覺模型'} />
                      {ins.confidence != null && ins.visionUsed && (
                        <Chip size="small" sx={{ ml: 0.5, height: 18, fontSize: 11 }} variant="outlined"
                          label={`信心值 ${Math.round(ins.confidence * 100)}%`} />
                      )}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: 13 }}>{ins.description}</Typography>
                    {ins.ocrText ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4, whiteSpace: 'pre-line' }}>
                        OCR：{ins.ocrText}
                      </Typography>
                    ) : null}
                  </Box>
                )}
              </ListItem>
            );
          })}
        </List>
      )}

      <Dialog open={Boolean(preview)} onClose={closePreview} maxWidth="md" fullWidth>
        <DialogContent sx={{ p: 1, position: 'relative' }}>
          <IconButton
            onClick={closePreview}
            sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1, bgcolor: 'rgba(255,255,255,.85)' }}
          >
            <CloseIcon />
          </IconButton>
          {preview && (
            <Box component="img" src={preview.url} alt={preview.name} sx={{ width: '100%', display: 'block', borderRadius: 1 }} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(confirmTarget)}
        onClose={() => { if (!deleting) setConfirmTarget(null); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>刪除附件</DialogTitle>
        <DialogContent>
          <DialogContentText>
            確定刪除附件「{confirmTarget?.attachmentName}」？此動作無法復原。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmTarget(null)} disabled={deleting}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained" disabled={deleting} autoFocus>
            {deleting ? '刪除中…' : '刪除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
