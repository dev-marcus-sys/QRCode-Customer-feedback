import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { api, ApiRequestError, authStore } from '../../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(username.trim(), password);
      authStore.setToken(res.accessToken);
      authStore.setUser(res.user);
      navigate('/admin/cases', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '登入失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Card sx={{ maxWidth: 420, width: '100%', borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2} alignItems="center">
            <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 64, width: 'auto' }} />
            <Box textAlign="center">
              <Typography variant="h5">個案管理系統</Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                QRCode 客戶意見反饋 · 後台
              </Typography>
            </Box>
            {error && <Alert severity="error">{error}</Alert>}
            <form onSubmit={submit}>
              <Stack spacing={2}>
                <TextField label="帳號" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" fullWidth required />
                <TextField label="密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" fullWidth required />
                <Button type="submit" variant="contained" size="large" disabled={loading}>
                  {loading ? '登入中…' : '登入'}
                </Button>
              </Stack>
            </form>
            <Alert severity="info" sx={{ fontSize: 12 }}>
              演示帳號：admin / Admin@2026、chng_sup / ChngSup@2026、chng_staff / ChngSt@2026
            </Alert>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
