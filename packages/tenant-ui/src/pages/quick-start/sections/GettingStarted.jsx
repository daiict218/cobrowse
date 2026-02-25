import { Link } from 'react-router-dom';
import s from '../QuickStartPage.module.scss';

function GettingStarted() {
  return (
    <section id="getting-started">
      <h2 className={s.sectionHeading}>Getting Started</h2>

      <h3 className={s.subHeading}>1. Create a tenant</h3>
      <p className={s.paragraph}>
        Each tenant represents one environment (e.g. production, staging).
        Go to <Link to="/portal/tenants/new">Tenants &rarr; Create New</Link> to
        create one. You'll receive two API keys:
      </p>

      <div className={s.callout}>
        <div className={s.calloutRow}>
          <strong>Secret Key</strong> (<code>cb_sk_...</code>) &mdash; server-side only.
          Authenticates agent API calls. Never expose in client-side code.
        </div>
        <div className={s.calloutRow}>
          <strong>Public Key</strong> (<code>cb_pk_...</code>) &mdash; safe for browsers.
          Used by the Customer SDK to identify your tenant.
        </div>
      </div>

      <h3 className={s.subHeading}>2. Store keys securely</h3>
      <p className={s.paragraph}>
        Both keys are shown <strong>once</strong> at creation (and on rotation).
        Copy them immediately and store in environment variables or a secrets manager.
        If you lose the secret key, rotate from the tenant detail page.
      </p>

      <h3 className={s.subHeading}>3. Allowed domains</h3>
      <p className={s.paragraph}>
        Set your allowed domains on the tenant to restrict which origins can use the SDK.
        Leave empty during development to allow all origins.
      </p>
    </section>
  );
}

export default GettingStarted;
