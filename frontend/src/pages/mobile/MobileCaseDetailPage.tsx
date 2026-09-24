import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Chip, Divider, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api, ApiRequestError, authStore, CaseDetailData, CaseItem } from '../../api/client';
import { useAiFeatures, featureOn } from '../../aiFeatures';
import {
  CATEGORY_OPTIONS, EVENT_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS, labelOf,
} from '../../admin/options';
import { StatusChip } from '../../components/StatusChip';
import { ActionArea } from '../../components/ActionArea';
import { CaseAttachments, AttachmentMeta } from '../../components/CaseAttachments';
import { SurveyStatusCard } from '../../components/SurveyStatusCard';
import { AiSuggestionsCard } from '../../components/AiSuggestionsCard';
import { AiAssigneeCard } from '../../components/AiAssigneeCard';
import { AiDraftCard } from '../../components/AiDraftCard';
import { SectionCard, fmt } from '../../mobile/MobileParts';

const LOG_TYPE_ZH: Record<string, string> = {
  CREATE: '建立個案', ASSIGN: '分派', REASSIGN: '轉派', UPDATE: '更新',
  STATUS_CHANGE: '狀態變更', RESPONSE: '首次回應', NOTE: '跟進紀錄',
  RESOLVE_REQUEST: '完結申請', RESOLVE_APPROVE: '審核通過', RESOLVE_REJECT: '審核駁回',
  CLOSE: '關閉', REOPEN: '重開', ESCALATE: '升級', REMINDER: '提醒',
  UPLOAD: '附件', OTHER: '其他',
};
const LOG_DOT_COLOR: Record<string, string> = {
  CREATE: '#1a5aa6', RESPONSE: '#2e7d32', ASSIGN: '#1565c0', REASSIGN: '#4c8fd6',
  CLOSE: '#2e7d32', REOPEN: '#b71c1c', ESCALATE: '#d32f2f', REMINDER: '#ed6c02',
  NOTE: '#6b7280', UPDATE: '#6b7280', STATUS_CHANGE: '#6b7280',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', py: 0.6, borderBottom: '1px dashed #edf0f5', '&:last-child': { borderBottom: 0 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 96, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{value}</Box>
    </Box>
  );
}

/** 手機版個案詳情 /m/cases/:caseId：單欄、時間軸、狀態操作。 */
export function MobileCaseDetailPage() {
  const rawCaseId = useParams().caseId;
  const caseId = rawCaseId ? decodeURIComponent(rawCaseId) : undefined;
  const navigate = useNavigate();
  const me = authStore.getUser();
  const permissions = me?.permissions || [];
  const { features } = useAiFeatures();
  const showSuggestions = featureOn(features, 'classify') || featureOn(features, 'similar');
  const showAssign = featureOn(features, 'assign');
  const showDraft = featureOn(features, 'draft');

  const [detail, setDetail] = useState<CaseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    setLoading(true);
    api
      .caseDetail(caseId, authStore.getToken() || '')
      .then((d) => alive && setDetail(d))
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
  }, [caseId]);

  const refresh = () => {
    if (!caseId) return;
    api.caseDetail(caseId, authStore.getToken() || '').then(setDetail).catch(() => undefined);
  };
  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 6000);
    refresh();
  };

  if (loading) {
    return <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>載入中…</Typography>;
  }
  if (error || !detail) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>{error || '個案不存在'}</Alert>
        <Chip label="返回清單" icon={<ArrowBackIcon />} onClick={() => navigate('/m/cases')} />
      </Box>
    );
  }

  const c: CaseItem = detail.case;
  const address = [c.address.block ? `${c.address.block}座` : '', c.address.floor, c.address.unit].filter(Boolean).join(' ');
  const canUpdate = permissions.includes('case:update');
  const canAssign = permissions.includes('case:assign');
  const canReview = permissions.includes('case:review');
  const attachments: AttachmentMeta[] = detail.timeline
    .filter((t) => t.logType === 'UPLOAD' && t.attachmentId != null)
    .map((t) => ({ attachmentId: t.attachmentId as number, attachmentName: t.attachmentName || '附件', attachmentSize: t.attachmentSize ?? null }));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
        <Chip label="返回" icon={<ArrowBackIcon />} onClick={() => navigate('/m/cases')} sx={{ mr: 1 }} />
        <Typography sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: 15, fontWeight: 700, color: '#1a5aa6' }}>
          {c.caseId}
        </Typography>
        <Box sx={{ ml: 1 }}><StatusChip status={c.caseStatus} lang="zh-Hant" /></Box>
      </Box>

      {toast && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setToast('')}>{toast}</Alert>}

      <SectionCard
        title="意見內容"
        right={(
          <Stack direction="row" spacing={0.5}>
            <Chip size="small" label={labelOf(CATEGORY_OPTIONS, c.categoryCode, 'zh-Hant')} />
            <Chip size="small" label={`事件：${labelOf(EVENT_OPTIONS, c.eventType, 'zh-Hant')}`} color={c.eventType === 'URGENT' ? 'error' : 'default'} variant="outlined" />
            <Chip size="small" label={`優先：${labelOf(PRIORITY_OPTIONS, c.priority, 'zh-Hant')}`} variant="outlined" />
          </Stack>
        )}
      >
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{c.commentContent}</Typography>
        {c.resolutionSummary && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" color="text.secondary">結案摘要</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{c.resolutionSummary}</Typography>
          </>
        )}
        {c.isSecondComplaint && c.originalCaseId && (
          <Alert severity="warning" sx={{ mt: 2, fontSize: 13 }}>
            此為二次投訴個案，原案：{c.originalCaseId}
          </Alert>
        )}
      </SectionCard>

      <SectionCard title="客戶資料">
        <InfoRow label="姓名" value={`${c.customerTitle || ''} ${c.customerName}`} />
        <InfoRow label="電郵" value={c.customerEmail || '—'} />
        <InfoRow label="電話" value={c.customerPhone || '—'} />
        <InfoRow label="地址" value={address || '—'} />
        <InfoRow label="事發時間" value={`${c.incidentDate}${c.incidentTime ? ' ' + c.incidentTime : ''}`} />
        <InfoRow label="滿意度同意" value={c.satisfactionConsent ? '願意接受調查' : '不願意'} />
        <InfoRow label="提交時間" value={fmt(c.createdAt)} />
        <InfoRow label="處理人" value={c.assignedTo?.fullName || '尚未分派'} />
      </SectionCard>

      <SectionCard title="SLA 時限" right={c.slaOverdue ? <Chip size="small" color="error" label="已逾期" /> : undefined}>
        <InfoRow label="事件類型" value={labelOf(EVENT_OPTIONS, c.eventType, 'zh-Hant')} />
        <InfoRow label="首應期限" value={fmt(c.responseSlaDue)} />
        <InfoRow label="首應時間" value={fmt(c.firstResponseAt || null)} />
        <InfoRow label="關閉期限" value={fmt(c.closureSlaDue)} />
        <InfoRow label="處理天數" value={c.handlingDays != null ? `${c.handlingDays} 天` : '—'} />
      </SectionCard>

      <SectionCard title="動作區">
        <ActionArea caseId={c.caseId} caseStatus={c.caseStatus} actions={detail.allowedActions} permissions={permissions} onDone={notify} />
      </SectionCard>

      {showSuggestions && (
        <AiSuggestionsCard caseId={c.caseId} canUpdate={canUpdate} caseClosed={c.caseStatus === 'CLOSED'} onChanged={refresh} onMessage={notify} />
      )}
      {showAssign && (
        <AiAssigneeCard caseId={c.caseId} canAssign={canAssign} caseClosed={c.caseStatus === 'CLOSED'} caseStatus={c.caseStatus} onChanged={refresh} onMessage={notify} />
      )}
      {showDraft && (
        <AiDraftCard caseId={c.caseId} canUpdate={canUpdate} caseClosed={c.caseStatus === 'CLOSED'} onChanged={refresh} onMessage={notify} />
      )}

      <SectionCard title="附件" right={<Chip size="small" label={`${attachments.length} 個`} variant="outlined" />}>
        <CaseAttachments
          caseId={c.caseId}
          items={attachments}
          canManage={canUpdate && ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'REOPENED'].includes(c.caseStatus)}
          canAnalyze={canUpdate}
          onChanged={notify}
        />
      </SectionCard>

      <SectionCard title="滿意度調查" right={detail.survey && <Chip size="small" label={`#${detail.survey.surveyId}`} variant="outlined" />}>
        <SurveyStatusCard survey={detail.survey} canResend={canReview} onMessage={notify} />
      </SectionCard>

      <SectionCard title="處理時間軸" right={<Chip size="small" label={`${detail.timeline.length} 筆`} variant="outlined" />}>
        {detail.timeline.length === 0 && <Typography color="text.secondary" variant="body2">暫無紀錄</Typography>}
        {detail.timeline.map((item, i) => {
          const last = i === detail.timeline.length - 1;
          const color = LOG_DOT_COLOR[item.logType] || '#6b7280';
          return (
            <Box key={item.logId} sx={{ display: 'flex', gap: 1.5 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, border: '2px solid #fff', boxShadow: `0 0 0 2px ${color}55`, mt: 0.4 }} />
                {!last && <Box sx={{ width: 2, flex: 1, bgcolor: '#e2e8f0' }} />}
              </Box>
              <Box sx={{ pb: 2.2, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontSize: 13 }}>
                  {LOG_TYPE_ZH[item.logType] || item.logType}
                  {item.newStatus && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}> → {labelOf(STATUS_OPTIONS, item.newStatus, 'zh-Hant')}</Box>}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>{item.logContent}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                  {item.actionByName} · {fmt(item.actionAt)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </SectionCard>
    </Box>
  );
}
