import s from './LoadingSpinner.module.scss';

function LoadingSpinner({ size = 24 }) {
  return (
    <div className={s.wrapper}>
      <div className={s.spinner} style={{ width: size, height: size }} />
    </div>
  );
}

export default LoadingSpinner;
