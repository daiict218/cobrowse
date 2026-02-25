import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import GuestRoute from './components/GuestRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import TenantsListPage from './pages/TenantsListPage.jsx';
import CreateTenantPage from './pages/CreateTenantPage.jsx';
import TenantDetailPage from './pages/TenantDetailPage.jsx';
import MaskingRulesPage from './pages/MaskingRulesPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/portal/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route
            path="/portal/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="tenants" element={<TenantsListPage />} />
            <Route path="tenants/new" element={<CreateTenantPage />} />
            <Route path="tenants/:id" element={<TenantDetailPage />} />
            <Route path="tenants/:id/masking" element={<MaskingRulesPage />} />
            <Route path="tenants/:id/sessions" element={<SessionsPage />} />
            <Route path="tenants/:id/analytics" element={<AnalyticsPage />} />
          </Route>
          {/* /portal without trailing slash → redirect to /portal/ */}
          <Route path="/portal" element={<Navigate to="/portal/" replace />} />
          <Route path="*" element={<Navigate to="/portal/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
