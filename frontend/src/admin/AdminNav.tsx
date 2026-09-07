/**
 * F-010 管理後台共用導覽：個案 / QR / 問卷 / 儀表板 / 參數 / 用戶 / 角色 / 審計 / 屋苑。
 * 置於各管理頁頂部，便於在 F-010 與其他模組間切換。
 */
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

const SECTIONS = [
  { key: 'cases', label: '個案', path: '/admin/cases' },
  { key: 'qr', label: 'QR Code', path: '/admin/qr' },
  { key: 'surveys', label: '問卷', path: '/admin/surveys' },
  { key: 'dashboard', label: '儀表板', path: '/admin/dashboard' },
  { key: 'config', label: '參數', path: '/admin/config' },
  { key: 'users', label: '用戶', path: '/admin/users' },
  { key: 'roles', label: '角色', path: '/admin/roles' },
  { key: 'audit', label: '審計', path: '/admin/audit' },
  { key: 'estates', label: '屋苑', path: '/admin/estates' },
];

export default function AdminNav({ current }: { current: string }) {
  const navigate = useNavigate();
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 40, width: 'auto' }} />
        <Box>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>個案管理系統</Typography>
          <Typography variant="caption" color="text.secondary">QRCode 客戶意見反饋 · 後台</Typography>
        </Box>
      </Stack>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={current}
        onChange={(_, v: string | null) => {
          if (v) {
            const s = SECTIONS.find((x) => x.key === v);
            if (s) navigate(s.path);
          }
        }}
        sx={{ flexWrap: 'wrap' }}
      >
        {SECTIONS.map((s) => (
          <ToggleButton key={s.key} value={s.key}>
            {s.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
