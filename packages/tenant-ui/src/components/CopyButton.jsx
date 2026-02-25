import { useState } from 'react';
import s from './CopyButton.module.scss';

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm ${s.copyBtn}`}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? '\u2713 Copied!' : 'Copy'}
    </button>
  );
}

export default CopyButton;
