import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Stack, Typography,
} from '@mui/material';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ClearIcon from '@mui/icons-material/Clear';
import { api, ApiRequestError, authStore, AssigneesData } from '../api/client';

interface Props {
  caseIds: string[];
  onCleared: () => void;
  onDone: (msg: string) => void;
}

/** 列表批次分派工具列（F-004 FR-004-10，P1） */
export function BatchActions({ caseIds, onCleared, onDone }: Props) {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const canAssign = !!user?.permissions?.includes('case:assign');
  const canStart = !!user?.permissions?.includes('case:update');
  const [dialog, setDialog] = useState<'assign' | 'start' | null>(null);
  const [data, setData] = useState<AssigneesData | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dialog !== 'assign' || caseIds.length === 0) return;
    setError('');
    setBusy(true);
    api
      .getAssignees(caseIds[0], token)
      .then((d) => {
        setData(d);
        setAssigneeId((cur) => cur || String(d.suggestedUserId ?? d.assignableUsers[0]?.userId ?? ''));
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入分派對象失敗'))
      .finally(() => setBusy(false));
  }, [dialog, caseIds, token]);

  const submitAssign = async () => {
    if (!assigneeId) {
      setError('請選擇處理人員');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await api.batchAssign({ caseIds, assigneeId: Number(assigneeId) }, token);
      const skipped = r.skipped?.length ?? 0;
      onDone(`批次分派完成：成功 ${r.assigned?.length ?? 0} 案${skipped ? `，跳過 ${skipped} 案（狀態/屋苑不符）` : ''}`);
      setDialog(null);
      onCleared();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '批次分派失敗');
    } finally {
      setBusy(false);
    }
  };

  const submitStart = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await api.batchUpdate({ caseIds, action: 'start' }, token);
      const skipped = r.skipped?.length ?? 0;
      onDone(`批次開始處理完成：成功 ${r.done?.length ?? 0} 案${skipped ? `，跳過 ${skipped} 案` : ''}`);
      setDialog(null);
      onCleared();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '批次開始處理失敗');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) setDialog(null);
  };

  return (
    <Box>
      <Alert
        severity="info"
        sx={{ borderRadius: 2, alignItems: 'center' }}
        action={
          <Stack direction="row" spacing={1}>
            {canAssign && (
              <Button size="small" variant="contained" startIcon={<AssignmentIndIcon />} onClick={() => setDialog('assign')}>
                批次分派
              </Button>
            )}
            {canStart && (
              <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => setDialog('start')}>
                批次開始處理
              </Button>
            )}
            <Button size="small" startIcon={<ClearIcon />} onClick={onCleared}>取消選擇</Button>
          </Stack>
        }
        icon={false}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          已選 {caseIds.length} 案
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          {caseIds.slice(0, 3).map((id) => (
            <Chip key={id} label={id} size="small" sx={{ mr: 0.5, mb: 0.3, fontFamily: '"Roboto Mono", monospace', fontSize: 11 }} />
          ))}
          {caseIds.length > 3 && <Chip label={`等 ${caseIds.length} 案`} size="small" variant="outlined" sx={{ fontSize: 11 }} />}
        </Box>
      </Alert>

      <Dialog open={Boolean(dialog)} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog === 'assign' ? '批次分派' : '批次開始處理'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mt: 1, mb: 1 }}>{error}</Alert>}
          {dialog === 'assign' ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                已選 {caseIds.length} 案。候選人取自第一案（{data?.estateCode || '—'}）；僅同屋苑且狀態允許（PENDING/REOPENED）之個案會被分派，其餘自動跳過。
              </Typography>
              <FormControl size="small" fullWidth>
                <InputLabel>處理人員</InputLabel>
                <Select label="處理人員" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  {(data?.assignableUsers || []).map((u) => (
                    <MenuItem key={u.userId} value={String(u.userId)}>
                      {u.fullName}
                      {u.userId === data?.suggestedUserId ? '（建議）' : ''} · {u.roleNames || u.estateCode}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              將為所選個案中狀態為 ASSIGNED / REOPENED 者開始處理（→ IN_PROGRESS），其餘狀態自動跳過。
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} disabled={busy}>取消</Button>
          <Button
            variant="contained"
            disabled={busy || (dialog === 'assign' && !assigneeId)}
            onClick={dialog === 'assign' ? submitAssign : submitStart}
          >
            {busy ? '處理中…' : '確認'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
