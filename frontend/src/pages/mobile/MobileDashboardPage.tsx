import { useEffect, useState } from 'react';
import { Alert, Box, Checkbox, Chip, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api, ApiRequestError, authStore, DashboardSummaryData, KpiCard, RangePreset } from '../../api/client';
import { useEstates } from '../../admin/useEstates';
import { KpiTile, SectionCard, BarRow } from '../../mobile/MobileParts';

const RANGES: { code: RangePreset; label: string }[] = [
  { code: 'today', label: '本日' },
  { code: 'thisWeek', label: '本週' },
  { code: 'thisMonth', label: '本月' },
  { code: 'thisQuarter', label: '本季' },
  { code: 'thisYear', label: '本年' },
];

function fmtKpi(k: KpiCard): string {
  if (k.value == null) return '—';
  const v = Number(k.value);
  if (k.key === 'KPI_09') return v.toFixed(2);
  if (['KPI_02', 'KPI_05', 'KPI_06', 'KPI_07', 'KPI_10'].includes(k.key)) return v.toFixed(1);
  return String(Math.round(v));
}

function deltaText(k: KpiCard): string | null {
  if (k.delta == null) return null;
  const arrow = k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '—';
  return `${arrow}${Math.abs(Number(k.delta)).toFixed(1)} 較上期`;
}

function toneOf(k: KpiCard): string {
  if (k.met === false) return '#c62828';
  if (k.met === true) return '#2e7d32';
  return '#1a5aa6';
}

/** 手機版儀表板 /m/dashboard：大字 KPI 磚 + 滿意度調查接受情況。 */
export function MobileDashboardPage() {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const scopeCodes = user && user.estateCodes && user.estateCodes.length && !user.estateCodes.includes('ALL')
    ? user.estateCodes : null;
  const estates = useEstates();
  const [range, setRange] = useState<RangePreset>('thisMonth');
  const [estate, setEstate] = useState<string[]>([]); // 屋苑可多選；空陣列＝全部（在所屬範圍內）
  const effectiveEstate = estate.join(',');
  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .dashboardSummary({ range, estate: effectiveEstate }, token)
      .then((s) => alive && setSummary(s))
      .catch((e) => {
        if (alive) {
          setError(e instanceof ApiRequestError ? e.message : '載入失敗');
          if (e instanceof ApiRequestError && e.code === 2001) {
            authStore.clear();
            window.location.assign('/m/login');
          }
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, estate, token]);

  const sc = summary?.surveyConsent;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        {RANGES.map((r) => (
          <Chip
            key={r.code}
            label={r.label}
            size="small"
            color={range === r.code ? 'primary' : 'default'}
            variant={range === r.code ? 'filled' : 'outlined'}
            onClick={() => setRange(r.code)}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <TextField
          select size="small" label="屋苑（可多選）" sx={{ minWidth: 170 }} disabled={!!scopeCodes && scopeCodes.length <= 1}
          SelectProps={{
            multiple: true,
            renderValue: (selected: unknown) => {
              const sel = selected as string[];
              const all = sel.length === 0 || sel.includes('ALL');
              return (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {all
                    ? <Chip size="small" variant="outlined" label="全屋苑 (ALL)" />
                    : sel.map((code) => (
                        <Chip key={code} size="small" label={(scopeCodes
                          ? scopeCodes.map((c) => ({ code: c, zh: estates.nameOf(c) }))
                          : estates.activeOptions.map((x) => ({ code: x.estateCode, zh: x.estateNameZh }))
                        ).find((o) => o.code === code)?.zh || code} />
                      ))}
                </Box>
              );
            },
          }}
          value={estate}
          onChange={(e) => {
            const v = e.target.value as unknown as string[];
            setEstate(v.includes('ALL') ? [] : v.filter((c) => c !== 'ALL'));
          }}
        >
          <MenuItem value="ALL">
            <Checkbox checked={estate.length === 0} />
            <ListItemText primary="全屋苑 (ALL)" />
          </MenuItem>
          {(scopeCodes
            ? scopeCodes.map((c) => ({ code: c, zh: estates.nameOf(c) }))
            : estates.activeOptions.map((x) => ({ code: x.estateCode, zh: x.estateNameZh }))
          ).map((x) => (
            <MenuItem key={x.code} value={x.code}>
              <Checkbox checked={estate.includes(x.code)} />
              <ListItemText primary={x.zh} />
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>載入中…</Typography>}

      {!loading && summary && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            期間：{summary.range.labelZh} {summary.range.from} ~ {summary.range.to}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5, mb: 2 }}>
            {summary.kpi.map((k) => (
              <KpiTile key={k.key} label={k.labelZh} value={fmtKpi(k)} unit={k.unit} delta={deltaText(k)} tone={toneOf(k)} />
            ))}
          </Box>

          {sc && (
            <SectionCard title={`滿意度調查接受情況（共 ${sc.total} 宗）`}>
              <BarRow
                label="願意接受滿意度調查"
                value={sc.willing.count}
                rate={sc.willing.rate ?? 0}
                color="#2e7d32"
                sub={`佔總個案 ${sc.willing.rate ?? 0}%`}
              />
              <BarRow
                label="已完成滿意度調查"
                value={sc.completed.count}
                rate={sc.completed.rate ?? 0}
                color="#1a5aa6"
                sub={`佔願意接受 ${sc.completed.rate ?? 0}%`}
              />
              <BarRow
                label="不願意接受滿意度調查"
                value={sc.unwilling.count}
                rate={sc.unwilling.rate ?? 0}
                color="#c62828"
                sub={`佔總個案 ${sc.unwilling.rate ?? 0}%`}
              />
            </SectionCard>
          )}
        </>
      )}
    </Box>
  );
}
