import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Modal from '../components/Modal.jsx';
import CopyButton from '../components/CopyButton.jsx';
import s from './TenantDetailPage.module.scss';

const EXPIRY_OPTIONS = [
  { label: 'No expiry', value: '' },
  { label: '90 days', value: '90' },
  { label: '180 days', value: '180' },
  { label: '365 days', value: '365' },
];

function formatExpiryStatus(keyExpiresAt) {
  if (!keyExpiresAt) return null;
  const expires = new Date(keyExpiresAt);
  const now = new Date();
  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { text: 'Expired', className: 'badge-inactive' };
  if (daysLeft <= 7) return { text: `Expires in ${daysLeft}d`, className: 'badge-inactive' };
  if (daysLeft <= 30) return { text: `Expires in ${daysLeft}d`, className: '' };
  return { text: `Expires ${expires.toLocaleDateString()}`, className: 'badge-active' };
}

function TenantDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, loading, error, reload } = useFetch(`/tenants/${id}`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [rotatedKeys, setRotatedKeys] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotateError, setRotateError] = useState('');
  const [expiryDays, setExpiryDays] = useState('');
  const { data: keyEventsData, loading: keyEventsLoading, reload: reloadKeyEvents } = useFetch(`/tenants/${id}/key-events`);
  const { data: authFailuresData, loading: authFailuresLoading } = useFetch(`/tenants/${id}/auth-failures`);

  const tenant = data?.tenant;

  const startEdit = () => {
    setForm({
      name: tenant.name,
      allowedDomains: (tenant.allowed_domains || []).join(', '),
      isActive: tenant.is_active,
    });
    setEditing(true);
    setSaveError('');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/tenants/${id}`, {
        method: 'PUT',
        body: {
          name: form.name,
          allowedDomains: form.allowedDomains
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
          isActive: form.isActive,
        },
      });
      setEditing(false);
      reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRotateKeys = async () => {
    setRotating(true);
    setRotateError('');
    try {
      const body = expiryDays ? { expiresInDays: parseInt(expiryDays, 10) } : {};
      const result = await apiFetch(`/tenants/${id}/rotate-keys`, { method: 'POST', body });
      setConfirmRotate(false);
      setRotatedKeys(result.keys);
      setExpiryDays('');
      reload();
      reloadKeyEvents();
    } catch (err) {
      setRotateError(err.message);
    } finally {
      setRotating(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!tenant) return null;

  const expiryStatus = formatExpiryStatus(tenant.key_expires_at);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{tenant.name}</h1>
          <span className={`badge ${tenant.is_active ? 'badge-active' : 'badge-inactive'}`}>
            {tenant.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        {isAdmin && !editing && (
          <div className={s.headerActions}>
            <button className="btn btn-secondary" onClick={startEdit}>Edit</button>
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmRotate(true)}>
              Rotate Keys
            </button>
          </div>
        )}
      </div>

      {expiryStatus && expiryStatus.className === 'badge-inactive' && (
        <div className={s.expiryWarning}>
          <strong>Key expiry warning:</strong> API keys {expiryStatus.text.toLowerCase()}.
          Rotate keys to restore access.
        </div>
      )}

      {editing ? (
        <div className={`card ${s.editCard}`}>
          {saveError && <div className={s.error}>{saveError}</div>}
          <div className={`form-group ${s.fieldGroup}`}>
            <label>Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className={`form-group ${s.fieldGroup}`}>
            <label>Allowed Domains</label>
            <input
              className="form-input"
              value={form.allowedDomains}
              onChange={(e) => setForm({ ...form, allowedDomains: e.target.value })}
            />
          </div>
          <div className={`form-group ${s.fieldGroupLg}`}>
            <label className={s.checkboxLabel}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>
          </div>
          <div className={s.actions}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className={s.detailGrid}>
            <div className="card">
              <div className={s.detailLabel}>Allowed Domains</div>
              <div className={s.detailValue}>
                {(tenant.allowed_domains || []).length > 0
                  ? tenant.allowed_domains.join(', ')
                  : 'All domains (unrestricted)'}
              </div>
            </div>
            <div className="card">
              <div className={s.detailLabel}>Created</div>
              <div className={s.detailValue}>
                {new Date(tenant.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="card">
              <div className={s.detailLabel}>Key Expiry</div>
              <div className={s.detailValue}>
                {expiryStatus ? (
                  <span className={`badge ${expiryStatus.className}`}>{expiryStatus.text}</span>
                ) : (
                  'No expiry set'
                )}
              </div>
            </div>
          </div>

          <div className={`card ${s.sectionCard}`}>
            <h3 className={s.sectionTitle}>Feature Flags</h3>
            <div className={s.flagsList}>
              {Object.entries(tenant.feature_flags || {}).map(([key, val]) => (
                <span key={key} className={val ? s.flagEnabled : s.flagDisabled}>
                  {val ? '\u2713' : '\u2717'} {key}
                </span>
              ))}
            </div>
          </div>

          <div className={`card ${s.sectionCard}`}>
            <h3 className={s.sectionTitle}>Key History</h3>
            {keyEventsLoading ? (
              <LoadingSpinner />
            ) : (keyEventsData?.events?.length > 0) ? (
              <table className={s.auditTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Event</th>
                    <th>Performed By</th>
                    <th>IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {keyEventsData.events.map((ev) => (
                    <tr key={ev.id}>
                      <td>{new Date(ev.created_at).toLocaleString()}</td>
                      <td>{ev.event_type === 'keys.created' ? 'Keys Created' : 'Keys Rotated'}</td>
                      <td>{ev.user_name || ev.user_email || 'System'}</td>
                      <td>{ev.ip_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={s.auditEmpty}>No key events recorded yet.</div>
            )}
          </div>

          <div className={`card ${s.sectionCard}`}>
            <h3 className={s.sectionTitle}>Recent Auth Failures</h3>
            {authFailuresLoading ? (
              <LoadingSpinner />
            ) : (authFailuresData?.failures?.length > 0) ? (
              <table className={s.auditTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Identifier</th>
                    <th>IP</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {authFailuresData.failures.map((f) => (
                    <tr key={f.id}>
                      <td>{new Date(f.created_at).toLocaleString()}</td>
                      <td>{f.auth_type}</td>
                      <td><code className={s.monoCell}>{f.identifier || '-'}</code></td>
                      <td>{f.ip_address || '-'}</td>
                      <td>{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={s.auditEmpty}>No auth failures recorded.</div>
            )}
          </div>

          <div className="card">
            <h3 className={s.sectionTitle}>Quick Links</h3>
            <div className={s.quickLinks}>
              <Link to={`/portal/tenants/${id}/sessions`} className="btn btn-secondary btn-sm">
                Sessions
              </Link>
              <Link to={`/portal/tenants/${id}/analytics`} className="btn btn-secondary btn-sm">
                Analytics
              </Link>
              <Link to={`/portal/tenants/${id}/recordings`} className="btn btn-secondary btn-sm">
                Recordings
              </Link>
              <Link to={`/portal/tenants/${id}/masking`} className="btn btn-secondary btn-sm">
                Masking Rules
              </Link>
              <Link to="/portal/quick-start" className="btn btn-secondary btn-sm">
                Integration Guide
              </Link>
            </div>
          </div>
        </>
      )}

      <Modal open={confirmRotate} onClose={() => { setConfirmRotate(false); setRotateError(''); setExpiryDays(''); }} title="Rotate API Keys">
        <div className={s.warning}>
          <strong>This is a destructive action.</strong> The current secret key and public key will be
          permanently revoked. Any integrations using the existing keys will stop working immediately.
        </div>
        <p className={s.confirmDetail}>You will receive a new key pair. Make sure you have access to update
          your integration configuration before proceeding.</p>
        <div className={`form-group ${s.fieldGroup}`}>
          <label>Key Expiry</label>
          <select
            className="form-input"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {rotateError && <div className={s.error}>{rotateError}</div>}
        <div className={s.actions}>
          <button className="btn btn-danger" onClick={handleRotateKeys} disabled={rotating}>
            {rotating ? 'Rotating...' : 'Revoke & Generate New Keys'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setConfirmRotate(false); setRotateError(''); setExpiryDays(''); }} disabled={rotating}>
            Cancel
          </button>
        </div>
      </Modal>

      <Modal open={!!rotatedKeys} onClose={() => setRotatedKeys(null)} title="New API Keys Generated">
        {rotatedKeys && (
          <div>
            <div className={s.warning}>
              <strong>Copy both keys now.</strong> The secret key will not be shown again after you close
              this dialog. Store them in a secure location such as your environment variables or a secrets manager.
            </div>
            <p className={s.confirmDetail}>
              The previous keys have been revoked. Update your integration configuration with these new keys
              to restore connectivity.
            </p>
            <div className={`form-group ${s.keyGroup}`}>
              <label>Secret Key</label>
              <div className={s.keyRow}>
                <code className={s.keyCode}>{rotatedKeys.secretKey}</code>
                <CopyButton value={rotatedKeys.secretKey} />
              </div>
            </div>
            <div className={`form-group ${s.keyGroupLg}`}>
              <label>Public Key</label>
              <div className={s.keyRow}>
                <code className={s.keyCode}>{rotatedKeys.publicKey}</code>
                <CopyButton value={rotatedKeys.publicKey} />
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => setRotatedKeys(null)}>I've Saved These Keys</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default TenantDetailPage;
