import CopyButton from './CopyButton.jsx';
import s from './CodeBlock.module.scss';

function CodeBlock({ code, label }) {
  return (
    <div className={s.codeBlock}>
      <div className={s.header}>
        {label && <span className={s.label}>{label}</span>}
        <CopyButton value={code} />
      </div>
      <pre className={s.pre}><code>{code}</code></pre>
    </div>
  );
}

export default CodeBlock;
