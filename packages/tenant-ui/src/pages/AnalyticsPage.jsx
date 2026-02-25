import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import StatsCard from '../components/StatsCard.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import s from './AnalyticsPage.module.scss';

function DailyChart({ data }) {
  if (!data || data.length === 0) return <p className={s.noData}>No data</p>;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barWidth = Math.max(16, Math.floor(600 / data.length) - 4);
  const chartHeight = 160;

  return (
    <svg
      width={data.length * (barWidth + 4)}
      height={chartHeight + 30}
      className={s.chart}
    >
      {data.map((d, i) => {
        const barHeight = (d.count / maxCount) * chartHeight;
        const x = i * (barWidth + 4);
        const y = chartHeight - barHeight;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={3}
              fill="var(--color-primary)"
              opacity={0.8}
            />
            <text
              x={x + barWidth / 2}
              y={chartHeight + 14}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-muted)"
            >
              {new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
            <text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-secondary)"
            >
              {d.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AnalyticsPage() {
  const { id } = useParams();
  const [days, setDays] = useState(30);

  const from = useMemo(
    () => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    [days]
  );
  const query = `/tenants/${id}/analytics?from=${from}`;
  const { data, loading, error, reload } = useFetch(query, [days]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  const analytics = data || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/portal/tenants/${id}`} className={s.backLink}>
            &larr; Back to tenant
          </Link>
          <h1>Analytics</h1>
        </div>
        <div className={s.dayButtons}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className={s.statsGrid}>
        <StatsCard title="Total Sessions" value={analytics.totalSessions ?? 0} />
        <StatsCard
          title="Consent Rate"
          value={`${analytics.consentRate ?? 0}%`}
          subtitle={`${analytics.consentedSessions ?? 0} consented`}
        />
        <StatsCard
          title="Avg Duration"
          value={formatDuration(analytics.avgDurationSeconds)}
        />
        <StatsCard
          title="Idle Timeouts"
          value={analytics.idleTimeouts ?? 0}
        />
      </div>

      <div className="card">
        <h3 className={s.sectionTitle}>Daily Sessions</h3>
        <div className={s.chartWrapper}>
          <DailyChart data={analytics.daily || []} />
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default AnalyticsPage;
