import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import s from './MaskingRulesPage.module.scss';

function EditableList({ label, items, onChange, placeholder }) {
  const handleAdd = () => onChange([...items, '']);
  const handleRemove = (idx) => onChange(items.filter((_, i) => i !== idx));
  const handleChange = (idx, val) => {
    const updated = [...items];
    updated[idx] = val;
    onChange(updated);
  };

  return (
    <div className={s.listSection}>
      <div className={s.listHeader}>
        <label className={s.listLabel}>{label}</label>
        <button type="button" className="btn btn-sm btn-secondary" onClick={handleAdd}>
          + Add
        </button>
      </div>
      {items.map((item, idx) => (
        <div key={idx} className={s.listRow}>
          <input
            className={`form-input ${s.listInput}`}
            value={item}
            onChange={(e) => handleChange(idx, e.target.value)}
            placeholder={placeholder}
          />
          <button
            type="button"
            className={`btn btn-sm btn-danger ${s.removeBtn}`}
            onClick={() => handleRemove(idx)}
          >
            {'\u2715'}
          </button>
        </div>
      ))}
      {items.length === 0 && (
        <span className={s.emptyHint}>None configured</span>
      )}
    </div>
  );
}

function MaskingRulesPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, loading, error, reload } = useFetch(`/tenants/${id}/masking-rules`);
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    if (data?.rules) {
      setRules({
        selectors: data.rules.selectors || [],
        maskTypes: data.rules.maskTypes || [],
        patterns: data.rules.patterns || [],
      });
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      await apiFetch(`/tenants/${id}/masking-rules`, {
        method: 'PUT',
        body: rules,
      });
      setSaveOk(true);
      reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!rules) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/portal/tenants/${id}`} className={s.backLink}>
            &larr; Back to tenant
          </Link>
          <h1>Masking Rules</h1>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Rules'}
          </button>
        )}
      </div>

      {saveError && <ErrorBanner message={saveError} />}
      {saveOk && (
        <div className={s.success}>
          Masking rules saved successfully.
        </div>
      )}

      <div className="card">
        <EditableList
          label="CSS Selectors"
          items={rules.selectors}
          onChange={(val) => setRules({ ...rules, selectors: val })}
          placeholder='e.g. input[name="card"], #ssn-field'
        />

        <EditableList
          label="Input Types to Mask"
          items={rules.maskTypes}
          onChange={(val) => setRules({ ...rules, maskTypes: val })}
          placeholder="e.g. password, tel"
        />

        <EditableList
          label="Regex Patterns"
          items={rules.patterns}
          onChange={(val) => setRules({ ...rules, patterns: val })}
          placeholder="e.g. \d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}"
        />

        <div className={s.helpBox}>
          <strong>How masking works:</strong>
          <ul className={s.helpList}>
            <li><strong>Selectors</strong> match DOM elements by CSS selector. Their content is masked before capture.</li>
            <li><strong>Input Types</strong> mask all &lt;input&gt; elements of the specified type.</li>
            <li><strong>Patterns</strong> are regex patterns applied to text content.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default MaskingRulesPage;
