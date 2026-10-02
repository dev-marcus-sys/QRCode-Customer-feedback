import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Divider, Paper, Snackbar,
  Stack, ToggleButton, ToggleButtonGroup, Typography, TextField,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { api, ApiRequestError, EmailTemplateItem, authStore } from '../../api/client';
import AdminNav from '../../admin/AdminNav';

const TEMPLATE_META = [
  { key: 'satisfaction_survey', labelZh: '滿意度調查信', labelEn: 'Satisfaction Survey' },
  { key: 'satisfaction_survey_reminder', labelZh: '滿意度調查提醒信', labelEn: 'Survey Reminder' },
];

const PLACEHOLDERS = '{{case_id}} {{estate_name}} {{survey_link}} {{expires}}';

/** 單一範本編輯卡片：主旨 + HTML 內文 + 即時預覽 + 儲存 */
function TemplateCard({
  item, draft, onChange, onSave, saving, canEdit,
}: {
  item: EmailTemplateItem;
  draft: { subject: string; body: string };
  onChange: (patch: { subject?: string; body?: string }) => void;
  onSave: () => void;
  saving: boolean;
  canEdit: boolean;
}) {
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', flex: 1, minWidth: 320 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>{item.key === 'satisfaction_survey' ? '滿意度調查信' : '滿意度調查提醒信'}</Typography>
        <TextField
          fullWidth size="small" label="主旨" margin="dense"
          value={draft.subject}
          disabled={!canEdit}
          onChange={(e) => onChange({ subject: e.target.value })}
        />
        <TextField
          fullWidth size="small" label="內文（支援簡易 HTML）" margin="dense" multiline minRows={8}
          helperText={`可用佔位符：${PLACEHOLDERS}`}
          value={draft.body}
          disabled={!canEdit}
          onChange={(e) => onChange({ body: e.target.value })}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>預覽</Typography>
        <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, background: '#fff', '& a': { color: '#1a5aa6' } }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>{draft.subject || '（空白主旨）'}</Typography>
          <Box
            component="div"
            sx={{ fontSize: 14, color: '#1f2d3d', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: draft.body || '<span style="color:#9aa7b4">（空白內文）</span>' }}
          />
        </Paper>
        {canEdit && (
          <Box sx={{ mt: 1.5, textAlign: 'right' }}>
            <Button startIcon={<SaveIcon />} variant="contained" disabled={saving} onClick={onSave}>
              {saving ? '儲存中…' : '儲存'}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function EmailTemplatePage() {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const permissions: string[] = user?.permissions || [];
  const canView = permissions.includes('config:view');
  const canEdit = permissions.includes('config:update');

  const [items, setItems] = useState<EmailTemplateItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.emailTemplatesGet(token).then((r) => {
      setItems(r.items);
      const d: Record<string, { subject: string; body: string }> = {};
      for (const it of r.items) d[it.configKey] = { subject: it.subject, body: it.body };
      setDrafts(d);
    }).catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入失敗')).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { if (canView) load(); else setLoading(false); }, [canView, load]);

  const visibleItems = useMemo(
    () => TEMPLATE_META.map((m) => items.find((i) => i.key === m.key && i.lang === lang)).filter(Boolean) as EmailTemplateItem[],
    [items, lang],
  );

  const onSave = async (configKey: string) => {
    setSavingKeys((s) => ({ ...s, [configKey]: true }));
    try {
      await api.configUpdate(configKey, drafts[configKey], token);
      setSnack('已儲存郵件範本');
      load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '儲存失敗');
    } finally {
      setSavingKeys((s) => ({ ...s, [configKey]: false }));
    }
  };

  if (!canView) {
    return (
      <Box sx={{ p: 3 }}>
        <AdminNav current="email-templates" />
        <Alert severity="warning" sx={{ mt: 2 }}>當前帳號沒有 config:view 權限，無法檢視郵件範本。</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <AdminNav current="email-templates" />
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2, mb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>郵件範本</Typography>
          <Typography variant="caption" color="text.secondary">修改後將套用於未來新產生的郵件（不影響已入庫的舊郵件）。</Typography>
        </Box>
        <ToggleButtonGroup
          size="small" exclusive value={lang}
          onChange={(_, v: 'zh' | 'en' | null) => { if (v) setLang(v); }}
        >
          <ToggleButton value="zh">繁中</ToggleButton>
          <ToggleButton value="en">English</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 1, mb: 1 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1 }} divider={<Divider orientation="vertical" flexItem />}>
          {visibleItems.map((it) => (
            <TemplateCard
              key={it.configKey}
              item={it}
              draft={drafts[it.configKey] || { subject: '', body: '' }}
              onChange={(patch) => setDrafts((d) => ({ ...d, [it.configKey]: { ...d[it.configKey], ...patch } }))}
              onSave={() => onSave(it.configKey)}
              saving={!!savingKeys[it.configKey]}
              canEdit={canEdit}
            />
          ))}
        </Stack>
      )}

      {!canEdit && !loading && (
        <Alert severity="info" sx={{ mt: 2 }}>當前帳號僅可檢視（config:view）；如需編輯請具備 config:update 權限。</Alert>
      )}

      <Snackbar open={!!snack} autoHideDuration={2500} onClose={() => setSnack('')} message={snack} />
    </Box>
  );
}
