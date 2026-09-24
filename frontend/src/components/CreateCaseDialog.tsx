/**
 * 新增個案對話框（共用：後台與手機版）。
 * 對應後端 POST /cases（case:create）。權限由父層按鈕決定是否顯示。
 */
import { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Stack, TextField,
} from '@mui/material';
import { api, ApiRequestError, authStore, CreateCasePayload } from '../api/client';
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from '../admin/options';
import { useEstates } from '../admin/useEstates';

const TITLE_OPTIONS = ['先生', '女士', '小姐', '其他'];

function Row({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      {Array.isArray(children) ? children.map((c, i) => <Box key={i} sx={{ flex: 1 }}>{c}</Box>) : <Box sx={{ flex: 1 }}>{children}</Box>}
    </Stack>
  );
}

export function CreateCaseDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (caseId: string) => void;
}) {
  const token = authStore.getToken() || '';
  const user = authStore.getUser();
  const estates = useEstates();
  const scopeCodes = user && user.estateCodes && user.estateCodes.length && !user.estateCodes.includes('ALL')
    ? user.estateCodes : null;

  const [estate, setEstate] = useState('');
  const [title, setTitle] = useState('先生');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [block, setBlock] = useState('');
  const [floor, setFloor] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentTime, setIncidentTime] = useState('');
  const [content, setContent] = useState('');
  const [surveyConsent, setSurveyConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const estateOptions = scopeCodes
    ? scopeCodes.map((c) => ({ code: c, zh: estates.nameOf(c) }))
    : estates.activeOptions.map((x) => ({ code: x.estateCode, zh: x.estateNameZh }));

  const reset = () => {
    setEstate(scopeCodes && scopeCodes.length === 1 ? scopeCodes[0] : '');
    setTitle('先生'); setName(''); setEmail(''); setPhone('');
    setBlock(''); setFloor(''); setUnit(''); setCategory(''); setPriority('MEDIUM');
    setIncidentDate(''); setIncidentTime(''); setContent(''); setSurveyConsent(false);
    setErrors({}); setError('');
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = () => {
    const errs: Record<string, string> = {};
    const effEstate = scopeCodes ? (estate || scopeCodes[0]) : estate;
    if (!effEstate) errs.estate = '請選擇屋苑';
    if (!name.trim()) errs.name = '請填寫客戶姓名';
    if (!category) errs.category = '請選擇意見類別';
    if (!content.trim()) errs.content = '請填寫內容';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = '電郵格式不正確';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body: CreateCasePayload = {
      estate: effEstate,
      title,
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      block: block.trim() || undefined,
      floor: floor.trim() || undefined,
      unit: unit.trim() || undefined,
      category,
      priority,
      incidentDate: incidentDate || undefined,
      incidentTime: incidentTime || undefined,
      content: content.trim(),
      surveyConsent,
    };
    setSubmitting(true);
    setError('');
    api.createCase(body, token)
      .then((r) => { reset(); onCreated(r.caseId); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '新增失敗'))
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>新增個案</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Row>
            <TextField
              select fullWidth required label="屋苑" size="small"
              value={scopeCodes ? (estate || scopeCodes[0]) : estate}
              onChange={(e) => setEstate(e.target.value)}
              error={!!errors.estate} helperText={errors.estate}
              disabled={!!scopeCodes && scopeCodes.length <= 1}
            >
              {estateOptions.map((x) => (<MenuItem key={x.code} value={x.code}>{x.zh}</MenuItem>))}
            </TextField>
            <TextField select fullWidth label="稱呼" size="small" value={title} onChange={(e) => setTitle(e.target.value)}>
              {TITLE_OPTIONS.map((t) => (<MenuItem key={t} value={t}>{t}</MenuItem>))}
            </TextField>
          </Row>

          <Row>
            <TextField fullWidth required label="客戶姓名" size="small" value={name}
              onChange={(e) => setName(e.target.value)} error={!!errors.name} helperText={errors.name} />
            <TextField fullWidth label="電郵" size="small" value={email} type="email"
              onChange={(e) => setEmail(e.target.value)} error={!!errors.email} helperText={errors.email} />
          </Row>

          <Row>
            <TextField fullWidth label="電話" size="small" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <TextField fullWidth label="意見類別" select required size="small" value={category}
              onChange={(e) => setCategory(e.target.value)} error={!!errors.category} helperText={errors.category}>
              {CATEGORY_OPTIONS.map((o) => (<MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>))}
            </TextField>
          </Row>

          <Row>
            <TextField fullWidth label="座" size="small" value={block} onChange={(e) => setBlock(e.target.value)} />
            <TextField fullWidth label="層" size="small" value={floor} onChange={(e) => setFloor(e.target.value)} />
            <TextField fullWidth label="室" size="small" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Row>

          <Row>
            <TextField fullWidth label="優先級" select size="small" value={priority} onChange={(e) => setPriority(e.target.value as 'HIGH' | 'MEDIUM' | 'LOW')}>
              {PRIORITY_OPTIONS.map((o) => (<MenuItem key={o.code} value={o.code}>{o.labelZh}</MenuItem>))}
            </TextField>
            <TextField fullWidth label="發生日期" type="date" size="small" value={incidentDate}
              onChange={(e) => setIncidentDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Row>

          <TextField fullWidth label="發生時間" type="time" size="small" value={incidentTime}
            onChange={(e) => setIncidentTime(e.target.value)} InputLabelProps={{ shrink: true }} />

          <TextField fullWidth required multiline minRows={3} label="內容" size="small" value={content}
            onChange={(e) => setContent(e.target.value)} error={!!errors.content} helperText={errors.content} />

          <FormControlLabel control={
            <Checkbox checked={surveyConsent} onChange={(e) => setSurveyConsent(e.target.checked)} />
          } label="客戶同意發送滿意度調查" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '建立中…' : '建立個案'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
