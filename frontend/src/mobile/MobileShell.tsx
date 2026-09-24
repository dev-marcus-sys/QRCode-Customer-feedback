import { Box, Toolbar, Typography } from '@mui/material';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import InsightsIcon from '@mui/icons-material/Insights';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { authStore } from '../api/client';
import { TopBarUser } from '../components/TopBarUser';

type Tab = { to: string; label: string; icon: JSX.Element; perm: string };

const TABS: Tab[] = [
  { to: '/m/dashboard', label: '儀表板', icon: <InsightsIcon />, perm: 'dashboard:view' },
  { to: '/m/cases', label: '個案', icon: <ListAltIcon />, perm: 'case:list' },
  { to: '/m/surveys', label: '問卷', icon: <FactCheckIcon />, perm: 'dashboard:view' },
  { to: '/m/qr', label: 'QR', icon: <QrCode2Icon />, perm: 'qr:view' },
];

/** 手機版外框：頂部標題列 + 內容（Outlet）＋ 固定底部 Tab 導覽，app 化佈局。 */
export function MobileShell() {
  const navigate = useNavigate();
  const me = authStore.getUser();
  const perms = me?.permissions || [];
  const tabs = TABS.filter((t) => perms.includes(t.perm));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        sx={{
          position: 'sticky', top: 0, zIndex: 20, bgcolor: '#fff',
          borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)',
        }}
      >
        <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 30, width: 'auto' }} />
        <Box sx={{ ml: 1 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#1a5aa6', lineHeight: 1.1 }}>個案管理</Typography>
          <Typography variant="caption" color="text.secondary">手機版</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <TopBarUser compact logoutTo="/m/login" />
      </Toolbar>

      <Box component="main" sx={{ flex: 1, px: { xs: 1.5, sm: 2 }, pt: 1.5, pb: 9 }}>
        <Outlet />
      </Box>

      <Box
        component="nav"
        sx={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
          bgcolor: '#fff', borderTop: '1px solid #e5eaf2',
          display: 'flex', height: 60,
          pb: 'env(safe-area-inset-bottom)',
        }}
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              textDecoration: 'none',
              color: isActive ? '#1a5aa6' : '#8a94a6',
              fontSize: 11,
              fontWeight: isActive ? 700 : 500,
            })}
          >
            {t.icon}
            {t.label}
          </NavLink>
        ))}
      </Box>
    </Box>
  );
}
