import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
  IconButton, Stack, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api, ApiRequestError, authStore, CaseDetailData, CaseItem } from '../../api/client';
import {
  CATEGORY_OPTIONS, EVENT_OPTIONS, PRIORITY_OPTIONS, labelOf, STATUS_OPTIONS,
} from '../../admin/options';
import { StatusChip } from '../../components/StatusChip';
import { ActionArea } from '../../components/ActionArea';
import { CaseAttachments, AttachmentMeta } from '../../components/CaseAttachments';
import { SurveyStatusCard } from '../../components/SurveyStatusCard';
import { AiSuggestionsCard } from '../../components/AiSuggestionsCard';
import { NotificationCenter } from '../../components/NotificationCenter';

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

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', py: 0.6, borderBottom: '1px dashed #edf0f5', '&:last-child': { borderBottom: 0 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 96, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ flex: 1 }}>{value}</Box>
    </Box>
  );
}

function SectionCard({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #e5eaf2', mb: 2 }}>
      <Box sx={{ px: 2.5, py: 1.6, display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6' }}>
        <Typography fontWeight={600}>{title}</Typography>
        <Box sx={{ flex: 1 }} />
        {extra}
      </Box>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function CaseDetailPage() {
  // 案號含 "/"（如 SMS/SR/CHNG/260903001），路由參數可能保留 %2F 編碼，需先解碼
  const rawCaseId = useParams().caseId;
  const caseId = rawCaseId ? decodeURIComponent(rawCaseId) : undefined;
  const navigate = useNavigate();
  const me = authStore.getUser();
  const permissions = me?.permissions || [];
  const [detail, setDetail] = useState<CaseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string>('');

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
            navigate('/admin/login', { replace: true });
          }
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [caseId, navigate]);

  const refresh = () => {
    if (!caseId) return;
    api
      .caseDetail(caseId, authStore.getToken() || '')
      .then((d) => setDetail(d))
      .catch(() => undefined);
  };

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 6000);
    refresh();
  };

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !detail) {
    return (
      <Box sx={{ minHeight: '100vh', p: 3 }}>
        <Toolbar>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回列表</Button>
        </Toolbar>
        <Alert severity="error">{error || '個案不存在'}</Alert>
      </Box>
    );
  }

  const c: CaseItem = detail.case;
  const address = [c.address.block ? `${c.address.block}座` : '', c.address.floor, c.address.unit]
    .filter(Boolean)
    .join(' ');
  const canReview = permissions.includes('case:review');
  const canUpdate = permissions.includes('case:update');
  const attachments: AttachmentMeta[] = detail.timeline
    .filter((t) => t.logType === 'UPLOAD' && t.attachmentId != null)
    .map((t) => ({ attachmentId: t.attachmentId as number, attachmentName: t.attachmentName || '附件', attachmentSize: t.attachmentSize ?? null }));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar
        sx={{
          position: 'sticky', top: 0, zIndex: 20, bgcolor: '#fff',
          borderBottom: '1px solid #e5eaf2', boxShadow: '0 1px 3px rgba(15,40,80,.06)',
        }}
      >
        <IconButton title="返回列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Box sx={{ ml: 1, fontFamily: '"Roboto Mono", monospace', fontSize: 16, fontWeight: 700, color: '#1a5aa6' }}>
          {c.caseId}
        </Box>
        <Box sx={{ ml: 1.5 }}><StatusChip status={c.caseStatus} lang="zh-Hant" /></Box>
        <Box sx={{ flex: 1 }} />
        <NotificationCenter />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {c.estateNameZh} · {c.caseSource} 管道
        </Typography>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        {toast && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setToast('')}>{toast}</Alert>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
          <Box sx={{ flex: 3, minWidth: 0 }}>
            <SectionCard
              title="意見內容"
              extra={
                <Stack direction="row" spacing={1}>
                  <Chip size="small" label={labelOf(CATEGORY_OPTIONS, c.categoryCode, 'zh-Hant')} />
                  <Chip size="small" label={`事件：${labelOf(EVENT_OPTIONS, c.eventType, 'zh-Hant')}`} color={c.eventType === 'URGENT' ? 'error' : 'default'} variant="outlined" />
                  <Chip size="small" label={`優先級：${labelOf(PRIORITY_OPTIONS, c.priority, 'zh-Hant')}`} variant="outlined" />
                </Stack>
              }
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
                  此為二次投訴個案，原案：
                  <Link to={`/admin/cases/${encodeURIComponent(c.originalCaseId)}`} style={{ marginLeft: 4 }}>
                    {c.originalCaseId}
                  </Link>
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

            <SectionCard title="SLA 時限" extra={c.slaOverdue && <Chip size="small" color="error" label="已逾期" />}>
              <InfoRow label="事件類型" value={labelOf(EVENT_OPTIONS, c.eventType, 'zh-Hant')} />
              <InfoRow label="首次回應期限" value={fmt(c.responseSlaDue)} />
              <InfoRow label="首次回應時間" value={fmt(c.firstResponseAt || null)} />
              <InfoRow label="關閉期限" value={fmt(c.closureSlaDue)} />
              <InfoRow label="處理天數" value={c.handlingDays != null ? `${c.handlingDays} 天` : '—'} />
              {c.eventType === 'N/A' && (
                <InfoRow label="備註" value="此個案不適用回覆期限（N/A）" />
              )}
            </SectionCard>
          </Box>

          <Box sx={{ flex: 2, minWidth: 0 }}>
            {/* 操作區（F-004 / F-006） */}
            <SectionCard title="動作區">
              {detail.allowedActions.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>目前狀態無可執行動作。</Typography>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  動作會寫入時間軸並通知相關人員，紀錄不可修改或刪除。
                </Typography>
              )}
              <ActionArea
                caseId={c.caseId}
                caseStatus={c.caseStatus}
                actions={detail.allowedActions}
                permissions={permissions}
                onDone={notify}
              />
            </SectionCard>

            {/* AI 建議（M0 / AI-01 內容分類影子模式；docs/AI_利用方案.md §7.1） */}
            <AiSuggestionsCard
              caseId={c.caseId}
              canUpdate={canUpdate}
              caseClosed={c.caseStatus === 'CLOSED'}
              onChanged={refresh}
              onMessage={notify}
            />

            {/* 附件（F-004 FR-004-08） */}
            <SectionCard title="附件" extra={<Chip size="small" label={`${attachments.length} 個檔案`} variant="outlined" />}>
              <CaseAttachments
                caseId={c.caseId}
                items={attachments}
                canManage={canUpdate && ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'REOPENED'].includes(c.caseStatus)}
                onChanged={notify}
              />
            </SectionCard>

            {/* 滿意度調查（F-007） */}
            <SectionCard title="滿意度調查" extra={detail.survey && <Chip size="small" label={`#${detail.survey.surveyId}`} variant="outlined" />}>
              <SurveyStatusCard
                survey={detail.survey}
                canResend={canReview}
                onMessage={notify}
              />
            </SectionCard>

            {/* 時間軸 */}
            <SectionCard
              title="處理時間軸"
              extra={<Chip size="small" label={`${detail.timeline.length} 筆紀錄（不可修改）`} variant="outlined" />}
            >
              {detail.timeline.length === 0 && (
                <Typography color="text.secondary" variant="body2">暫無紀錄</Typography>
              )}
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
                        {item.newStatus && (
                          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                            {' '}→ {labelOf(STATUS_OPTIONS, item.newStatus, 'zh-Hant')}
                          </Box>
                        )}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                        {item.logContent}
                        {item.attachmentName && (
                          <Box component="span" sx={{ display: 'block', color: '#1a5aa6', mt: 0.3 }}>
                            附件：{item.attachmentName}
                          </Box>
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                        {item.actionByName} · {fmt(item.actionAt)}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </SectionCard>
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
