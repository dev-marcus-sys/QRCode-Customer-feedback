import { useState, useRef, ChangeEvent } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Link, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DescriptionIcon from '@mui/icons-material/Description';
import { ApiRequestError, downloadImportTemplate, importCases, ImportResult } from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string;
  /** 成功建立至少一宗後觸發（用於刷新列表） */
  onImported?: () => void;
}

const MAX_BYTES = 12 * 1024 * 1024;

export function ImportCasesDialog({ open, onClose, token, onImported }: Props) {
  const [fileName, setFileName] = useState('');
  const [base64, setBase64] = useState('');
  const [size, setSize] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError(`檔案過大（上限 12MB），目前 ${(f.size / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    setError('');
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const idx = dataUrl.indexOf(',');
      setBase64(idx >= 0 ? dataUrl.slice(idx + 1) : '');
      setFileName(f.name);
      setSize(f.size);
    };
    reader.readAsDataURL(f);
  };

  const handleImport = async () => {
    if (!base64) {
      setError('請先選擇 Excel 檔案');
      return;
    }
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const r = await importCases(base64, token);
      setResult(r);
      if (r.created > 0 && onImported) onImported();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '匯入失敗');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (importing) return;
    setFileName('');
    setBase64('');
    setSize(0);
    setResult(null);
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>匯入個案（Excel）</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            請先下載
            <Link
              component="button"
              type="button"
              onClick={() => downloadImportTemplate(token)}
              sx={{ mx: 0.5, verticalAlign: 'baseline' }}
            >
              匯入範本
            </Link>
            填寫後上傳。系統會依欄位逐列建案（與手動建案相同：自動編號、SLA、主管通知）。
          </Typography>
          <Box>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={onPick}
              style={{ display: 'none' }}
            />
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>
              選擇 Excel 檔案
            </Button>
            {fileName && (
              <Typography variant="body2" sx={{ mt: 1, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                <DescriptionIcon fontSize="small" /> {fileName}（{(size / 1024).toFixed(0)} KB）
              </Typography>
            )}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {result && (
            <Alert severity={result.failed > 0 ? 'warning' : 'success'}>
              共 {result.total} 列：成功建立 {result.created} 宗，失敗 {result.failed} 列。
            </Alert>
          )}
          {result && result.errors.length > 0 && (
            <Box sx={{ maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 1 }}>
              <List dense>
                {result.errors.map((er, i) => (
                  <ListItem key={i} divider>
                    <ListItemText primary={`第 ${er.row} 列`} secondary={er.error} />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={importing}>
          關閉
        </Button>
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={importing || !base64}
          startIcon={importing ? <CircularProgress size={16} /> : <UploadFileIcon />}
        >
          {importing ? '匯入中…' : '開始匯入'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
