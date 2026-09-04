import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormHelperText, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ReplyIcon from '@mui/icons-material/Reply';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { api, ApiRequestError, AssigneesData, authStore } from '../api/client';
import { labelOf, PRIORITY_OPTIONS, RESOLUTION_OPTIONS, REOPEN_OPTIONS, STATUS_OPTIONS } from '../admin/options';

const ACTIONS: Record<string, { label: string; icon: React.ReactNode; perm: string; color?: 'primary' | 'success' | 'warning' | 'error' | 'inherit' }> = {
  assign: { label: '分派', icon: <AssignmentIndIcon />, perm: 'case:assign', color: 'primary' },
  reassign: { label: '轉派', icon: <SwapHorizIcon />, perm: 'case:assign' },
  start: { label: '開始處理', icon: <PlayArrowIcon />, perm: 'case:update', color: 'success' },
  waiting: { label: '等候客戶回覆', icon: <HourglassEmptyIcon />, perm: 'case:update', color: 'warning' },
  reply: { label: '恢復處理', icon: <ReplyIcon />, perm: 'case:update', color: 'success' },
  resolveRequest: { label: '申請完結', icon: <TaskAltIcon />, perm: 'case:resolve', color: 'primary' },
  approve: { label: '審核通過並關閉', icon: <CheckCircleIcon />, perm: 'case:review', color: 'success' },
  reject: { label: '駁回完結申請', icon: <CancelIcon />, perm: 'case:review', color: 'error' },
  reopen: { label: '重開個案', icon: <LockOpenIcon />, perm: 'case:reopen', color: 'warning' },
};

const ACTIONABLE = ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'REOPENED'];

interface Props {
  caseId: string;
  caseStatus: string;
  actions: { action: string; toStatus: string }[];
  permissions: string[];
  onDone: (msg: string) => void;
}

export function ActionArea({ caseId, caseStatus, actions, permissions, onDone }: Props) {
  const token = authStore.getToken() || '';
  const [dialog, setDialog] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [assignees, setAssignees] = useState<AssigneesData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const has = (p: string) => permissions.includes(p);
  const actionList = actions.filter((a) => has(ACTIONS[a.action]?.perm || '__none__'));
  const canNote = ACTIONABLE.includes(caseStatus) && has('case:update');
  const showPriority = ACTIONABLE.includes(caseStatus) && has('case:update');

  useEffect(() => {
    if (dialog !== 'assign' && dialog !== 'reassign') return;
    setError('');
    setAssignees(null);
    api
      .getAssignees(caseId, token)
      .then((d) => {
        setAssignees(d);
        setForm((f) => ({ ...f, assigneeId: f.assigneeId || String(d.suggestedUserId ?? d.assignableUsers[0]?.userId ?? '') }));
      })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入分派對象失敗'));
  }, [dialog, caseId, token]);

  const openAction = (action: string) => {
    setForm({});
    setError('');
    setDialog(action);
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const act = dialog as string;
      const result = await (async () => {
        if (act === 'assign') {
          if (!form.assigneeId) throw new ApiRequestError(1002, '請選擇處理人員');
          return api.assignCase(caseId, { assigneeId: Number(form.assigneeId), priority: form.priority || undefined, note: form.note || undefined }, token);
        }
        if (act === 'reassign') {
          if (!form.assigneeId) throw new ApiRequestError(1002, '請選擇新的處理人員');
          if (!form.reason?.trim()) throw new ApiRequestError(1002, '請填寫轉派原因');
          return api.reassignCase(caseId, { assigneeId: Number(form.assigneeId), reason: form.reason, note: form.note || undefined }, token);
        }
        if (act === 'start') return api.startCase(caseId, { note: form.note || undefined }, token);
        if (act === 'waiting') return api.waitingCase(caseId, { note: form.note || undefined }, token);
        if (act === 'reply') return api.resumeCase(caseId, { note: form.note || undefined }, token);
        if (act === 'resolveRequest') {
          if (!form.result) throw new ApiRequestError(1002, '請選擇完結結果');
          if (!form.summary?.trim()) throw new ApiRequestError(1002, '請填寫處理內容摘要');
          if (form.result === 'UNRESOLVED' && !form.reason?.trim()) throw new ApiRequestError(1002, '「無法解決」必須填寫原因');
          return api.resolveRequest(
            caseId,
            { result: form.result, summary: form.summary, reason: form.result === 'UNRESOLVED' ? form.reason : undefined, customerReply: form.customerReply || undefined, completionDate: form.completionDate || undefined },
            token
          );
        }
        if (act === 'approve') return api.approveCase(caseId, { note: form.note || undefined }, token);
        if (act === 'reject') {
          if (!form.reason?.trim()) throw new ApiRequestError(1002, '請填寫駁回原因');
          return api.rejectCase(caseId, form.reason, token);
        }
        if (act === 'reopen') {
          if (!form.reason?.trim()) throw new ApiRequestError(1002, '請填寫重開原因');
          return api.reopenCase(caseId, { reason: form.reason, reopenType: form.reopenType || 'SECOND_COMPLAINT' }, token);
        }
        if (act === 'note') {
          if (!form.content?.trim()) throw new ApiRequestError(1002, '請填寫跟進內容');
          return api.addNote(caseId, form.content, token);
        }
        throw new ApiRequestError(1002, '未知操作');
      })();
      setDialog(null);
      onDone(`${ACTIONS[dialog as string]?.label || '操作'}完成（狀態：${result.caseStatus}）`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '操作失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  const dialogTitle = (act: string) => ACTIONS[act]?.label || '操作';
  const needsAssignee = dialog === 'assign' || dialog === 'reassign';
  const showReason = dialog === 'reassign' || dialog === 'resolveRequest' || dialog === 'reject' || dialog === 'reopen';

  return (
    <Box>
      {actionList.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {actionList.map((a) => {
            const meta = ACTIONS[a.action];
            return (
              <Button
                key={a.action}
                size="small"
                variant="outlined"
                color={meta?.color || 'primary'}
                startIcon={meta?.icon}
                onClick={() => openAction(a.action)}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {meta?.label || a.action}
                <Box component="span" sx={{ ml: 0.6, opacity: 0.65, fontSize: 11 }}>
                  → {labelOf(STATUS_OPTIONS, a.toStatus, 'zh-Hant')}
                </Box>
              </Button>
            );
          })}
        </Stack>
      )}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {canNote && (
          <Button size="small" startIcon={<NoteAddIcon />} variant="outlined" color="inherit" onClick={() => openAction('note')}>
            跟進紀錄
          </Button>
        )}
        {showPriority && (
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={form.priority || ''}
              onChange={(e) => {
                setForm((f) => ({ ...f, priority: e.target.value }));
                api.changePriority(caseId, e.target.value, token)
                  .then(() => onDone(`優先級已調整為 ${labelOf(PRIORITY_OPTIONS, e.target.value, 'zh-Hant')}`))
                  .catch((err) => setError(err instanceof ApiRequestError ? err.message : '調整失敗'));
              }}
              displayEmpty
              renderValue={() => (form.priority ? labelOf(PRIORITY_OPTIONS, form.priority, 'zh-Hant') : '優先級')}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Stack>

      <Dialog open={Boolean(dialog)} onClose={() => !busy && setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialogTitle(dialog || '')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mt: 1, mb: 1 }}>{error}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            {needsAssignee && (
              <FormControl size="small" fullWidth error={Boolean(error && !form.assigneeId)}>
                <InputLabel>處理人員</InputLabel>
                <Select label="處理人員" value={form.assigneeId || ''} onChange={(e) => set('assigneeId', e.target.value)}>
                  {(assignees?.assignableUsers || []).map((u) => (
                    <MenuItem key={u.userId} value={String(u.userId)}>
                      {u.fullName}
                      {u.userId === assignees?.suggestedUserId ? '（建議）' : ''}
                      {assignees && assignees.estateCode ? ` · ${assignees.estateCode}` : ''}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>候選人為該屋苑可處理人員；如列表空白請先聯絡管理員。</FormHelperText>
              </FormControl>
            )}
            {dialog === 'assign' && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel>優先級（選填）</InputLabel>
                  <Select label="優先級（選填）" value={form.priority || ''} onChange={(e) => set('priority', e.target.value)}>
                    {PRIORITY_OPTIONS.map((o) => (
                      <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField size="small" label="分派說明（選填）" fullWidth multiline minRows={2} value={form.note || ''} onChange={(e) => set('note', e.target.value)} />
              </>
            )}
            {showReason && (
              <TextField
                size="small"
                label={dialog === 'resolveRequest' ? '無法解決原因（必填）' : dialog === 'reject' ? '駁回原因（必填）' : dialog === 'reopen' ? '重開原因（必填）' : '轉派原因（必填）'}
                fullWidth multiline minRows={2}
                value={form.reason || ''}
                onChange={(e) => set('reason', e.target.value)}
                required
              />
            )}
            {dialog === 'reassign' && (
              <TextField size="small" label="補充說明（選填）" fullWidth multiline minRows={2} value={form.note || ''} onChange={(e) => set('note', e.target.value)} />
            )}
            {(dialog === 'start' || dialog === 'waiting' || dialog === 'reply') && (
              <TextField size="small" label={dialog === 'waiting' ? '等候客戶回覆原因（選填）' : '備註（選填）'} fullWidth multiline minRows={2} value={form.note || ''} onChange={(e) => set('note', e.target.value)} />
            )}
            {dialog === 'note' && (
              <TextField size="small" label="跟進內容（必填）" fullWidth multiline minRows={3} value={form.content || ''} onChange={(e) => set('content', e.target.value)} required autoFocus />
            )}
            {dialog === 'resolveRequest' && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel>完結結果</InputLabel>
                  <Select label="完結結果" value={form.result || ''} onChange={(e) => set('result', e.target.value)}>
                    {RESOLUTION_OPTIONS.map((o) => (
                      <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField size="small" label="處理內容摘要（必填）" fullWidth multiline minRows={3} value={form.summary || ''} onChange={(e) => set('summary', e.target.value)} />
                {form.result === 'UNRESOLVED' && (
                  <TextField size="small" label="無法解決原因（必填）" fullWidth multiline minRows={2} value={form.reason || ''} onChange={(e) => set('reason', e.target.value)} required />
                )}
                <TextField size="small" label="客戶回覆情況（選填）" fullWidth multiline minRows={2} value={form.customerReply || ''} onChange={(e) => set('customerReply', e.target.value)} />
                <TextField size="small" type="date" label="處理完成日期（選填）" fullWidth value={form.completionDate || ''} onChange={(e) => set('completionDate', e.target.value)} InputLabelProps={{ shrink: true }} />
              </>
            )}
            {dialog === 'approve' && (
              <>
                <Typography variant="body2" color="text.secondary">審核通過後個案將關閉，並自動寄送感謝電郵（如客戶同意調查會一併寄出匿名滿意度問卷）。</Typography>
                <TextField size="small" label="審核意見（選填）" fullWidth multiline minRows={2} value={form.note || ''} onChange={(e) => set('note', e.target.value)} />
              </>
            )}
            {dialog === 'reopen' && (
              <FormControl size="small" fullWidth>
                <InputLabel>重開標記</InputLabel>
                <Select label="重開標記" value={form.reopenType || 'SECOND_COMPLAINT'} onChange={(e) => set('reopenType', e.target.value)}>
                  {REOPEN_OPTIONS.map((o) => (
                    <MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={busy}>取消</Button>
          <Button variant="contained" onClick={submit} disabled={busy}>
            {busy ? '處理中…' : '確認'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
