import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import s from './SessionsPage.module.scss';

const columns = [
  {
    key: 'id',
    label: 'Session ID',
    render: (val) => val.slice(0, 8) + '...',
  },
  { key: 'agent_id', label: 'Agent' },
  { key: 'customer_id', label: 'Customer' },
  {
    key: 'status',
    label: 'Status',
    render: (val) => (
      <span className={`badge badge-${val}`}>{val}</span>
    ),
  },
  {
    key: 'end_reason',
    label: 'End Reason',
    render: (val) => val || '-',
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (val) => new Date(val).toLocaleString(),
  },
];

function SessionsPage() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const limit = 20;

  const query = `/tenants/${id}/sessions?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`;
  const { data, loading, error, reload } = useFetch(query, [page, status]);

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/portal/tenants/${id}`} className={s.backLink}>
            &larr; Back to tenant
          </Link>
          <h1>Sessions</h1>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <div className="card">
        <div className={s.filters}>
          {['', 'pending', 'active', 'ended'].map((st) => (
            <button
              key={st}
              className={`btn btn-sm ${status === st ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setStatus(st); setPage(1); }}
            >
              {st || 'All'}
            </button>
          ))}
        </div>

        <DataTable
          columns={columns}
          data={data?.sessions || []}
          loading={loading}
          emptyMessage="No sessions found"
          pagination={{
            page,
            limit,
            total: data?.total || 0,
            onPageChange: setPage,
          }}
        />
      </div>
    </div>
  );
}

export default SessionsPage;
