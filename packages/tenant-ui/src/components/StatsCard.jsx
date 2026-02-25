import s from './StatsCard.module.scss';

function StatsCard({ title, value, subtitle }) {
  return (
    <div className={`card ${s.card}`}>
      <div className={s.title}>{title}</div>
      <div className={s.value}>{value}</div>
      {subtitle && <div className={s.subtitle}>{subtitle}</div>}
    </div>
  );
}

export default StatsCard;
