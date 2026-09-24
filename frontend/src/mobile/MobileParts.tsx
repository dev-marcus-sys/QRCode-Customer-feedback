import { ReactNode } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Typography } from '@mui/material';

/** 手機版通用元件：大字 KPI 磚、區段卡、進度條列。供儀表板／問卷等頁面複用。 */

export function KpiTile({
  label, value, unit, delta, tone = '#1a5aa6',
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  delta?: string | null;
  tone?: string;
}) {
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', p: 1.8, flex: '1 1 0', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: tone, lineHeight: 1.1 }}>
          {value == null || value === '' ? '—' : value}
        </Typography>
        {unit && <Typography variant="caption" color="text.secondary">{unit}</Typography>}
      </Box>
      {delta != null && (
        <Chip size="small" label={delta} sx={{ height: 20, fontSize: 11, mt: 0.8, bgcolor: '#f5f7fa', color: '#5b6b82' }} />
      )}
    </Card>
  );
}

export function SectionCard({
  title, children, right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
      <Box sx={{ px: 2, py: 1.4, display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600} sx={{ fontSize: 15 }}>{title}</Typography>
        <Box sx={{ flex: 1 }} />
        {right}
      </Box>
      <CardContent sx={{ pt: 1.6 }}>{children}</CardContent>
    </Card>
  );
}

export function BarRow({
  label, value, rate, color = '#1a5aa6', sub,
}: {
  label: string;
  value: number | string;
  rate: number;
  color?: string;
  sub?: string;
}) {
  return (
    <Box sx={{ mb: 1.4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" fontWeight={700}>
          {value}
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            ({rate}%)
          </Typography>
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(rate, 100)}
        sx={{ height: 8, borderRadius: 4, mt: 0.5, bgcolor: '#e6ebf3', '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 4 } }}
      />
      {sub && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.3 }}>{sub}</Typography>}
    </Box>
  );
}

export function fmt(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}
