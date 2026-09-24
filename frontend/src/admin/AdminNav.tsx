/**
 * F-010 管理後台共用導覽：個案 / QR / 問卷 / 儀表板 / 參數 / 用戶 / 角色 / 審計 / 屋苑。
 * 置於各管理頁頂部，便於在 F-010 與其他模組間切換。
 */
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAiFeatures, featureOn } from '../aiFeatures';
import { authStore } from '../api/client';

/** 各選單項所需的權限碼（任一符合即顯示；未設定則不受限） */
const SECTIONS: { key: string; label: string; path: string; perms?: string[] }[] = [
  { key: 'cases', label: '個案', path: '/admin/cases', perms: ['case:list'] },
  { key: 'qr', label: 'QR Code', path: '/admin/qr', perms: ['qr:view', 'qr:generate'] },
  { key: 'surveys', label: '問卷', path: '/admin/surveys', perms: ['dashboard:view'] },
  { key: 'dashboard', label: '儀表板', path: '/admin/dashboard', perms: ['dashboard:view'] },
  { key: 'config', label: '參數', path: '/admin/config', perms: ['config:view'] },
  { key: 'users', label: '用戶', path: '/admin/users', perms: ['user:list'] },
  { key: 'roles', label: '角色', path: '/admin/roles', perms: ['role:list'] },
  { key: 'audit', label: '審計', path: '/admin/audit', perms: ['audit:view'] },
  { key: 'estates', label: '屋苑', path: '/admin/estates', perms: ['estate:list'] },
  { key: 'kb', label: '知識庫', path: '/admin/kb' },
];

export default function AdminNav({ current }: { current: string }) {
  const navigate = useNavigate();
  const { features } = useAiFeatures();
  const user = authStore.getUser();
  const permissions: string[] = user?.permissions || [];
  const kbEnabled = featureOn(features, 'kb'); // AI-09 知識庫：未啟用則隱藏導覽項
  const allowed = (s: { key: string; perms?: string[] }) =>
    (!s.perms || s.perms.some((p) => permissions.includes(p))) && (s.key !== 'kb' || kbEnabled);
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
        {SECTIONS.filter(allowed).map((s) => (
          <ToggleButton key={s.key} value={s.key}>
            {s.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
