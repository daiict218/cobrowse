import s from '../QuickStartPage.module.scss';

const endpoints = [
  { method: 'POST', path: '/api/v1/sessions', auth: 'Secret Key / JWT', desc: 'Create a co-browse session' },
  { method: 'GET', path: '/api/v1/sessions/:id', auth: 'Secret Key / JWT', desc: 'Get session status' },
  { method: 'DELETE', path: '/api/v1/sessions/:id', auth: 'Secret Key / JWT', desc: 'End a session' },
  { method: 'POST', path: '/api/v1/snapshots/:id', auth: 'Customer Token', desc: 'Store DOM snapshot' },
  { method: 'GET', path: '/api/v1/snapshots/:id', auth: 'Secret Key / JWT', desc: 'Fetch DOM snapshot' },
  { method: 'GET', path: '/api/v1/ably-auth', auth: 'Varies by role', desc: 'Get scoped Ably token' },
  { method: 'GET', path: '/api/v1/public/masking-rules', auth: 'Public Key', desc: 'Get masking rules (SDK)' },
  { method: 'PUT', path: '/api/v1/admin/masking-rules', auth: 'Secret Key', desc: 'Update masking rules' },
  { method: 'GET', path: '/api/v1/admin/audit/export', auth: 'Secret Key', desc: 'Export audit log CSV' },
  { method: 'GET', path: '/embed/session/:id', auth: 'JWT (query param)', desc: 'Embed viewer (iframe-friendly)' },
];

function methodClass(method) {
  switch (method) {
    case 'GET': return s.methodGet;
    case 'POST': return s.methodPost;
    case 'PUT': return s.methodPut;
    case 'DELETE': return s.methodDelete;
    default: return '';
  }
}

function ApiReference() {
  return (
    <section id="api-reference">
      <h2 className={s.sectionHeading}>API Reference</h2>

      <h3 className={s.subHeading}>Authentication headers</h3>
      <div className={s.callout}>
        <div className={s.calloutRow}>
          <strong>Secret Key:</strong> <code>X-API-Key: cb_sk_...</code>
        </div>
        <div className={s.calloutRow}>
          <strong>Public Key:</strong> <code>X-CB-Public-Key: cb_pk_...</code>
        </div>
        <div className={s.calloutRow}>
          <strong>JWT:</strong> <code>Authorization: Bearer eyJhbG...</code>
        </div>
      </div>

      <h3 className={s.subHeading}>Endpoints</h3>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Auth</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={`${ep.method}-${ep.path}`}>
                <td><span className={`${s.methodBadge} ${methodClass(ep.method)}`}>{ep.method}</span></td>
                <td><code>{ep.path}</code></td>
                <td>{ep.auth}</td>
                <td>{ep.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default ApiReference;
