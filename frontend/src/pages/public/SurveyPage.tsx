import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Box, Button, ButtonGroup, Card, CardContent, Chip, CircularProgress,
  Paper, Stack, TextField, Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { api, ApiRequestError, PublicSurvey } from '../../api/client';

type Lang = 'zh-Hant' | 'en';

const T: Record<Lang, Record<string, string>> = {
  'zh-Hant': {
    brand: '屋苑服務處', sub: 'QRCode 意見反饋系統', title: '滿意度調查',
    desc: '感謝您花時間回饋，您的意見有助我們持續改善服務。本問卷以匿名方式進行，不紀錄您的個人資料。',
    thank: '感謝您的回覆！', done: '您的問卷已成功提交，意見將轉交屋苑服務處跟進。',
    ref: '回覆編號', expired: '此問卷已過期', expiredHint: '問卷連結已逾期，恕無法重發。如有需要請直接聯絡屋苑服務處。',
    submitted: '此問卷已提交', submittedHint: '您已於稍早提交此問卷，重複提交恕不受理。',
    invalid: '問卷連結無效', invalidHint: '找不到此問卷，請檢查連結是否正確，或聯絡屋苑服務處。',
    score: '評分', feedback: '其他意見（選填）', feedbackPh: '歡迎留下您的想法…（最多 2000 字）',
    submit: '提交問卷', loading: '載入問卷中…', err: '載入失敗，請稍後再試',
    mandatory: '請為全部 4 題評分後再提交。', estate: '屋苑', avg: '平均分', thanksNote: '我們會審慎參考每一份回覆。',
    invalidToken: '無效問卷連結',
  },
  en: {
    brand: 'Estate Management Office', sub: 'QRCode Feedback System', title: 'Satisfaction Survey',
    desc: 'Thank you for taking the time to share your feedback. This survey is anonymous and no personal data is recorded.',
    thank: 'Thank you for your feedback!', done: 'Your response has been submitted successfully.',
    ref: 'Reference No.', expired: 'This survey has expired', expiredHint: 'The link has expired and cannot be resent. Please contact the Estate Management Office if needed.',
    submitted: 'Survey already completed', submittedHint: 'This survey has already been submitted. Duplicate submissions are not accepted.',
    invalid: 'Invalid survey link', invalidHint: 'We could not find this survey. Please check the link or contact the Estate Management Office.',
    score: 'Rating', feedback: 'Additional comments (optional)', feedbackPh: 'Share your thoughts here… (max 2000 characters)',
    submit: 'Submit Survey', loading: 'Loading survey…', err: 'Failed to load, please try again later.',
    mandatory: 'Please rate all 4 questions before submitting.', estate: 'Estate', avg: 'Average', thanksNote: 'Every response is carefully reviewed.',
    invalidToken: 'Invalid survey link',
  },
};

const RATING_HELP: Record<Lang, string[]> = {
  'zh-Hant': ['非常不滿意', '不滿意', '一般', '滿意', '非常滿意'],
  en: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
};

export function SurveyPage() {
  const rawToken = useParams().token;
  const token = rawToken ? decodeURIComponent(rawToken) : undefined;
  const [lang, setLang] = useState<Lang>('zh-Hant');
  const [data, setData] = useState<PublicSurvey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<{ caseId: string; average: number } | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    api
      .getSurvey(token, lang)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setInvalid(false);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiRequestError && e.code === 4006) setInvalid(true);
        else setError(e instanceof ApiRequestError ? e.message : T[lang].err);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, lang]);

  const t = T[lang];
  const estateName = lang === 'en' ? data?.estateNameEn || data?.estateNameZh : data?.estateNameZh;

  const submit = async () => {
    if (!data) return;
    const all = data.questions.map((q) => q.key).every((k) => ratings[k] >= 1);
    if (!all) {
      setError(t.mandatory);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.submitSurvey(token as string, { ratings, feedback });
      setSubmitted({ caseId: r.caseId, average: r.average });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t.err);
      if (e instanceof ApiRequestError && e.code === 4006) setInvalid(true);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <PageShell lang={lang} setLang={setLang}>
        <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}><CircularProgress /></Box>
      </PageShell>
    );
  }

  if (invalid || !token) {
    return (
      <PageShell lang={lang} setLang={setLang}>
        <StatusCard icon={<ErrorOutlineIcon color="error" sx={{ fontSize: 46 }} />} title={t.invalid} hint={t.invalidHint} tone="error" />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell lang={lang} setLang={setLang}>
        <Alert severity="error">{error || t.err}</Alert>
      </PageShell>
    );
  }

  // 完成畫面
  if (submitted) {
    return (
      <PageShell lang={lang} setLang={setLang}>
        <Box sx={{ textAlign: 'center', py: 2 }}>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 64 }} />
          <Typography variant="h5" fontWeight={800} sx={{ mt: 1 }}>{t.thank}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t.done}</Typography>
          <Paper elevation={0} sx={{ mt: 3, p: 2.5, borderRadius: 2, border: '1px solid #e5eaf2', bgcolor: '#f8fafc', textAlign: 'left' }}>
            <RowLine label={`${t.estate}：`} value={estateName || '—'} />
            <RowLine label={`${t.ref}：`} value={submitted.caseId} mono />
            <RowLine label={`${t.avg}：`} value={`${submitted.average.toFixed(1)} / 5`} />
          </Paper>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{t.thanksNote}</Typography>
        </Box>
      </PageShell>
    );
  }

  // 狀態頁：已提交 / 已過期
  if (data.status !== 'SENT') {
    const isSubmitted = data.status === 'SUBMITTED';
    const icon = isSubmitted
      ? <CheckCircleOutlineIcon color="success" sx={{ fontSize: 46 }} />
      : <ScheduleIcon color="warning" sx={{ fontSize: 46 }} />;
    return (
      <PageShell lang={lang} setLang={setLang}>
        <StatusCard
          icon={icon}
          title={isSubmitted ? t.submitted : t.expired}
          hint={isSubmitted ? t.submittedHint : t.expiredHint}
          tone={isSubmitted ? 'success' : 'warning'}
        />
      </PageShell>
    );
  }

  return (
    <PageShell lang={lang} setLang={setLang}>
      <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid #e3e9f2', overflow: 'hidden', boxShadow: '0 12px 40px rgba(20,60,120,.10)' }}>
        <Box sx={{ p: { xs: 2.5, sm: 3.5 }, background: 'linear-gradient(135deg,#1a5aa6 0%,#0f6cbd 55%,#35a2d6 100%)', color: '#fff' }}>
          <Typography variant="h5" fontWeight={800}>{t.title}</Typography>
          <Typography variant="body2" sx={{ mt: 0.8, opacity: 0.92 }}>{t.desc}</Typography>
          <Box sx={{ mt: 1.6, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Chip label={`${t.estate}：${estateName || data.estateCode}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,.18)', color: '#fff', fontWeight: 600 }} />
            <Chip label={`#${data.caseId}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,.14)', color: '#fff', fontFamily: '"Roboto Mono", monospace' }} />
          </Box>
        </Box>
        <CardContent sx={{ p: { xs: 2, sm: 3.5 } }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={3}>
            {data.questions.map((q, qi) => {
              const score = ratings[q.key];
              return (
                <Box key={q.key}>
                  <Typography fontWeight={600} sx={{ mb: 1 }}>
                    {qi + 1}. {q.label}
                  </Typography>
                  <ButtonGroup size="large" fullWidth>
                    {[1, 2, 3, 4, 5].map((v) => (
                      <Button
                        key={v}
                        color={v <= 2 ? 'error' : v === 3 ? 'warning' : 'success'}
                        variant={score === v ? 'contained' : 'outlined'}
                        onClick={() => {
                          setRatings((r) => ({ ...r, [q.key]: v }));
                          setError('');
                        }}
                        sx={{ flex: 1, minWidth: 0, py: 1.4, borderRadius: 0, fontSize: 15 }}
                      >
                        {v}
                      </Button>
                    ))}
                  </ButtonGroup>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8 }}>
                    {score ? RATING_HELP[lang][score - 1] : t.score}
                  </Typography>
                </Box>
              );
            })}
            <TextField
              label={t.feedback}
              placeholder={t.feedbackPh}
              multiline
              minRows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              inputProps={{ maxLength: 2000 }}
            />
            <Button
              variant="contained"
              size="large"
              disabled={busy}
              onClick={submit}
              sx={{ py: 1.5, fontSize: 16, fontWeight: 700, borderRadius: 2 }}
            >
              {busy ? '…' : t.submit}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function RowLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ display: 'flex', py: 0.6, alignItems: 'baseline' }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 110, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: mono ? '"Roboto Mono", monospace' : undefined }}>{value}</Typography>
    </Box>
  );
}

function StatusCard({ icon, title, hint, tone }: { icon: React.ReactNode; title: string; hint: string; tone: 'error' | 'success' | 'warning' }) {
  const color = tone === 'error' ? '#c62828' : tone === 'success' ? '#2e7d32' : '#ed6c02';
  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid #e3e9f2', p: { xs: 3, sm: 4 }, textAlign: 'center', boxShadow: '0 12px 40px rgba(20,60,120,.08)' }}>
      <Box sx={{ color }}>{icon}</Box>
      <Typography variant="h6" fontWeight={800} sx={{ mt: 1.2, color }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{hint}</Typography>
    </Card>
  );
}

/** 手機優先之問卷落地頁外殼：品牌區＋雙語切換＋漸變底紋，無後台導航 */
function PageShell({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: React.ReactNode }) {
  const t = T[lang];
  return (
    <Box sx={{ minHeight: '100vh', pb: 6, background: 'linear-gradient(160deg,#eef4fb 0%,#f8fafc 45%,#e8f1fa 100%)' }}>
      <Paper elevation={0} sx={{ borderRadius: 0, px: { xs: 1.5, sm: 3 }, py: 1.2, background: 'rgba(255,255,255,.75)', backdropFilter: 'blur(8px)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', maxWidth: 560, mx: 'auto' }}>
          <Box>
            <Typography sx={{ fontWeight: 800, color: '#1a5aa6', fontSize: 15 }}>{t.brand}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.sub}</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <ButtonGroup size="small" variant="outlined">
            <Button variant={lang === 'zh-Hant' ? 'contained' : 'outlined'} onClick={() => setLang('zh-Hant')} sx={{ px: 1.4 }}>繁</Button>
            <Button variant={lang === 'en' ? 'contained' : 'outlined'} onClick={() => setLang('en')} sx={{ px: 1.4 }}>EN</Button>
          </ButtonGroup>
        </Box>
      </Paper>
      <Box sx={{ maxWidth: 560, mx: 'auto', px: { xs: 1.5, sm: 2.5 }, mt: 3 }}>{children}</Box>
    </Box>
  );
}
