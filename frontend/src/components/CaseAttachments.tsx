import { useRef, useState } from 'react';
import {
  Alert, Box, Button, IconButton, List, ListItem, ListItemIcon, ListItemText, Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import { api, ApiRequestError, authStore, downloadCaseAttachmentBlob } from '../api/client';

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

/** F-004 FR-004-08 附件清單與上傳（jpg/jpeg/png/pdf ≤10MB，伺服器私有儲存） */
export function CaseAttachments({ caseId, items, canManage, onChanged }: {
  caseId: string;
  items: AttachmentMeta[];
  canManage: boolean;
  onChanged: (msg: string) => void;
}) {
  const token = authStore.getToken() || '';
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
          {items.map((a) => (
            <ListItem key={a.attachmentId} disableGutters sx={{ py: 0.3 }}>
              <ListItemIcon sx={{ minWidth: 34 }}>
                <AttachFileIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText
                primary={a.attachmentName}
                secondary={fmtSize(a.attachmentSize)}
                primaryTypographyProps={{ fontSize: 13.5 }}
              />
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
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
