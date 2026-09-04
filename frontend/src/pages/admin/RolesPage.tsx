/**
 * F-010 角色與權限管理（/admin/roles；role:list 可看，role:manage 可維護）。
 * 對應 docs/F010_細部設計.md。骨架含：角色列表、細粒度權限綁定（模組/操作/數據範圍三層）、
 * 角色複製（FR-010-07）、停用（軟刪）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle,   IconButton, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  ApiRequestError, authStore, PermissionRow, RoleRow, api,
} from '../../api/client';
import { NotificationCenter } from '../../components/NotificationCenter';
import AdminNav from '../../admin/AdminNav';

export function RolesPage() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const perms = user?.permissions || [];
  const canView = perms.includes('role:list');
  const canManage = perms.includes('role:manage');

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [catalog, setCatalog] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form, setForm] = useState({
    roleCode: '', roleName: '', dataScope: 'ALL', permissions: [] as string[],
  });
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [copyCode, setCopyCode] = useState('');
  const [copyName, setCopyName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.listRoles(token)
      .then((d) => { setRoles(d.roles); setCatalog(d.permissions); })
      .catch((e) => {
        setError(e instanceof ApiRequestError ? e.message : '載入失敗');
        if (e instanceof ApiRequestError && (e.code === 2001 || e.code === 2005)) { authStore.clear(); navigate('/admin/login', { replace: true }); }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar><Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')}>返回個案列表</Button></Toolbar>
        <Alert severity="warning">當前帳號沒有 role:list 權限，無法查看角色。</Alert>
      </Box>
    );
  }

  const logout = () => { authStore.clear(); navigate('/admin/login', { replace: true }); };

  const openCreate = () => {
    setEditing(null);
    setForm({ roleCode: '', roleName: '', dataScope: 'ALL', permissions: [] });
    setEditOpen(true);
  };

  const openEdit = (r: RoleRow) => {
    setEditing(r);
    setForm({ roleCode: r.roleCode, roleName: r.roleName, dataScope: r.dataScope, permissions: r.permissions.map((p) => p.code) });
    setEditOpen(true);
  };

  const openCopy = (r: RoleRow) => {
    setCopyFrom(r.roleCode);
    setCopyCode(`${r.roleCode}_COPY`);
    setCopyName(`${r.roleName}（副本）`);
    setCopyOpen(true);
  };

  const save = () => {
    setSaving(true);
    setError('');
    const body = { roleName: form.roleName, dataScope: form.dataScope, permissions: form.permissions };
    const p = editing ? api.updateRole(editing.roleCode, body, token) : api.createRole({ ...body, roleCode: form.roleCode }, token);
    p.then(() => { setToast(editing ? '已更新角色' : '已新增角色'); setEditOpen(false); return load(); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '儲存失敗'))
      .finally(() => setSaving(false));
  };

  const doCopy = () => {
    setSaving(true);
    api.copyRole({ fromRoleCode: copyFrom, roleCode: copyCode, roleName: copyName }, token)
      .then(() => { setToast('已複製角色'); setCopyOpen(false); return load(); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '複製失敗'))
      .finally(() => setSaving(false));
  };

  const disable = (r: RoleRow) => {
    api.deleteRole(r.roleCode, token)
      .then(() => { setToast(r.isActive ? '已停用角色' : '已啟用角色'); return load(); })
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '操作失敗'));
  };

  // 權限目錄依 module 分組
  const groups = catalog.reduce<Record<string, PermissionRow[]>>((acc, p) => {
    (acc[p.module] = acc[p.module] || []).push(p);
    return acc;
  }, {});

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      <Toolbar sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', borderBottom: '1px solid #e5eaf2' }}>
        <IconButton title="返回個案列表" onClick={() => navigate('/admin/cases')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ color: '#1a5aa6', ml: 1 }}>角色與權限</Typography>
        <Box sx={{ flex: 1 }} />
        <NotificationCenter />
        <IconButton title="登出" onClick={logout}><LogoutIcon /></IconButton>
      </Toolbar>

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="lg" mx="auto">
        <AdminNav current="roles" />
        <Stack direction="row" spacing={1} sx={{ mb: 2, mt: 1 }} alignItems="center">
          <Box sx={{ flex: 1 }} />
          {canManage && <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}>新增角色</Button>}
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
        ) : (
          <TableContainer sx={{ bgcolor: '#fff', borderRadius: 2, border: '1px solid #e5eaf2' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                  <TableCell sx={{ fontWeight: 600 }}>角色代碼</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>名稱</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>數據範圍</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>權限數</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>用戶數</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map((r) => (
                  <TableRow key={r.roleId} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.roleCode}</TableCell>
                    <TableCell>{r.roleName}</TableCell>
                    <TableCell><Chip size="small" label={r.dataScope === 'ALL' ? '全屋苑' : '單屋苑'} /></TableCell>
                    <TableCell>{r.permissions.length}</TableCell>
                    <TableCell>{r.userCount}</TableCell>
                    <TableCell>{r.isActive ? <Chip size="small" color="success" label="啟用" /> : <Chip size="small" label="停用" />}</TableCell>
                    <TableCell align="right">
                      {canManage && (
                        <>
                          <Button size="small" onClick={() => openEdit(r)}>修改</Button>
                          <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => openCopy(r)}>複製</Button>
                          <Button size="small" color="warning" onClick={() => disable(r)}>{r.isActive ? '停用' : '啟用'}</Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `修改角色 ${editing.roleCode}` : '新增角色'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField size="small" label="角色代碼（全大寫，如 ESTATE_MANAGER）" value={form.roleCode} disabled={!!editing}
              onChange={(e) => setForm({ ...form, roleCode: e.target.value })} fullWidth />
            <TextField size="small" label="角色名稱" value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value })} fullWidth />
            <TextField size="small" select label="數據範圍" value={form.dataScope} onChange={(e) => setForm({ ...form, dataScope: e.target.value })} fullWidth>
              <MenuItem value="ALL">全屋苑（ALL）</MenuItem>
              <MenuItem value="ESTATE">單屋苑（ESTATE）</MenuItem>
            </TextField>
            <Typography variant="subtitle2" sx={{ color: '#555' }}>權限綁定（模組 × 操作）</Typography>
            {Object.entries(groups).map(([mod, ps]) => (
              <Box key={mod}>
                <Typography variant="caption" sx={{ color: '#888' }}>{mod}</Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                  {ps.map((p) => {
                    const checked = form.permissions.includes(p.code);
                    return (
                      <Chip key={p.code} label={p.name} clickable color={checked ? 'primary' : 'default'}
                        variant={checked ? 'filled' : 'outlined'}
                        onClick={() => setForm({
                          ...form,
                          permissions: checked ? form.permissions.filter((c) => c !== p.code) : [...form.permissions, p.code],
                        })} />
                    );
                  })}
                </Stack>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button variant="contained" disabled={saving} onClick={save}>{saving ? '儲存中…' : '儲存'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={copyOpen} onClose={() => setCopyOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>複製角色（FR-010-07）</DialogTitle>
        <DialogContent dividers>
          <DialogContentText>以 <strong>{copyFrom}</strong> 的權限組合為範本，建立新角色。</DialogContentText>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField size="small" label="新角色代碼" value={copyCode} onChange={(e) => setCopyCode(e.target.value)} fullWidth />
            <TextField size="small" label="新角色名稱" value={copyName} onChange={(e) => setCopyName(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyOpen(false)}>取消</Button>
          <Button variant="contained" disabled={saving} onClick={doCopy}>複製</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}
