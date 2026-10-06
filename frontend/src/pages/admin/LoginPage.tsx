import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import { api, ApiRequestError, authStore, LoginResult } from '../../api/client';
import { ForceChangePassword } from '../../components/ForceChangePassword';
import { PasswordField } from '../../components/PasswordField';

export function LoginPage() {
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
      navigate('/admin/cases', { replace: true });
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
    navigate('/admin/cases', { replace: true });
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
            {force ? (
              <ForceChangePassword
                username={force.username}
                currentPassword={force.password}
                token={force.token}
                onLogin={handleForceLogin}
              />
            ) : (
              <form onSubmit={submit}>
                <Stack spacing={2}>
                  <TextField label="帳號" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" fullWidth required />
                  <PasswordField label="密碼" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" fullWidth required />
                  <Button type="submit" variant="contained" size="large" disabled={loading}>
                    {loading ? '登入中…' : '登入'}
                  </Button>
                </Stack>
              </form>
            )}
            <Button
              fullWidth size="small" color="primary" startIcon={<SmartphoneIcon />}
              onClick={() => navigate('/m')}
              sx={{ textTransform: 'none' }}
            >
              開啟手機版（現場／外勤使用）
            </Button>
            <Alert severity="info" sx={{ fontSize: 12 }}>
              演示帳號：admin / Admin@2026、chng_sup / ChngSup@2026、chng_staff / ChngSt@2026
            </Alert>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
