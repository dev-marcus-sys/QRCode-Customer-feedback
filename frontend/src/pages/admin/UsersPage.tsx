/**
 * F-010 用戶管理（/admin/users；user:list 可看，其餘操作依權限顯示）。
 * 對應 docs/F010_細部設計.md。骨架含：列表/篩選、新增、修改、停用（軟刪）、
 * 重設為一次性密碼、鎖定/解鎖，以及權限不足的防呆提示。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, IconButton, Menu, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import LockResetIcon from '@mui/icons-material/LockReset';
import {
  ApiRequestError, authStore, PermissionRow, RoleRow, UserRow, api,
} from '../../api/client';
import { NotificationCenter } from '../../components/NotificationCenter';
import AdminNav from '../../admin/AdminNav';

const ESTATE_OPTIONS = [
  { code: 'ALL', zh: '全屋苑（ALL）' },
  { code: 'CWC', zh: '灣景中心（CWC）' },
  { code: 'YPR', zh: '攸壆路（YPR）' },
  { code: 'CHNG', zh: '頌雅苑（CHNG）' },
  { code: 'DAHF', zh: '大夫第（DAHF）' },
];

export function UsersPage() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const perms = user?.permissions || [];
  const canView = perms.includes('user:list');
  const canCreate = perms.includes('user:create');
  const canUpdate = perms.includes('user:update');
  const canDisable = perms.includes('user:disable');
  const canReset = perms.includes('user:reset_pwd');
  const canLock = perms.includes('user:lock');

  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [keyword, setKeyword] = useState('');
  const [estate, setEstate] = useState('');
  const [active, setActive] = useState('1');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({
    username: '', fullName: '', email: '', phone: '', estateCode: 'ALL', roles: [] as string[], password: '',
  });
  const [saving, setSaving] = useState(false);

  const [resetDlg, setResetDlg] = useState<{ username: string; temp: string } | null>(null);
  const [confirm, setConfirm] = useState<{ userId: number; username: string; disable: boolean } | null>(null);
  const [menuFor, setMenuFor] = useState<{ userId: number; anchor: HTMLElement } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (estate) params.set('estate', estate);
    if (active) params.set('active', active);
    Promise.all([
      api.listUsers(params.toString(), token),
      api.listRoles(token).catch(() => ({ roles: [] as RoleRow[], permissions: [] as PermissionRow[] })),
    ])
      .then(([u, r]) => {
        setRows(u.items);
        setTotal(u.total);
        setRoles(r.roles);
      })
      .catch((e) => {
        setError(e instanceof ApiRequestError ? e.message : '載入失敗');
        if (e instanceof ApiRequestError && (e.code === 2001 || e.code === 2005)) {
          authStore.clear();
          navigate('/admin/login', { replace: true });
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, keyword, estate, active]);

  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar><Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button></Toolbar>
        <Alert severity="warning">當前帳號沒有 user:list 權限，無法查看用戶。</Alert>
      </Box>
    );
  }

  const logout = () => { authStore.clear(); navigate('/admin/login', { replace: true }); };

  const openCreate = () => {
    setEditing(null);
    setForm({ username: '', fullName: '', email: '', phone: '', estateCode: 'ALL', roles: [], password: '' });
    setEditOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({
      username: u.username,
      fullName: u.fullName,
      email: u.email || '',
      phone: u.phone || '',
      estateCode: u.estateCode,
      roles: u.roles.map((r) => r.code),
      password: '',
    });
    setEditOpen(true);
  };

  const save = () => {
    setSaving(true);
    setError('');
    const body: Record<string, unknown> = {
      fullName: form.fullName, email: form.email || undefined, phone: form.phone || undefined,
      estateCode: form.estateCode, roles: form.roles,
    };
    if (!editing && form.password) body.password = form.password;
    const p = editing
      ? api.updateUser(editing.userId, body, token)
      : api.createUser(body, token);
    p.then(() => { setToast(editing ? '已更新用戶' : '已新增用戶'); setEditOpen(false); return load(); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '儲存失敗'))
      .finally(() => setSaving(false));
  };

  const doReset = (userId: number) => {
    setMenuFor(null);
    api.resetUserPassword(userId, token)
      .then((d) => setResetDlg({ username: rows.find((r) => r.userId === userId)?.username || '', temp: d.tempPassword }))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '重設失敗'));
  };

  const doLock = (userId: number, lock: boolean) => {
    setMenuFor(null);
    const p = lock ? api.lockUser(userId, token) : api.unlockUser(userId, token);
    p.then(() => load()).catch((e) => setError(e instanceof ApiRequestError ? e.message : '操作失敗'));
  };

  const doDisable = () => {
    if (!confirm) return;
    api.disableUser(confirm.userId, token)
      .then(() => { setToast(confirm.disable ? '已停用用戶' : '已啟用用戶'); setConfirm(null); return load(); })
      .catch((e) => { setError(e instanceof ApiRequestError ? e.message : '操作失敗'); setConfirm(null); });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', borderBottom: '1px solid #e5eaf2' }}>
        <IconButton title="返回個案列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1 }}>用戶管理</Typography>
        <Box sx={{ flex: 1 }} />
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        <AdminNav current="users" />

        <Stack direction="row" spacing={1} sx={{ mb: 2, mt: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" label="關鍵字" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} placeholder="帳號/姓名/Email" sx={{ minWidth: 180 }} />
          <TextField size="small" select label="屋苑" value={estate} onChange={(e) => setEstate(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">全部</MenuItem>
            {ESTATE_OPTIONS.map((o) => <MenuItem key={o.code} value={o.code}>{o.zh}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="狀態" value={active} onChange={(e) => setActive(e.target.value)} sx={{ minWidth: 120 }}>
            <MenuItem value="">全部</MenuItem>
            <MenuItem value="1">啟用</MenuItem>
            <MenuItem value="0">停用</MenuItem>
          </TextField>
          <Box sx={{ flex: 1 }} />
          {canCreate && (
            <Button size="small" variant="contained" startIcon={<PersonAddIcon />} onClick={openCreate}>新增用戶</Button>
          )}
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
        ) : (
          <TableContainer sx={{ bgcolor: '#fff', borderRadius: 2, border: '1px solid #e5eaf2' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                  <TableCell sx={{ fontWeight: 600 }}>帳號</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>姓名</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>屋苑</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>角色</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>最後登入</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 60 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.userId} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{u.username}</TableCell>
                    <TableCell>{u.fullName}</TableCell>
                    <TableCell>{u.estateCode}</TableCell>
                    <TableCell>{u.roles.map((r) => <Chip key={r.code} size="small" label={r.name} sx={{ mr: 0.5 }} />)}</TableCell>
                    <TableCell>
                      {u.isActive ? <Chip size="small" color="success" label="啟用" /> : <Chip size="small" label="停用" />}
                      {u.mustChangePwd ? <Chip size="small" color="warning" label="需改密" sx={{ ml: 0.5 }} /> : null}
                      {u.lockedUntil ? <Chip size="small" color="error" label="鎖定" sx={{ ml: 0.5 }} /> : null}
                    </TableCell>
                    <TableCell><Typography variant="caption">{u.lastLoginAt || '—'}</Typography></TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={(e) => setMenuFor({ userId: u.userId, anchor: e.currentTarget })}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', color: '#999', py: 3 }}>暫無用戶</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          共 {total} 筆
        </Typography>
      </Box>

      <Menu anchorEl={menuFor?.anchor} open={!!menuFor} onClose={() => setMenuFor(null)}>
        {canUpdate && <MenuItem onClick={() => { const u = rows.find((r) => r.userId === menuFor?.userId); if (u) openEdit(u); }}>修改</MenuItem>}
        {canReset && <MenuItem onClick={() => menuFor && doReset(menuFor.userId)}><LockResetIcon fontSize="small" style={{ marginRight: 8 }} />重設密碼</MenuItem>}
        {canLock && <MenuItem onClick={() => menuFor && doLock(menuFor.userId, !rows.find((r) => r.userId === menuFor?.userId)?.lockedUntil)}>
          {menuFor && rows.find((r) => r.userId === menuFor.userId)?.lockedUntil ? '解鎖' : '鎖定'}
        </MenuItem>}
        {canDisable && (
          <MenuItem onClick={() => { const u = rows.find((r) => r.userId === menuFor?.userId); if (u && menuFor) setConfirm({ userId: u.userId, username: u.username, disable: u.isActive === 1 }); }}>
            {menuFor && rows.find((r) => r.userId === menuFor.userId)?.isActive ? '停用' : '啟用'}
          </MenuItem>
        )}
      </Menu>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `修改用戶 ${editing.username}` : '新增用戶'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField size="small" label="登入帳號" value={form.username} disabled={!!editing}
              onChange={(e) => setForm({ ...form, username: e.target.value })} fullWidth />
            <TextField size="small" label="姓名" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} fullWidth />
            <TextField size="small" label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth />
            <TextField size="small" label="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth />
            <TextField size="small" select label="所屬屋苑" value={form.estateCode} onChange={(e) => setForm({ ...form, estateCode: e.target.value })} fullWidth>
              {ESTATE_OPTIONS.map((o) => <MenuItem key={o.code} value={o.code}>{o.zh}</MenuItem>)}
            </TextField>
            <TextField size="small" select label="角色（可多選）" SelectProps={{ multiple: true }} value={form.roles}
              onChange={(e) => setForm({ ...form, roles: e.target.value as unknown as string[] })} fullWidth
              helperText="角色決定該用戶的權限集合">
              {roles.map((r) => <MenuItem key={r.roleCode} value={r.roleCode}>{r.roleName}（{r.roleCode}）</MenuItem>)}
            </TextField>
            {!editing && (
              <TextField size="small" label="初始密碼（留空則產生一次性密碼並要求首登改密）"
                type="password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth
                helperText="若填寫須 ≥8 位且含大小寫字母與數字" />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button variant="contained" disabled={saving} onClick={save}>{saving ? '儲存中…' : '儲存'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!resetDlg} onClose={() => setResetDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle>密碼已重設</DialogTitle>
        <DialogContent dividers>
          <DialogContentText>
            用戶 <strong>{resetDlg?.username}</strong> 的一次性密碼如下，請盡速轉交並要求其首次登入後變更：
          </DialogContentText>
          <Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 18, fontWeight: 700, color: '#1a5aa6', my: 1 }}>
            {resetDlg?.temp}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setResetDlg(null)}>知道了</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm?.disable ? '停用用戶' : '啟用用戶'}</DialogTitle>
        <DialogContent dividers>
          <DialogContentText>
            確定要{confirm?.disable ? '停用' : '啟用'}用戶 <strong>{confirm?.username}</strong> 嗎？停用為軟刪除（仍可復原）。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button variant="contained" color={confirm?.disable ? 'warning' : 'success'} onClick={doDisable}>確定</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}
