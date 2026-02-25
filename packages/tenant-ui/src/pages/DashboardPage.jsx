import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useFetch } from '../hooks/useFetch.js';
import StatsCard from '../components/StatsCard.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import s from './DashboardPage.module.scss';

const tenantColumns = [
  { key: 'name', label: 'Tenant' },
  {
    key: 'isActive',
    label: 'Status',
    render: (val) => (
      <span className={`badge ${val ? 'badge-active' : 'badge-inactive'}`}>
        {val ? 'Active' : 'Inactive'}
      </span>
    ),
  },
  { key: 'sessions24h', label: '24h Sessions' },
  { key: 'sessions7d', label: '7d Sessions' },
  { key: 'sessionsTotal', label: 'Total' },
];

function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/analytics/overview');

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  const overview = data || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className={s.welcomeText}>Welcome back, {user?.name}</p>
        </div>
      </div>

      <div className={s.statsGrid}>
        <StatsCard title="Total Tenants" value={overview.tenantCount ?? 0} />
        <StatsCard title="Active Now" value={overview.activeNow ?? 0} subtitle="live sessions" />
        <StatsCard title="Last 24h" value={overview.sessions24h ?? 0} subtitle="sessions" />
        <StatsCard title="Last 7 Days" value={overview.sessions7d ?? 0} subtitle="sessions" />
      </div>

      <div className="card">
        <h2 className={s.sectionTitle}>Tenants</h2>
        <DataTable
          columns={tenantColumns}
          data={overview.tenants || []}
          emptyMessage="No tenants yet"
          onRowClick={(row) => navigate(`/portal/tenants/${row.id}`)}
        />
      </div>
    </div>
  );
}

export default DashboardPage;
