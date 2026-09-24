import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { FormPage } from './pages/public/FormPage';
import { SuccessPage } from './pages/public/SuccessPage';
import { SurveyPage } from './pages/public/SurveyPage';
import { LoginPage } from './pages/admin/LoginPage';
import { CaseListPage } from './pages/admin/CaseListPage';
import { CaseDetailPage } from './pages/admin/CaseDetailPage';
import { QrCodePage } from './pages/admin/QrCodePage';
import { SurveyStatsPage } from './pages/admin/SurveyStatsPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { ConfigPage } from './pages/admin/ConfigPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { AuditPage } from './pages/admin/AuditPage';
import { EstatesPage } from './pages/admin/EstatesPage';
import KnowledgeBasePage from './pages/admin/KnowledgeBasePage';
import { MobileGuard } from './mobile/MobileGuard';
import { MobileShell } from './mobile/MobileShell';
import { MobileLoginPage } from './pages/mobile/MobileLoginPage';
import { MobileDashboardPage } from './pages/mobile/MobileDashboardPage';
import { MobileCaseListPage } from './pages/mobile/MobileCaseListPage';
import { MobileCaseDetailPage } from './pages/mobile/MobileCaseDetailPage';
import { MobileSurveyPage } from './pages/mobile/MobileSurveyPage';
import { MobileQrPage } from './pages/mobile/MobileQrPage';
import { authStore } from './api/client';

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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<FormPage />} />
      <Route path="/success" element={<SuccessPage />} />
      <Route path="/survey/:token" element={<SurveyPage />} />
      <Route path="/admin/login" element={<LoginPage />} />
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
        <Route path="dashboard" element={<MobileDashboardPage />} />
        <Route path="cases" element={<MobileCaseListPage />} />
        <Route path="cases/:caseId" element={<MobileCaseDetailPage />} />
        <Route path="surveys" element={<MobileSurveyPage />} />
        <Route path="qr" element={<MobileQrPage />} />
      </Route>
    </Routes>
  );
}
