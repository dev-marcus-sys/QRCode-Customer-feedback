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
      <Route path="/admin" element={<Navigate to="/admin/cases" replace />} />
    </Routes>
  );
}
