/**
 * 統一頂欄右側區塊：用戶名稱（含屋苑範圍）＋ 通知鈴鐺 ＋ 登出。
 * 後台各頁與手機版頂欄共用，確保所有畫面顯示一致。
 */
import { useNavigate } from 'react-router-dom';
import { IconButton, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { authStore } from '../api/client';
import { useEstates } from '../admin/useEstates';
import { NotificationCenter } from './NotificationCenter';

export function TopBarUser({ compact = false, logoutTo = '/admin/login' }: {
  /** 手機版用小字與小圖示 */
  compact?: boolean;
  /** 登出後導向（手機版傳 /m/login） */
  logoutTo?: string;
}) {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const { nameOf } = useEstates();
  if (!user) return null;

  // 所屬屋苑可多選：未含 ALL 且非空者視為受限範圍；否則顯示「全部屋苑」
  const codes = user.estateCodes || [];
  const scope = codes.length && !codes.includes('ALL')
    ? codes.map((c) => nameOf(c)).join('、')
    : '全部屋苑';

  const logout = () => {
    authStore.clear();
    navigate(logoutTo, { replace: true });
  };

  return (
    <>
      <Typography
        variant={compact ? 'caption' : 'body2'}
        color="text.secondary"
        sx={{ mr: 0.5, whiteSpace: 'nowrap' }}
      >
        {user.fullName} · {scope}
      </Typography>
      <NotificationCenter />
      <IconButton title="登出" onClick={logout} size={compact ? 'small' : 'medium'}>
        <LogoutIcon />
      </IconButton>
    </>
  );
}
