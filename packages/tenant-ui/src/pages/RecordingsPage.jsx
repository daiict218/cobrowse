import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import s from './RecordingsPage.module.scss';

function formatDuration(ms) {
  if (ms == null) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const columns = [
  {
    key: 'session_id',
    label: 'Session ID',
    render: (val) => val.slice(0, 8) + '...',
  },
  { key: 'agent_id', label: 'Agent' },
  { key: 'customer_id', label: 'Customer' },
  {
    key: 'status',
    label: 'Status',
    render: (val) => (
      <span className={`badge badge-${val === 'complete' ? 'ended' : val === 'recording' ? 'active' : 'pending'}`}>
        {val}
      </span>
    ),
  },
  {
    key: 'duration_ms',
    label: 'Duration',
    render: (val) => formatDuration(val),
  },
  {
    key: 'event_count',
    label: 'Events',
    render: (val) => val || 0,
  },
  {
    key: 'compressed_size',
    label: 'Size',
    render: (val) => formatBytes(val),
  },
  {
    key: 'completed_at',
    label: 'Completed',
    render: (val) => val ? new Date(val).toLocaleString() : '-',
  },
];

function RecordingsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const limit = 20;

  const query = `/tenants/${id}/recordings?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`;
  const { data, loading, error, reload } = useFetch(query, [page, status]);

  const handleRowClick = (row) => {
    if (row.status === 'complete') {
      navigate(`/portal/tenants/${id}/recordings/${row.session_id}`);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/portal/tenants/${id}`} className={s.backLink}>
            &larr; Back to tenant
          </Link>
          <h1>Recordings</h1>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <div className="card">
        <div className={s.filters}>
          {['', 'complete', 'recording', 'failed'].map((st) => (
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
          data={data?.recordings || []}
          loading={loading}
          emptyMessage="No recordings found"
          onRowClick={handleRowClick}
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

export default RecordingsPage;
