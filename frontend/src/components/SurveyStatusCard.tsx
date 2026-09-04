import { useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { api, ApiRequestError, authStore, CaseSurvey } from '../api/client';

function fmtDate(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}

/** F-007 滿意度調查狀態卡（詳情頁） */
export function SurveyStatusCard({ survey, canResend, onMessage }: {
  survey: CaseSurvey | null;
  canResend: boolean;
  onMessage: (msg: string) => void;
}) {
  const token = authStore.getToken() || '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!survey) {
    return (
      <Typography variant="body2" color="text.secondary">未發送滿意度問卷（客戶未同意調查或欠缺電郵）</Typography>
    );
  }

  const statusColor = survey.status === 'SUBMITTED' ? 'success' : survey.status === 'EXPIRED' ? 'error' : 'warning';
  const daysLeft = survey.status === 'SENT' && survey.expiresAt
    ? Math.max(0, Math.ceil((new Date(survey.expiresAt).getTime() - Date.now()) / 86400000))
    : null;

  const resend = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.resendSurvey(survey.surveyId, token);
      onMessage(`問卷已補發（第 ${r.resendCount} 次）`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '補發失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" color={statusColor} label={`狀態：${survey.status}`} />
        {survey.isLowScore && <Chip size="small" color="error" label="低分（≤2）需跟進" />}
        {survey.status === 'SUBMITTED' && survey.average != null && (
          <Chip size="small" variant="outlined" label={`平均 ${survey.average.toFixed(1)} / 5`} />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {survey.submittedAt ? `已於 ${fmtDate(survey.submittedAt)} 提交` : `發出於 ${fmtDate(survey.sentAt)}`}
        {survey.expiresAt && survey.status === 'SENT' && ` ・ 到期 ${fmtDate(survey.expiresAt)}${daysLeft != null ? `（剩餘 ${daysLeft} 天）` : ''}`}
      </Typography>
      {survey.status === 'SENT' && canResend && (
        <Button size="small" sx={{ mt: 1 }} startIcon={<SendIcon />} disabled={busy} onClick={resend}>
          {busy ? '補發中…' : '補發問卷電郵'}
        </Button>
      )}
    </Box>
  );
}
