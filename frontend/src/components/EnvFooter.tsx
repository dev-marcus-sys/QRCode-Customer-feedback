import { useEffect, useState } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { api, EnvInfo } from '../api/client';

/** 環境標籤配色：本機=綠、測試=橙、正式=紅 */
const ENV_COLOR: Record<string, string> = {
  local: '#2e7d32',
  test: '#ed6c02',
  production: '#c62828',
};

interface Props {
  /** true＝固定懸浮於底部（手機版需設 bottomOffset 避開底部 Tab）；false＝隨頁面流排於底部 */
  fixed?: boolean;
  /** 固定模式下的 bottom 偏移（px），用於手機版避開底部導覽 */
  bottomOffset?: number;
}

/**
 * 全域環境條：顯示「執行環境（本機 / 測試 / 正式）」與「資料庫位置」。
 * 資料取自 GET /api/v1/health（公開 API，無須登入）。
 */
export function EnvFooter({ fixed = false, bottomOffset = 0 }: Props) {
  const [info, setInfo] = useState<EnvInfo | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getEnvInfo()
      .then((d) => alive && setInfo(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  const key = info?.environment?.key || 'unknown';
  const label = info?.environment?.label || (err ? '環境資訊取得失敗' : '環境資訊讀取中…');
  const color = ENV_COLOR[key] || '#5a6573';
  const dbPath = info?.dbPath || '—';

  return (
    <Box
      component="footer"
      sx={{
        ...(fixed
          ? { position: 'fixed', bottom: bottomOffset, left: 0, right: 0, zIndex: 1200 }
          : {}),
        bgcolor: '#1f2933',
        color: '#cfd8e3',
        borderTop: '1px solid #33414f',
        px: 1.5,
        pt: 0.5,
        pb: 'calc(4px + env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        fontSize: 12,
        lineHeight: 1.4,
        width: '100%',
      }}
    >
      <Chip
        label={label}
        size="small"
        sx={{ bgcolor: color, color: '#fff', fontWeight: 700, height: 20, fontSize: 11, flexShrink: 0 }}
      />
      <Typography
        variant="caption"
        sx={{
          color: '#cfd8e3',
          fontSize: 11,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={dbPath}
      >
        DB：{dbPath}
      </Typography>
    </Box>
  );
}
