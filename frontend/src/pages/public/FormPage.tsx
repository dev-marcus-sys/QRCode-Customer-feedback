import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, Divider,
  FormControlLabel, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { api, ApiRequestError, FeedbackPayload, FormMeta } from '../../api/client';
import { translate, Lang } from '../../i18n/dict';

interface FormState {
  title: string;
  name: string;
  email: string;
  phone: string;
  incidentDate: string;
  incidentTime: string;
  block: string;
  floor: string;
  unit: string;
  categories: string[];
  otherText: string;
  content: string;
  surveyConsent: boolean;
  privacyAgree: boolean;
}

const initialForm = (): FormState => ({
  title: '', name: '', email: '', phone: '', incidentDate: '', incidentTime: '',
  block: '', floor: '', unit: '', categories: [], otherText: '', content: '',
  surveyConsent: true, privacyAgree: false,
});

type FieldErrors = Record<string, string>;

export function FormPage() {
  const [params] = useSearchParams();
  const estate = params.get('estate') || 'CHNG';
  const navigate = useNavigate();

  const [lang, setLang] = useState<Lang>(params.get('lang') === 'en' ? 'en' : 'zh-Hant');
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [form, setForm] = useState<FormState>(initialForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const draftKey = `qrform_${estate}`;

  // 載入表單設定（含該語系標籤）
  useEffect(() => {
    api
      .getMeta(estate, lang)
      .then((m) => setMeta(m))
      .catch((e) => setMetaError(e instanceof ApiRequestError ? e.message : '載入失敗'));
  }, [estate, lang]);

  // 輸入暫存（防刷新遺失）
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) setForm((cur) => ({ ...cur, ...JSON.parse(saved) }));
    } catch {
      sessionStorage.removeItem(draftKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    const { privacyAgree, ...rest } = form;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
  }, [form, draftKey]);

  const maxLength = meta?.maxLength || { name: 50, content: 1000, other: 50 };

  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    const touched = Object.keys(patch)[0];
    if (touched && errors[touched]) setErrors((e) => ({ ...e, [touched]: '' }));
  };

  const toggleCategory = (code: string) => {
    setForm((f) => {
      const has = f.categories.includes(code);
      if (has) return { ...f, categories: f.categories.filter((c) => c !== code) };
      if (f.categories.length >= 3) return f;
      return { ...f, categories: [...f.categories, code] };
    });
  };

  const localValidate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!form.title) e.title = lang === 'en' ? 'Required' : '必填';
    if (!form.name.trim()) e.name = lang === 'en' ? 'Required' : '必填';
    if (!form.email.trim() && !form.phone.trim()) e.contact = translate(lang, 'form.contactHint');
    if (!form.incidentDate) e.incidentDate = translate(lang, 'form.required');
    if (form.categories.length === 0) e.categories = lang === 'en' ? 'Select at least one' : '請至少選擇一項';
    if (form.categories.includes('OTHER') && !form.otherText.trim()) e.otherText = lang === 'en' ? 'Required' : '必填';
    if (!form.content.trim()) e.content = lang === 'en' ? 'Required' : '必填';
    if (!form.privacyAgree) e.privacyAgree = lang === 'en' ? 'Required' : '必填';
    return e;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTopError('');
    const local = localValidate();
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSubmitting(true);
    let token: string;
    try {
      const t = await api.getToken(estate);
      token = t.token;
    } catch {
      setTopError(translate(lang, 'common.error').replace('{msg}', 'token'));
      setSubmitting(false);
      return;
    }
    const payload: FeedbackPayload = {
      estate,
      title: form.title,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      incidentDate: form.incidentDate,
      incidentTime: form.incidentTime,
      address: { block: form.block.trim(), floor: form.floor.trim(), unit: form.unit.trim() },
      categories: form.categories,
      otherText: form.otherText.trim(),
      content: form.content.trim(),
      surveyConsent: form.surveyConsent,
      formToken: token,
      lang,
    };
    try {
      const res = await api.submitFeedback(payload);
      sessionStorage.removeItem(draftKey);
      const metaData = meta;
      navigate('/success', {
        replace: true,
        state: {
          lang,
          caseId: res.caseId,
          estateName: metaData ? metaData.estateNameZh : estate,
          categoryLabels: form.categories.map((c) => metaData?.categories.find((x) => x.code === c)?.label || c),
          contentPreview: form.content.slice(0, 80),
          message: res.message,
          isDuplicate: false,
        },
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 1001) {
          const dupCaseId = (err.detail as { caseId?: string } | null)?.caseId || '';
          sessionStorage.removeItem(draftKey);
          navigate('/success', {
            replace: true,
            state: {
              lang, caseId: dupCaseId, estateName: meta?.estateNameZh || estate,
              categoryLabels: [], contentPreview: '', message: err.message, isDuplicate: true,
            },
          });
        } else if (err.code === 1002) {
          const detail = (err.detail as { detail: { field: string; zh: string; en: string }[] } | null)?.detail || [];
          const mapped: FieldErrors = {};
          detail.forEach((d) => {
            mapped[d.field] = lang === 'en' ? d.en : d.zh;
          });
          setErrors(mapped);
        } else {
          setTopError(err.message);
        }
      } else {
        setTopError(translate(lang, 'common.error').replace('{msg}', ''));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setForm(initialForm());
    setErrors({});
    sessionStorage.removeItem(draftKey);
  };

  const categoryOptions = meta?.categories || [];
  const contentLen = form.content.length;
  const otherLen = form.otherText.length;
  const displayName = useMemo(() => (lang === 'en' ? meta?.estateNameEn : meta?.estateNameZh), [meta, lang]);

  if (metaError) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Alert severity="error">{metaError}</Alert>
      </Box>
    );
  }
  if (!meta) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const t = (k: string) => translate(lang, k);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#eef2f7', pb: 6 }}>
      <Container maxWidth="sm">
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ py: 2 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 44, width: 'auto' }} />
            <Box>
              <Typography variant="h6" sx={{ color: '#1a5aa6' }}>
                {displayName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('form.title')}
              </Typography>
            </Box>
          </Stack>
          <Button size="small" onClick={() => setLang(lang === 'en' ? 'zh-Hant' : 'en')}>
            {lang === 'en' ? '繁體中文' : 'EN'}
          </Button>
        </Stack>

        <form onSubmit={submit} noValidate>
          <Card sx={{ borderRadius: 3, boxShadow: 3 }}>
            <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
              <Stack spacing={3}>
                {topError && <Alert severity="error">{topError}</Alert>}

                {/* 意見種類 */}
                <Box>
                  <Typography fontWeight={600} sx={{ mb: 1 }}>
                    {t('form.categories')} <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                    <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 13, ml: 1 }}>
                      {t('form.categoriesHint')}
                    </Box>
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {categoryOptions.map((c) => {
                      const selected = form.categories.includes(c.code);
                      return (
                        <Chip
                          key={c.code}
                          label={c.label}
                          clickable
                          color={selected ? 'primary' : 'default'}
                          variant={selected ? 'filled' : 'outlined'}
                          onClick={() => toggleCategory(c.code)}
                          disabled={!selected && form.categories.length >= 3}
                        />
                      );
                    })}
                  </Stack>
                  {errors.categories && (
                    <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                      {errors.categories}
                    </Typography>
                  )}
                  {form.categories.includes('OTHER') && (
                    <TextField
                      size="small" fullWidth sx={{ mt: 1.5 }}
                      label={t('form.otherText')} value={form.otherText}
                      onChange={(e) => set({ otherText: e.target.value })}
                      error={!!errors.otherText} helperText={errors.otherText || `${otherLen}/${maxLength.other}`}
                      inputProps={{ maxLength: maxLength.other }}
                    />
                  )}
                </Box>

                <Divider />

                {/* 客戶聯絡資料 */}
                <Box>
                  <Typography fontWeight={600} sx={{ mb: 1.5 }}>{t('form.title.label')} / {t('form.name')}</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      select size="small" fullWidth label={t('form.title.label')} value={form.title}
                      onChange={(e) => set({ title: e.target.value })} error={!!errors.title} helperText={errors.title}
                    >
                      {meta.titles.map((ti) => (
                        <MenuItem key={ti} value={ti}>{ti}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small" fullWidth label={t('form.name')} value={form.name}
                      onChange={(e) => set({ name: e.target.value })} error={!!errors.name} helperText={errors.name}
                      inputProps={{ maxLength: maxLength.name }}
                    />
                  </Stack>
                </Box>

                <Box>
                  <Typography fontWeight={600} sx={{ mb: 1.5 }}>{t('form.email')} / {t('form.phone')}</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField size="small" fullWidth type="email" label={t('form.email')} value={form.email}
                      onChange={(e) => set({ email: e.target.value })} />
                    <TextField size="small" fullWidth label={t('form.phone')} value={form.phone}
                      onChange={(e) => set({ phone: e.target.value })} placeholder="+852 9123 4567" />
                  </Stack>
                  {errors.contact && (
                    <Typography variant="caption" color="error">{errors.contact}</Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    {t('form.contactHint')}
                  </Typography>
                </Box>

                <Box>
                  <Typography fontWeight={600} sx={{ mb: 1.5 }}>{t('form.incidentDate')}</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField size="small" fullWidth type="date" label={t('form.incidentDate')}
                      value={form.incidentDate}
                      onChange={(e) => set({ incidentDate: e.target.value })}
                      error={!!errors.incidentDate} helperText={errors.incidentDate}
                      InputLabelProps={{ shrink: true }} />
                    <TextField size="small" fullWidth type="time" label={t('form.incidentTime')}
                      value={form.incidentTime} onChange={(e) => set({ incidentTime: e.target.value })}
                      InputLabelProps={{ shrink: true }} />
                  </Stack>
                </Box>

                <Box>
                  <Typography fontWeight={600} sx={{ mb: 1.5 }}>{t('form.address')}</Typography>
                  <Stack direction="row" spacing={1.5}>
                    <TextField size="small" label={t('form.block')} value={form.block} onChange={(e) => set({ block: e.target.value })} sx={{ flex: 1 }} />
                    <TextField size="small" label={t('form.floor')} value={form.floor} onChange={(e) => set({ floor: e.target.value })} sx={{ flex: 1 }} />
                    <TextField size="small" label={t('form.unit')} value={form.unit} onChange={(e) => set({ unit: e.target.value })} sx={{ flex: 1 }} />
                  </Stack>
                </Box>

                <Divider />

                {/* 意見內容 */}
                <Box>
                  <Typography fontWeight={600} sx={{ mb: 1 }}>
                    {t('form.content')} <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                  </Typography>
                  <TextField
                    multiline minRows={4} maxRows={8} fullWidth
                    label={t('form.contentHint')} value={form.content}
                    onChange={(e) => set({ content: e.target.value })}
                    error={!!errors.content} helperText={errors.content || `${contentLen}/${maxLength.content}`}
                    inputProps={{ maxLength: maxLength.content }}
                  />
                </Box>

                <Box>
                  <FormControlLabel
                    control={<Switch checked={form.surveyConsent} onChange={(e) => set({ surveyConsent: e.target.checked })} />}
                    label={t('form.surveyConsent')}
                  />
                </Box>
                <FormControlLabel
                  control={
                    <Switch checked={form.privacyAgree} onChange={(e) => set({ privacyAgree: e.target.checked })} />
                  }
                  label={
                    <span>
                      {t('form.privacyPrefix')}{' '}
                      <a href={meta.privacyPolicyUrl} target="_blank" rel="noreferrer" style={{ color: '#1a5aa6' }}>
                        {t('form.privacy')}
                      </a>
                      <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                    </span>
                  }
                />
                {errors.privacyAgree && (
                  <Typography variant="caption" color="error">{errors.privacyAgree}</Typography>
                )}

                <Divider />

                <Stack direction="row" spacing={2}>
                  <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
                    {submitting ? t('form.submitting') : t('form.submit')}
                  </Button>
                  <Button variant="outlined" onClick={reset} disabled={submitting}>
                    {t('form.reset')}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </form>
      </Container>
    </Box>
  );
}
