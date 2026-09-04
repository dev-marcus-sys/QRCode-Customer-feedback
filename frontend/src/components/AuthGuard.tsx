import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { api, ApiRequestError, authStore } from '../api/client';

export function AuthGuard({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const token = authStore.getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api
      .me(token)
      .then((user) => {
        authStore.setUser(user);
        setOk(true);
      })
      .catch((e) => {
        if (e instanceof ApiRequestError && e.code === 2001) authStore.clear();
        setOk(false);
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!ok) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
