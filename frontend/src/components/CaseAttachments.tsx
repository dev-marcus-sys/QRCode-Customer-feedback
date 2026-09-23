import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, List, ListItem, ListItemIcon, ListItemText, Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { api, ApiRequestError, authStore, downloadCaseAttachmentBlob, AttachmentInsight } from '../api/client';
import { useAiFeatures, featureOn } from '../aiFeatures';

export interface AttachmentMeta {
  attachmentId: number;
  attachmentName: string;
  attachmentSize: number | null;
}

const ALLOWED = ['jpg', 'jpeg', 'png', 'pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** F-004 FR-004-08 附件清單與上傳（jpg/jpeg/png/pdf ≤10MB，伺服器私有儲存）
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

  const handleFile = (file: File | undefined) => {
    setError('');
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setError('僅接受 jpg / jpeg / png / pdf 檔案');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('檔案大小不得超過 10 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '').split(',')[1] || '';
      setBusy(true);
      api
        .uploadAttachment(caseId, file.name, data, token)
        .then((r) => onChanged(`已上傳附件：${r.fileName}`))
        .catch((e) => setError(e instanceof ApiRequestError ? e.message : '上傳失敗，請稍後再試'))
        .finally(() => setBusy(false));
    };
    reader.readAsDataURL(file);
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
          {busy ? '上傳中…' : '上傳附件'}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">暫無附件</Typography>
      ) : (
        <List dense disablePadding>
          {items.map((a) => {
            const ins = insights[a.attachmentId];
            return (
              <ListItem key={a.attachmentId} disableGutters sx={{ py: 0.3, display: 'block' }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <ListItemIcon sx={{ minWidth: 34 }}>
                    <AttachFileIcon fontSize="small" color="primary" />
                  </ListItemIcon>
                  <ListItemText
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
                </Box>

                {/* AI-07 影像理解結果（docs/AI_利用方案.md §4.7） */}
                {showAi && ins && (
                  <Box sx={{ ml: 5.2, mb: 1, p: 1.2, borderRadius: 1.5, bgcolor: '#f3f7fd', border: '1px solid #e3ecf8' }}>
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
    </Box>
  );
}
