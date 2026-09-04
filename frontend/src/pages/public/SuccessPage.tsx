import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, Container, Divider, Stack, Typography, useTheme } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { translate, Lang } from '../../i18n/dict';

interface SuccessState {
  lang: Lang;
  caseId: string;
  estateName: string;
  categoryLabels: string[];
  contentPreview: string;
  message: string;
  isDuplicate: boolean;
}

export function SuccessPage() {
  const { state } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const s = state as SuccessState | null;
  const lang: Lang = s?.lang || 'zh-Hant';
  const caseId = s?.caseId || params.get('caseId') || '';
  const estateName = s?.estateName || params.get('estate') || '';
  const isDuplicate = Boolean(s?.isDuplicate);
  const primary = theme.palette.primary.main;

  const copy = () => {
    if (caseId) {
      void navigator.clipboard.writeText(caseId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Container maxWidth="sm">
        <Stack alignItems="center" sx={{ mb: 2 }}>
          <Box component="img" src="/logo.png" alt="CRLPM" sx={{ height: 64, width: 'auto' }} />
        </Stack>
        <Card elevation={2} sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ bgcolor: primary, color: '#fff', p: 3, textAlign: 'center' }}>
            <CheckCircleOutlineIcon sx={{ fontSize: 56 }} />
            <Typography variant="h5" sx={{ mt: 1 }}>
              {translate(lang, 'success.title')}
            </Typography>
          </Box>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={2} alignItems="center" textAlign="center">
              <Typography color="text.secondary">
                {isDuplicate ? translate(lang, 'success.duplicateNote') : (s?.message || '')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#eaf1f9', px: 2, py: 1, borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {translate(lang, 'success.caseNo')}
                </Typography>
                <Typography
                  sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: 22, fontWeight: 700, color: primary }}
                >
                  {caseId}
                </Typography>
                <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>
                  {copied ? translate(lang, 'success.copied') : translate(lang, 'success.copy')}
                </Button>
              </Box>
              {(s?.categoryLabels?.length || s?.contentPreview) && (
                <>
                  <Divider sx={{ width: '100%' }} />
                  <Box width="100%" textAlign="left">
                    {s?.categoryLabels?.length ? (
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                        {s.categoryLabels.map((c) => (
                          <Chip key={c} label={c} size="small" />
                        ))}
                      </Stack>
                    ) : null}
                    {s?.contentPreview ? (
                      <Typography variant="body2" color="text.secondary">
                        {s.contentPreview}
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                      {estateName}
                    </Typography>
                  </Box>
                </>
              )}
              <Button variant="contained" onClick={() => navigate('/')} sx={{ mt: 1 }}>
                {translate(lang, 'success.back')}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
