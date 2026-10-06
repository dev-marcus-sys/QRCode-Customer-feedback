import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container,   Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
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

  /** 電郵格式（與後端 validate.js EMAIL_RE 一致） */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  /** 香港電話：+852（可略）＋ 2/3/5/6/9 開頭 8 位數（與後端 PHONE_RE 一致） */
  const PHONE_RE = /^(?:\+852)?[23569]\d{7}$/;

type FieldErrors = Record<string, string>;

export function FormPage() {
  const [params] = useSearchParams();
  const estate = params.get('estate') || 'CHNG';
  // 短亂數 QR 連結令牌（舊格式連結無此參數 → 後端會回傳「連結已失效」）
  const qrToken = params.get('t') || undefined;
  const navigate = useNavigate();

  const [lang, setLang] = useState<Lang>(params.get('lang') === 'en' ? 'en' : 'zh-Hant');
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [form, setForm] = useState<FormState>(initialForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [policyHtml, setPolicyHtml] = useState('');
  const [policyScrolled, setPolicyScrolled] = useState(false);
  const [policyAgreed, setPolicyAgreed] = useState(false);
  const policyContentRef = useRef<HTMLDivElement | null>(null);
  const draftKey = `qrform_${estate}`;

  // 開啟 popup 時抓取私隱政策 HTML，抽取 <style> 與 <body> 內嵌（避免 iframe，手機更穩）
  useEffect(() => {
    if (!privacyOpen || policyHtml) return;
    const url = meta?.privacyPolicyUrl || '/privacy-policy.html';
    fetch(url)
      .then((r) => r.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const style = doc.querySelector('style')?.outerHTML || '';
        setPolicyHtml(style + (doc.body?.innerHTML || ''));
      })
      .catch(() => setPolicyHtml(''));
  }, [privacyOpen, policyHtml, meta]);

  // 每次開啟 popup 重置「是否已捲到底」；內容未溢出（不需捲動）時直接允許確認
  useEffect(() => {
    if (privacyOpen) setPolicyScrolled(false);
  }, [privacyOpen]);

  useEffect(() => {
    if (!privacyOpen) return;
    const el = policyContentRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setPolicyScrolled(true);
  }, [privacyOpen, policyHtml]);

  // 載入表單設定（含該語系標籤）
  useEffect(() => {
    api
      .getMeta(estate, lang, qrToken)
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
    // 聯絡方式二擇一：填寫任一即解除 contact 錯誤
    if ((touched === 'email' || touched === 'phone') && errors.contact && String(patch[touched] || '').trim()) {
      setErrors((e) => ({ ...e, contact: '' }));
    }
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
    if (!form.email.trim() && !form.phone.trim()) e.contact = translate(lang, 'form.contactRequired');
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = translate(lang, 'form.emailInvalid');
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) e.phone = translate(lang, 'form.phoneInvalid');
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
      const tk = await api.getToken(estate, qrToken);
      token = tk.token;
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
      ...(qrToken ? { t: qrToken } : {}),
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
          estate,
          t: qrToken,
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
              estate, t: qrToken,
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
    setPolicyAgreed(false);
    sessionStorage.removeItem(draftKey);
  };

  const categoryOptions = meta?.categories || [];
  // 即時格式校驗：輸入當下即顯示紅框與訊息（不必等到按送出）
  const emailInvalid = !!form.email.trim() && !EMAIL_RE.test(form.email.trim());
  const phoneInvalid = !!form.phone.trim() && !PHONE_RE.test(form.phone.trim());
  const contentLen = form.content.length;
  const otherLen = form.otherText.length;
  const displayName = useMemo(() => (lang === 'en' ? meta?.estateNameEn : meta?.estateNameZh), [meta, lang]);

  if (metaError) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: '#eef2f7' }}>
        <Card sx={{ maxWidth: 420, width: '100%', borderRadius: 3, boxShadow: 3 }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 44, mb: 2 }} />
            <Alert severity="error" sx={{ textAlign: 'left' }}>{metaError}</Alert>
          </CardContent>
        </Card>
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
                      onChange={(e) => set({ email: e.target.value })}
                      error={!!errors.contact || !!errors.email || emailInvalid}
                      helperText={errors.email || (emailInvalid ? translate(lang, 'form.emailInvalid') : '')} />
                    <TextField size="small" fullWidth label={t('form.phone')} value={form.phone}
                      onChange={(e) => set({ phone: e.target.value })} placeholder="+852 9123 4567"
                      error={!!errors.contact || !!errors.phone || phoneInvalid}
                      helperText={errors.phone || (phoneInvalid ? translate(lang, 'form.phoneInvalid') : '')} />
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
                    {/* 原生 date 的「年/月/日」提示依瀏覽器語言顯示，無法隨網頁語言切換。
                        清空時隱藏原生提示（WebKit 設透明），改由 MUI 浮動 label 作提示（跟隨表單語言），
                        選擇日期後再恢復原生顯示 */}
                    <TextField size="small" fullWidth type="date" label={t('form.incidentDate')}
                      value={form.incidentDate}
                      onChange={(e) => set({ incidentDate: e.target.value })}
                      error={!!errors.incidentDate} helperText={errors.incidentDate}
                      InputLabelProps={{ shrink: form.incidentDate ? true : undefined }}
                      sx={form.incidentDate ? undefined : { '& input::-webkit-datetime-edit': { color: 'transparent' } }} />
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
                    <Switch
                      checked={form.privacyAgree}
                      onChange={() => {
                        if (!policyAgreed) {
                          setPrivacyOpen(true);
                        }
                        // 已確認後鎖定為開啟，禁止手動關閉；未確認則點擊只彈出政策
                      }}
                    />
                  }
                  label={
                    <span>
                      {t('form.privacyPrefix')}{' '}
                      <Box
                        component="span"
                        onClick={() => setPrivacyOpen(true)}
                        sx={{ color: '#1a5aa6', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {t('form.privacy')}
                      </Box>
                      <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                    </span>
                  }
                />
                {errors.privacyAgree && (
                  <Typography variant="caption" color="error">{errors.privacyAgree}</Typography>
                )}

                <Divider />

                <Typography variant="body2" color="text.secondary" textAlign="center">
                  {t('form.responsePromise')}
                </Typography>

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
      <Dialog
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        maxWidth="md"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ pr: 6 }}>
          {t('form.privacy')}
          <IconButton
            aria-label="close"
            onClick={() => setPrivacyOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          dividers
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 8) setPolicyScrolled(true);
          }}
        >
          <Box
            ref={policyContentRef}
            sx={{ '& .wrap': { maxWidth: '100%', padding: '8px 0 0', background: 'transparent' } }}
            dangerouslySetInnerHTML={{ __html: policyHtml }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, display: 'block' }}>
          {!policyScrolled && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {lang === 'en' ? 'Please scroll to the bottom before confirming.' : '請先向下捲動至底部方可確認。'}
            </Typography>
          )}
          <Box sx={{ textAlign: 'right' }}>
            <Button onClick={() => setPrivacyOpen(false)} sx={{ mr: 1 }}>
              {lang === 'en' ? 'Close' : '關閉'}
            </Button>
            <Button
              variant="contained"
              disabled={!policyScrolled}
              onClick={() => {
                setPolicyAgreed(true);
                set({ privacyAgree: true });
                setPrivacyOpen(false);
              }}
            >
              {lang === 'en' ? 'I have read' : '我已閱讀'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
