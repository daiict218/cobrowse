import LoadingSpinner from './LoadingSpinner.jsx';
import EmptyState from './EmptyState.jsx';
import s from './DataTable.module.scss';

function DataTable({ columns, data, loading, emptyMessage, onRowClick, pagination }) {
  if (loading) return <LoadingSpinner />;
  if (!data || data.length === 0) return <EmptyState message={emptyMessage || 'No data'} />;

  return (
    <div>
      <div className={s.scrollWrapper}>
        <table className={s.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={s.th}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`${s.row}${onRowClick ? ` ${s.clickable}` : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={s.td}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > pagination.limit && (
        <div className={s.pagination}>
          <span>
            Showing {((pagination.page - 1) * pagination.limit) + 1}
            {' - '}{Math.min(pagination.page * pagination.limit, pagination.total)}
            {' of '}{pagination.total}
          </span>
          <div className={s.paginationButtons}>
            <button
              className="btn btn-sm btn-secondary"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-sm btn-secondary"
              disabled={pagination.page * pagination.limit >= pagination.total}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
