import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { api, ApiRequestError, authStore, LoginResult } from '../../api/client';
import { ForceChangePassword } from '../../components/ForceChangePassword';

/** 手機版專用登入頁 /m/login（大字、單欄、觸控友善）。 */
export function MobileLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // FR-010-04：強制改密狀態（保存登入回傳的限定 token 與當前輸入）
  const [force, setForce] = useState<{ username: string; password: string; token: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(username.trim(), password);
      if (res.mustChangePwd) {
        setForce({ username: username.trim(), password, token: res.accessToken });
        return;
      }
      authStore.setToken(res.accessToken);
      authStore.setUser(res.user);
      navigate('/m', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '登入失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handleForceLogin = (res: LoginResult) => {
    setForce(null);
    authStore.setToken(res.accessToken);
    authStore.setUser(res.user);
    navigate('/m', { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#1a5aa6', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Card sx={{ maxWidth: 400, width: '100%', borderRadius: 3 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.5} alignItems="center">
            <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 56, width: 'auto' }} />
            <Box textAlign="center">
              <Typography variant="h6" sx={{ color: '#1a5aa6' }}>個案管理系統</Typography>
              <Typography color="text.secondary" variant="body2">手機版 · QRCode 客戶意見反饋</Typography>
            </Box>
            {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}
            {force ? (
              <Box sx={{ width: '100%' }}>
                <ForceChangePassword
                  username={force.username}
                  currentPassword={force.password}
                  token={force.token}
                  onLogin={handleForceLogin}
                />
              </Box>
            ) : (
              <form onSubmit={submit} style={{ width: '100%' }}>
                <Stack spacing={2}>
                  <TextField label="帳號" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" fullWidth required />
                  <TextField label="密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" fullWidth required />
                  <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth>
                    {loading ? '登入中…' : '登入'}
                  </Button>
                </Stack>
              </form>
            )}
            <Button size="small" color="inherit" onClick={() => navigate('/admin/login')}>
              返回桌面版
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
