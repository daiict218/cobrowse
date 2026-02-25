import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import CopyButton from '../components/CopyButton.jsx';
import s from './CreateTenantPage.module.scss';

function CreateTenantPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await apiFetch('/tenants', {
        method: 'POST',
        body: {
          name: name.trim(),
          allowedDomains: domains
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
        },
      });
      setKeys(result.keys);
    } catch (err) {
      setError(err.message || 'Failed to create tenant');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setKeys(null);
    navigate('/portal/tenants');
  };

  return (
    <div>
      <div className="page-header">
        <h1>Create Tenant</h1>
      </div>

      <div className={`card ${s.formCard}`}>
        <form onSubmit={handleSubmit}>
          {error && <div className={s.error}>{error}</div>}

          <div className={`form-group ${s.fieldGroup}`}>
            <label htmlFor="name">Tenant Name</label>
            <input
              id="name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Insurance"
              required
              autoFocus
            />
          </div>

          <div className={`form-group ${s.fieldGroupLg}`}>
            <label htmlFor="domains">Allowed Domains (comma-separated)</label>
            <input
              id="domains"
              type="text"
              className="form-input"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com, app.example.com"
            />
            <span className={s.hint}>
              Domains where the SDK can be embedded. Leave blank to allow all.
            </span>
          </div>

          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Tenant'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/portal/tenants')}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      <Modal open={!!keys} onClose={handleClose} title="Tenant Created">
        {keys && (
          <div>
            <p className={s.warning}>
              These keys are shown ONCE. Copy them now and store securely.
            </p>

            <div className={`form-group ${s.keyGroup}`}>
              <label>Secret Key</label>
              <div className={s.keyRow}>
                <code className={s.keyCode}>{keys.secretKey}</code>
                <CopyButton value={keys.secretKey} />
              </div>
            </div>

            <div className={`form-group ${s.keyGroupLg}`}>
              <label>Public Key</label>
              <div className={s.keyRow}>
                <code className={s.keyCode}>{keys.publicKey}</code>
                <CopyButton value={keys.publicKey} />
              </div>
            </div>

            <button className="btn btn-primary" onClick={handleClose}>
              Done
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default CreateTenantPage;
