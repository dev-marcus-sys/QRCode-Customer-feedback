import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { AuthGuard } from './components/AuthGuard';
import { EnvFooter } from './components/EnvFooter';
import { FormPage } from './pages/public/FormPage';
import { SuccessPage } from './pages/public/SuccessPage';
import { SurveyPage } from './pages/public/SurveyPage';
import { LoginPage } from './pages/admin/LoginPage';
import { CaseListPage } from './pages/admin/CaseListPage';
import { CaseDetailPage } from './pages/admin/CaseDetailPage';
import { QrCodePage } from './pages/admin/QrCodePage';
import { SurveyStatsPage } from './pages/admin/SurveyStatsPage';
import { EmailDispatchPage } from './pages/admin/EmailDispatchPage';
import { EmailTemplatePage } from './pages/admin/EmailTemplatePage';
import { SurveyTemplatePage } from './pages/admin/SurveyTemplatePage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { ConfigPage } from './pages/admin/ConfigPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { AuditPage } from './pages/admin/AuditPage';
import { EstatesPage } from './pages/admin/EstatesPage';
import { DatabasePage } from './pages/admin/DatabasePage';
import KnowledgeBasePage from './pages/admin/KnowledgeBasePage';
import { MobileGuard } from './mobile/MobileGuard';
import { MobileShell } from './mobile/MobileShell';
import { MobileLoginPage } from './pages/mobile/MobileLoginPage';
import { MobileCaseListPage } from './pages/mobile/MobileCaseListPage';
import { MobileCaseDetailPage } from './pages/mobile/MobileCaseDetailPage';
import { MobileSurveyPage } from './pages/mobile/MobileSurveyPage';
import { MobileQrPage } from './pages/mobile/MobileQrPage';
import { authStore } from './api/client';
import InstallPrompt from './pwa/InstallPrompt';

/** 手機版入口：依權限導向第一個可存取的分頁（避免無 dashboard:view 的使用者被卡在儀表板 403）。 */
function MobileLanding() {
  const perms = authStore.getUser()?.permissions || [];
  const target = perms.includes('dashboard:view')
    ? '/m/dashboard'
    : perms.includes('case:list')
    ? '/m/cases'
    : perms.includes('qr:view')
    ? '/m/qr'
    : '/m/login';
  return <Navigate to={target} replace />;
}

/** 手機版管理頁權限守衛：無對應權限時顯示「無權限」，避免直接輸入網址越權檢視。 */
function PermGuard({ perm, children }: { perm: string; children: ReactNode }) {
  const perms = authStore.getUser()?.permissions || [];
  if (!perms.includes(perm)) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">無權限</Typography>
      </Box>
    );
  }
  return <>{children}</>;
}

/** 登入入口：依視窗寬度自動分流——手機（<600px，對應 xs 斷點）跳手機版登入，桌面顯示桌面板登入。 */
function LoginRoute() {
  const theme = useTheme();
  const isMobileView = useMediaQuery(theme.breakpoints.down('sm'));
  if (isMobileView) return <Navigate to="/m/login" replace />;
  return <LoginPage />;
}

export default function App() {
  const location = useLocation();
  const isMobile = location.pathname.startsWith('/m');
  const showInstall = location.pathname.startsWith('/admin');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', pt: 'env(safe-area-inset-top)' }}>
      <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', pb: isMobile ? 0 : 5 }}>
        <Routes>
          <Route path="/" element={<FormPage />} />
      <Route path="/success" element={<SuccessPage />} />
      <Route path="/survey/:token" element={<SurveyPage />} />
      <Route path="/admin/login" element={<LoginRoute />} />
      <Route
        path="/admin/cases"
        element={
          <AuthGuard>
            <CaseListPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/cases/:caseId"
        element={
          <AuthGuard>
            <CaseDetailPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/qr"
        element={
          <AuthGuard>
            <QrCodePage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/surveys"
        element={
          <AuthGuard>
            <SurveyStatsPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/dashboard"
        element={
          <AuthGuard>
            <DashboardPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/config"
        element={
          <AuthGuard>
            <ConfigPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AuthGuard>
            <UsersPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <AuthGuard>
            <RolesPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/audit"
        element={
          <AuthGuard>
            <AuditPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/estates"
        element={
          <AuthGuard>
            <EstatesPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/kb"
        element={
          <AuthGuard>
            <KnowledgeBasePage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/emails"
        element={
          <AuthGuard>
            <EmailDispatchPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/email-templates"
        element={
          <AuthGuard>
            <EmailTemplatePage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/survey-templates"
        element={
          <AuthGuard>
            <SurveyTemplatePage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/database"
        element={
          <AuthGuard>
            <DatabasePage />
          </AuthGuard>
        }
      />
      <Route path="/admin" element={<Navigate to="/admin/cases" replace />} />

      {/* ---------- 手機版（/m/*，獨立路由＋底部 Tab 導覽） ---------- */}
      <Route path="/m/login" element={<MobileLoginPage />} />
      <Route
        path="/m"
        element={
          <MobileGuard>
            <MobileShell />
          </MobileGuard>
        }
      >
        <Route index element={<MobileLanding />} />
        <Route path="dashboard" element={<DashboardPage hideToolbar basePath="/m" />} />
        <Route path="cases" element={<MobileCaseListPage />} />
        <Route path="cases/:caseId" element={<MobileCaseDetailPage />} />
        <Route path="surveys" element={<MobileSurveyPage />} />
        <Route path="qr" element={<MobileQrPage />} />
        {/* 管理功能：經「更多」溢出選單進入，權限與桌面一致 */}
        <Route path="config" element={<PermGuard perm="config:view"><ConfigPage hideToolbar /></PermGuard>} />
        <Route path="users" element={<PermGuard perm="user:list"><UsersPage hideToolbar /></PermGuard>} />
        <Route path="roles" element={<PermGuard perm="role:list"><RolesPage hideToolbar /></PermGuard>} />
        <Route path="audit" element={<PermGuard perm="audit:view"><AuditPage hideToolbar /></PermGuard>} />
        <Route path="estates" element={<PermGuard perm="estate:list"><EstatesPage hideToolbar /></PermGuard>} />
        <Route path="database" element={<PermGuard perm="db:query"><DatabasePage /></PermGuard>} />
      </Route>
        </Routes>
      </Box>
      {!isMobile && <EnvFooter fixed />}
      {showInstall && <InstallPrompt />}
    </Box>
  );
}
