import s from './EmptyState.module.scss';

function EmptyState({ message = 'No data found', action }) {
  return (
    <div className={s.wrapper}>
      <div className={s.icon}>{'\u2205'}</div>
      <p className={s.message}>{message}</p>
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}

export default EmptyState;
