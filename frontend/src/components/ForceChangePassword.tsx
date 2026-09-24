/**
 * 強制變更密碼畫面（FR-010-04：首登／管理員重設後／密碼過期）。
 * 登入 API 於 mustChangePwd 時回傳 10 分鐘限定 token（僅可用於 change-password），
 * 變更成功後以新密碼重新登入，並透過 onLogin 完成存檔與導向。
 */
import { FormEvent, useState } from 'react';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { api, ApiRequestError, LoginResult } from '../api/client';

/** 與後端 isStrong 對齊：≥8 位，含英文大寫、小寫與數字 */
function isStrong(pw: string) {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
}

export function ForceChangePassword({ username, currentPassword, token, onLogin }: {
  username: string;
  currentPassword: string;
  token: string;
  onLogin: (res: LoginResult) => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isStrong(newPassword)) {
      setError('新密碼須 ≥8 位，且同時包含英文大寫、小寫與數字');
      return;
    }
    if (newPassword !== confirm) {
      setError('兩次輸入的新密碼不一致');
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(currentPassword || undefined, newPassword, token);
      const res = await api.login(username, newPassword);
      onLogin(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '變更失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack spacing={2}>
        <Alert severity="warning">
          首次登入或密碼已被重設／已過期，請先設定新密碼（≥8 位，含英文大小寫與數字）。
        </Alert>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="新密碼" type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password" fullWidth required
        />
        <TextField
          label="確認新密碼" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" fullWidth required
          error={!!confirm && confirm !== newPassword}
          helperText={confirm && confirm !== newPassword ? '兩次輸入不一致' : ''}
        />
        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? '更新中…' : '更新密碼並登入'}
        </Button>
      </Stack>
    </form>
  );
}
