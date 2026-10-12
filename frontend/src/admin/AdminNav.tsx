/**
 * F-010 管理後台共用導覽：個案 / QR / 問卷 / 儀表板 / 參數 / 用戶 / 角色 / 審計 / 屋苑。
 * 置於各管理頁頂部，便於在 F-010 與其他模組間切換。
 */
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { ElementType } from 'react';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import MailIcon from '@mui/icons-material/Mail';
import DraftsIcon from '@mui/icons-material/Drafts';
import InsightsIcon from '@mui/icons-material/Insights';
import TuneIcon from '@mui/icons-material/Tune';
import PeopleIcon from '@mui/icons-material/People';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HistoryIcon from '@mui/icons-material/History';
import ApartmentIcon from '@mui/icons-material/Apartment';
import ChecklistIcon from '@mui/icons-material/Checklist';
import StorageIcon from '@mui/icons-material/Storage';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { useAiFeatures, featureOn } from '../aiFeatures';
import { authStore } from '../api/client';

/** 各選單項所需的權限碼（任一符合即顯示；未設定則不受限）；供 AdminNav 與 CaseListPage 工具列共用 */
export const SECTIONS: { key: string; label: string; path: string; perms?: string[]; icon: ElementType }[] = [
  { key: 'cases', label: '個案', path: '/admin/cases', perms: ['case:list'], icon: FolderSpecialIcon },
  { key: 'qr', label: 'QR Code', path: '/admin/qr', perms: ['qr:view', 'qr:generate'], icon: QrCode2Icon },
  { key: 'surveys', label: '問卷', path: '/admin/surveys', perms: ['dashboard:view'], icon: FactCheckIcon },
  { key: 'emails', label: '郵件發送', path: '/admin/emails', perms: ['dashboard:view'], icon: MailIcon },
  { key: 'email-templates', label: '郵件範本', path: '/admin/email-templates', perms: ['config:view'], icon: DraftsIcon },
  { key: 'dashboard', label: '儀表板', path: '/admin/dashboard', perms: ['dashboard:view'], icon: InsightsIcon },
  { key: 'config', label: '參數', path: '/admin/config', perms: ['config:view'], icon: TuneIcon },
  { key: 'users', label: '用戶', path: '/admin/users', perms: ['user:list'], icon: PeopleIcon },
  { key: 'roles', label: '角色', path: '/admin/roles', perms: ['role:list'], icon: ManageAccountsIcon },
  { key: 'audit', label: '審計', path: '/admin/audit', perms: ['audit:view'], icon: HistoryIcon },
  { key: 'estates', label: '屋苑', path: '/admin/estates', perms: ['estate:list'], icon: ApartmentIcon },
  { key: 'survey-templates', label: '問卷範本', path: '/admin/survey-templates', perms: ['config:view'], icon: ChecklistIcon },
  { key: 'database', label: '資料庫', path: '/admin/database', perms: ['db:query'], icon: StorageIcon },
  { key: 'kb', label: '知識庫', path: '/admin/kb', icon: MenuBookIcon },
];

export default function AdminNav({ current }: { current: string }) {
  const navigate = useNavigate();
  const { features } = useAiFeatures();
  const user = authStore.getUser();
  const permissions: string[] = user?.permissions || [];
  /* 僅個案頁顯示導覽區塊（logo + 標題 + 按鈕列），其他管理頁整塊移除 */
  if (current !== 'cases') return null;
  const kbEnabled = featureOn(features, 'kb'); // AI-09 知識庫：未啟用則隱藏導覽項
  /* 各項依權限顯示：任一所需權限符合即出現；知識庫另受 AI 功能開關控制 */
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
        sx={{
          flexWrap: { xs: 'nowrap', md: 'wrap' },
          overflowX: { xs: 'auto', md: 'visible' },
          maxWidth: '100%',
          '& .MuiToggleButton-root': { whiteSpace: 'nowrap', flexShrink: 0 },
        }}
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
