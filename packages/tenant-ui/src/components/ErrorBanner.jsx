import s from './ErrorBanner.module.scss';

function ErrorBanner({ message, onRetry }) {
  return (
    <div className={s.banner}>
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-sm btn-secondary">
          Retry
        </button>
      )}
    </div>
  );
}

export default ErrorBanner;
