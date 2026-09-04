import { Chip } from '@mui/material';
import { labelOf, STATUS_COLORS, STATUS_OPTIONS } from '../admin/options';

export type Lang = 'zh-Hant' | 'en';

interface Props {
  status: string;
  lang: Lang;
  size?: 'small' | 'medium';
}

/** 狀態色簽（含 hover 說明提示） */
export function StatusChip({ status, lang, size = 'small' }: Props) {
  const color = STATUS_COLORS[status] || '#757575';
  const label = labelOf(STATUS_OPTIONS, status, lang);
  return (
    <Chip
      size={size}
      label={label}
      title={`${status} (${label})`}
      sx={{
        bgcolor: `${color}1A`,
        color,
        fontWeight: 600,
        border: `1px solid ${color}66`,
      }}
    />
  );
}
