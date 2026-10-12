import { useState, MouseEvent } from 'react';
import { Box, Toolbar, Typography, Menu, MenuItem } from '@mui/material';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import InsightsIcon from '@mui/icons-material/Insights';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TuneIcon from '@mui/icons-material/Tune';
import PeopleIcon from '@mui/icons-material/People';
import SecurityIcon from '@mui/icons-material/Security';
import HistoryIcon from '@mui/icons-material/History';
import ApartmentIcon from '@mui/icons-material/Apartment';
import StorageIcon from '@mui/icons-material/Storage';
import { authStore } from '../api/client';
import { TopBarUser } from '../components/TopBarUser';
import { EnvFooter } from '../components/EnvFooter';

type Tab = { to: string; label: string; icon: JSX.Element; perm: string };

const TABS: Tab[] = [
  { to: '/m/dashboard', label: '儀表板', icon: <InsightsIcon />, perm: 'dashboard:view' },
  { to: '/m/cases', label: '個案', icon: <ListAltIcon />, perm: 'case:list' },
  { to: '/m/surveys', label: '問卷', icon: <FactCheckIcon />, perm: 'dashboard:view' },
  { to: '/m/qr', label: 'QR', icon: <QrCode2Icon />, perm: 'qr:view' },
];

// 「更多」溢出選單：管理功能，權限與桌面一致
const MORE_ITEMS: Tab[] = [
  { to: '/m/config', label: '參數', icon: <TuneIcon />, perm: 'config:view' },
  { to: '/m/users', label: '用戶', icon: <PeopleIcon />, perm: 'user:list' },
  { to: '/m/roles', label: '角色', icon: <SecurityIcon />, perm: 'role:list' },
  { to: '/m/audit', label: '審計', icon: <HistoryIcon />, perm: 'audit:view' },
  { to: '/m/estates', label: '屋苑', icon: <ApartmentIcon />, perm: 'estate:list' },
  { to: '/m/database', label: '資料庫', icon: <StorageIcon />, perm: 'db:query' },
];

const ALL_ITEMS: Tab[] = [...TABS, ...MORE_ITEMS];
function titleFor(path: string): string {
  const hit = ALL_ITEMS.find((t) => path === t.to || path.startsWith(t.to + '/'));
  return hit ? hit.label : '手機版';
}

/** 手機版外框：頂部標題列 + 內容（Outlet）＋ 固定底部 Tab 導覽，app 化佈局。 */
export function MobileShell() {
  const me = authStore.getUser();
  const perms = me?.permissions || [];
  const nav = useNavigate();
  const location = useLocation();
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null);

  const tabs = TABS.filter((t) => perms.includes(t.perm));
  const moreItems = MORE_ITEMS.filter((m) => perms.includes(m.perm));
  const moreActive = moreItems.some((m) => location.pathname.startsWith(m.to));

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
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#1a5aa6', lineHeight: 1.1 }}>{titleFor(location.pathname)}</Typography>
          <Typography variant="caption" color="text.secondary">手機版</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <TopBarUser compact logoutTo="/m/login" />
      </Toolbar>

      <Box component="main" sx={{ flex: 1, px: { xs: 1.5, sm: 2 }, pt: 1.5, pb: 'calc(104px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </Box>

      <EnvFooter fixed bottomOffset={60} />

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
        {moreItems.length > 0 && (
          <Box
            component="button"
            onClick={(e: MouseEvent<HTMLElement>) => setMoreAnchor(e.currentTarget)}
            sx={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 2, border: 'none', background: 'none',
              cursor: 'pointer', color: moreActive ? '#1a5aa6' : '#8a94a6',
              fontSize: 11, fontWeight: moreActive ? 700 : 500,
            }}
          >
            <MoreVertIcon />
            更多
          </Box>
        )}
      </Box>
      <Menu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)}>
        {moreItems.map((m) => (
          <MenuItem
            key={m.to}
            selected={location.pathname.startsWith(m.to)}
            onClick={() => { setMoreAnchor(null); nav(m.to); }}
          >
            {m.icon}
            <Box component="span" sx={{ ml: 1 }}>{m.label}</Box>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
