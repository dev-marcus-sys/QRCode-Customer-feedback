/**
 * 屋苑主檔管理（/admin/estates）。
 * - estate:list 可瀏覽；estate:manage 才能新增/修改/停用（後端亦有 requirePerm 把關）。
 * - 屋苑被 case / qr_code 以 FK 參照，故只提供「停用/啟用」而非刪除。
 * - 所有操作寫入 audit_log（action=ESTATE_MANAGE）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, IconButton, Snackbar, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ApartmentIcon from '@mui/icons-material/Apartment';
import EditIcon from '@mui/icons-material/Edit';
import { ApiRequestError, api, authStore, EstateItem } from '../../api/client';
import { AdminPageToolbar } from '../../components/AdminPageToolbar';
import AdminNav from '../../admin/AdminNav';
import { invalidateEstates } from '../../admin/useEstates';

const EMPTY_FORM = { estateCode: '', estateNameZh: '', estateNameEn: '', companyCode: '' };

export function EstatesPage({ hideToolbar = false }: { hideToolbar?: boolean }) {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const token = authStore.getToken() || '';
  const perms = user?.permissions || [];
  const canView = perms.includes('estate:list');
  const canManage = perms.includes('estate:manage');

  const [rows, setRows] = useState<EstateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<EstateItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<{ code: string; name: string; deactivate: boolean } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listEstates(token)
      .then((d) => setRows(d.items))
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : '載入屋苑失敗'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditOpen(true);
  };

  const openEdit = (row: EstateItem) => {
    setEditing(row);
    setForm({ estateCode: row.estateCode, estateNameZh: row.estateNameZh, estateNameEn: row.estateNameEn, companyCode: row.companyCode });
    setEditOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.updateEstate(editing.estateCode, {
          estateNameZh: form.estateNameZh,
          estateNameEn: form.estateNameEn,
          companyCode: form.companyCode,
        }, token);
        setToast('屋苑已更新');
      } else {
        await api.createEstate({
          estateCode: form.estateCode,
          estateNameZh: form.estateNameZh,
          estateNameEn: form.estateNameEn,
          companyCode: form.companyCode,
        }, token);
        setToast('屋苑已新增');
      }
      invalidateEstates();
      setEditOpen(false);
      load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!confirm) return;
    const { code, deactivate } = confirm;
    setSaving(true);
    try {
      await api.updateEstate(code, { isActive: !deactivate }, token);
      invalidateEstates();
      setToast(deactivate ? '屋苑已停用（住戶表單將無法使用）' : '屋苑已重新啟用');
      setConfirm(null);
      load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '操作失敗');
      setConfirm(null);
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', p: 3 }}>
        <Toolbar>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/cases')} sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>個案管理</Button>
        </Toolbar>
        <Alert severity="warning">當前帳號沒有 estate:list 權限，無法查閱屋苑管理。</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fa', pb: 4 }}>
      {!hideToolbar && <AdminPageToolbar title="屋苑管理" />}

      <Box sx={{ p: { xs: 1.5, md: 3 } }} maxWidth="xl" mx="auto">
        <AdminNav current="estates" />

        <Stack direction="row" spacing={1} sx={{ mb: 2, mt: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box sx={{ flex: 1 }} />
          {canManage && (
            <Button size="small" variant="contained" startIcon={<ApartmentIcon />} onClick={openCreate} sx={{ width: { xs: '100%', sm: 'auto' } }}>新增屋苑</Button>
          )}
        </Stack>

        {!canManage && (
          <Alert severity="info" sx={{ mb: 2 }}>當前帳號沒有 estate:manage 權限，只能檢視屋苑清單。</Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {toast && (
          <Snackbar open autoHideDuration={3000} onClose={() => setToast('')} message={toast} />
        )}

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
        ) : (
          <>
            {/* 寬屏：表格（窄屏隱藏） */}
            <TableContainer sx={{ display: { xs: 'none', md: 'block' }, bgcolor: '#fff', borderRadius: 2, border: '1px solid #e5eaf2', overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                    <TableCell sx={{ fontWeight: 600 }}>代碼</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>中文名稱</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>英文名稱</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>公司</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>狀態</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 120 }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.estateCode} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{r.estateCode}</TableCell>
                      <TableCell>{r.estateNameZh}</TableCell>
                      <TableCell>{r.estateNameEn}</TableCell>
                      <TableCell>{r.companyCode}</TableCell>
                      <TableCell>
                        {r.isActive === 1 ? <Chip size="small" color="success" label="啟用" /> : <Chip size="small" label="停用" />}
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <>
                            <IconButton size="small" title="修改" onClick={() => openEdit(r)}><EditIcon fontSize="small" /></IconButton>
                            <Button
                              size="small"
                              color={r.isActive === 1 ? 'error' : 'success'}
                              onClick={() => setConfirm({ code: r.estateCode, name: r.estateNameZh, deactivate: r.isActive === 1 })}
                            >
                              {r.isActive === 1 ? '停用' : '啟用'}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && (
                    <TableRow><TableCell colSpan={6} sx={{ textAlign: 'center', color: '#999', py: 3 }}>暫無屋苑</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {/* 窄屏：卡片堆疊（寬屏隱藏） */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', gap: 2 }}>
              {rows.map((r) => (
                <Box key={r.estateCode} sx={{ bgcolor: '#fff', borderRadius: 2, border: '1px solid #e5eaf2', p: 2 }}>
                  <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.5 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">代碼</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.estateCode}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">中文名稱</Typography>
                      <Typography variant="body2">{r.estateNameZh}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">英文名稱</Typography>
                      <Typography variant="body2">{r.estateNameEn}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">公司</Typography>
                      <Typography variant="body2">{r.companyCode}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">狀態（更新資訊）</Typography>
                      <Box sx={{ mt: 0.5 }}>
                        {r.isActive === 1 ? <Chip size="small" color="success" label="啟用" /> : <Chip size="small" label="停用" />}
                      </Box>
                    </Box>
                  </Box>
                  {canManage && (
                    <Stack direction="row" spacing={1} sx={{ mt: 2 }} useFlexGap>
                      <Button size="small" variant="outlined" startIcon={<EditIcon />} fullWidth onClick={() => openEdit(r)}>編輯</Button>
                      <Button
                        size="small"
                        fullWidth
                        color={r.isActive === 1 ? 'error' : 'success'}
                        onClick={() => setConfirm({ code: r.estateCode, name: r.estateNameZh, deactivate: r.isActive === 1 })}
                      >
                        {r.isActive === 1 ? '停用' : '啟用'}
                      </Button>
                    </Stack>
                  )}
                </Box>
              ))}
              {!rows.length && (
                <Typography sx={{ textAlign: 'center', color: '#999', py: 3 }}>暫無屋苑</Typography>
              )}
            </Box>
          </>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          屋苑被既有個案與 QR Code 參照，無法刪除；停用後住戶表單即停止受理，歷史資料仍會保留。
        </Typography>
      </Box>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `修改屋苑 ${editing.estateCode}` : '新增屋苑'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField size="small" label="屋苑代碼" value={form.estateCode} disabled={!!editing}
              onChange={(e) => setForm({ ...form, estateCode: e.target.value.toUpperCase() })}
              helperText="大寫英數，2~10 字，建立後不可修改（例：CWC）" fullWidth />
            <TextField size="small" label="中文名稱" value={form.estateNameZh}
              onChange={(e) => setForm({ ...form, estateNameZh: e.target.value })} fullWidth />
            <TextField size="small" label="英文名稱" value={form.estateNameEn}
              onChange={(e) => setForm({ ...form, estateNameEn: e.target.value })} fullWidth />
            <TextField size="small" label="公司代碼" value={form.companyCode}
              onChange={(e) => setForm({ ...form, companyCode: e.target.value.toUpperCase() })}
              helperText="例：CRPM / PML / SMS（決定個案編號的公司前綴）" fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button variant="contained" disabled={saving} onClick={save}>{saving ? '儲存中…' : '儲存'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        {confirm && (
          <>
            <DialogTitle>{confirm.deactivate ? '停用屋苑' : '重新啟用屋苑'}</DialogTitle>
            <DialogContent dividers>
              <DialogContentText>
                {confirm.deactivate
                  ? `確定停用「${confirm.name}（${confirm.code}）」？停用後住戶掃描其 QR Code 將無法提交意見（回「屋苑不存在」），既有個案與問卷資料不受影響。`
                  : `確定重新啟用「${confirm.name}（${confirm.code}）」？啟用後恢復受理（原本仍啟用之 QR 會直接恢復可用；已停用或過期者請至 QR Code 頁重新生成）。`}
              </DialogContentText>
            </DialogContent>
          </>
        )}
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button variant="contained" color={confirm?.deactivate ? 'error' : 'success'} disabled={saving} onClick={toggleActive}>
            {saving ? '處理中…' : confirm?.deactivate ? '確認停用' : '確認啟用'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
