import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Divider, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, ListSubheader, Paper, Popover, Stack, Typography,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import AssignmentIcon from '@mui/icons-material/Assignment';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { api, ApiRequestError, authStore, NotificationItem } from '../api/client';

function fmt(iso: string): string {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(5, 16);
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  REMINDER: <NotificationsActiveIcon color="warning" fontSize="small" />,
  ESCALATION: <WarningAmberIcon color="error" fontSize="small" />,
  SURVEY: <FactCheckIcon color="success" fontSize="small" />,
  CASE: <AssignmentIcon color="primary" fontSize="small" />,
  SYSTEM: <InfoOutlinedIcon color="action" fontSize="small" />,
};

/** 頂欄通知中心（F-005 FR-005-04）：未讀徽章＋列表＋標已讀/全部已讀 */
export function NotificationCenter() {
  const navigate = useNavigate();
  const token = authStore.getToken() || '';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadUnread = () => {
    api
      .unreadNotifications(token)
      .then((d) => setUnread(d.unread))
      .catch(() => undefined);
  };

  const loadList = () => {
    setLoading(true);
    api
      .listNotifications(token, 'page=1&pageSize=20')
      .then((d) => setItems(d.items))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return undefined;
    loadUnread();
    timer.current = setInterval(loadUnread, 30000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const open = Boolean(anchor);

  const openPanel = (e: React.MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
    loadList();
  };

  const closePanel = () => setAnchor(null);

  const goCase = async (n: NotificationItem) => {
    if (!n.isRead) {
      api.markNotificationRead(n.notifId, token).catch(() => undefined);
      setUnread((u) => Math.max(0, u - 1));
      setItems((list) => list.map((x) => (x.notifId === n.notifId ? { ...x, isRead: true } : x)));
    }
    if (n.refType === 'CASE' && n.refId) {
      closePanel();
      navigate(`/admin/cases/${encodeURIComponent(n.refId)}`);
    }
  };

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead(token);
      setUnread(0);
      setItems((list) => list.map((x) => ({ ...x, isRead: true })));
    } catch (e) {
      // 忽略
      void e;
    }
  };

  return (
    <>
      <IconButton
        title="通知中心"
        onClick={openPanel}
        sx={{ mr: 0.5, color: open ? '#1a5aa6' : '#455a78' }}
      >
        <Badge badgeContent={unread} color="error" max={99}>
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={closePanel}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 380, maxWidth: '92vw', borderRadius: 2, mt: 1, boxShadow: '0 10px 40px rgba(20,40,80,.16)' } }}
      >
        <List
          dense
          subheader={
            <ListSubheader sx={{ bgcolor: 'transparent', pr: 1, py: 0.6, display: 'flex', alignItems: 'center' }}>
              <Typography fontWeight={700} sx={{ fontSize: 14 }}>通知中心</Typography>
              <Box sx={{ flex: 1 }} />
              {unread > 0 && (
                <Button size="small" startIcon={<DoneAllIcon />} onClick={markAll} sx={{ fontSize: 12 }}>
                  全部已讀
                </Button>
              )}
            </ListSubheader>
          }
          sx={{ maxHeight: 420, overflow: 'auto', pb: 1 }}
        >
          {items.length === 0 && !loading && (
            <ListItemButton disabled>
              <ListItemText secondary="暫無通知" />
            </ListItemButton>
          )}
          {items.map((n) => (
            <ListItemButton
              key={n.notifId}
              onClick={() => goCase(n)}
              sx={{ py: 0.8, '&:hover': { bgcolor: '#f2f6fc' } }}
            >
              <ListItemIcon sx={{ minWidth: 34 }}>
                {TYPE_ICON[n.notifType] || TYPE_ICON.SYSTEM}
              </ListItemIcon>
              <ListItemText
                primary={n.title}
                secondary={
                  <Box component="span" sx={{ display: 'block' }}>
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                      {n.body}
                    </Typography>
                    <Box component="span" sx={{ display: 'block', color: '#9aa4b2', fontSize: 11, mt: 0.3 }}>
                      {fmt(n.createdAt)}
                    </Box>
                  </Box>
                }
                primaryTypographyProps={{ fontWeight: n.isRead ? 400 : 700, fontSize: 13.5 }}
              />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            點擊通知可前往相關個案
          </Typography>
        </Box>
      </Popover>
    </>
  );
}
