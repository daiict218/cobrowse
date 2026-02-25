import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import s from './TenantsListPage.module.scss';

const columns = [
  { key: 'name', label: 'Name' },
  {
    key: 'is_active',
    label: 'Status',
    render: (val) => (
      <span className={`badge ${val ? 'badge-active' : 'badge-inactive'}`}>
        {val ? 'Active' : 'Inactive'}
      </span>
    ),
  },
  {
    key: 'allowed_domains',
    label: 'Domains',
    render: (val) => (val || []).join(', ') || '-',
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (val) => new Date(val).toLocaleDateString(),
  },
];

function TenantsListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useFetch('/tenants');

  const tenants = (data?.tenants || []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-header">
        <h1>Tenants</h1>
        <Link to="/portal/tenants/new" className="btn btn-primary">
          Create Tenant
        </Link>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <div className="card">
        <div className={s.searchWrapper}>
          <input
            type="text"
            className={`form-input ${s.searchInput}`}
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable
          columns={columns}
          data={tenants}
          loading={loading}
          emptyMessage="No tenants found"
          onRowClick={(row) => navigate(`/portal/tenants/${row.id}`)}
        />
      </div>
    </div>
  );
}

export default TenantsListPage;
