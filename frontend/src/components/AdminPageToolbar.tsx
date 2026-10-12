import type { ReactNode } from 'react';
import { Box, Button, Toolbar, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { TopBarUser } from './TopBarUser';

/**
 * 其他管理頁共用工具列（與個案管理頁一致的雙行結構）：
 * 第一行：logo ＋「個案管理」標題 ＋ 右側用戶資訊；
 * 第二行：「← 個案管理」返回 ＋ 頁面標題（可選頁面動作）。
 */
export function AdminPageToolbar({ title, actions, backTo = '/admin/cases' }: {
  title: string;
  /** 額外頁面動作，顯示於第二行右側 */
  actions?: ReactNode;
  /** 返回目標路徑 */
  backTo?: string;
}) {
  const navigate = useNavigate();
  return (
    <Toolbar
      sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff',
        borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)',
        flexWrap: 'wrap', rowGap: 0.5, py: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', flexBasis: '100%', minWidth: 0, flexWrap: 'wrap' }}>
        <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 34, width: 'auto', mr: 1.5 }} />
        <Typography variant="h6" sx={{ color: '#1a5aa6' }}>個案管理系統</Typography>
        <Box sx={{ flex: 1 }} />
        <TopBarUser />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexBasis: '100%', minWidth: 0, flexWrap: 'wrap' }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backTo)}
          sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          個案管理
        </Button>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1, fontWeight: 600 }}>{title}</Typography>
        <Box sx={{ flex: 1 }} />
        {actions}
      </Box>
    </Toolbar>
  );
}
