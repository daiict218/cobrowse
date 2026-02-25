import s from '../QuickStartPage.module.scss';

function Security() {
  return (
    <section id="security">
      <h2 className={s.sectionHeading}>Security Best Practices</h2>

      <h3 className={s.subHeading}>1. Keep keys out of client code</h3>
      <p className={s.paragraph}>
        Store secret keys in environment variables or a secrets manager.
        Only the <strong>public key</strong> belongs in browser-side code.
        The secret key should only be used in your backend server.
      </p>

      <h3 className={s.subHeading}>2. Use HTTPS in production</h3>
      <p className={s.paragraph}>
        All API calls and SDK connections must use HTTPS in production.
        The SDK and agent scripts refuse to connect over plain HTTP in
        non-localhost environments.
      </p>

      <h3 className={s.subHeading}>3. Client-side masking</h3>
      <p className={s.paragraph}>
        Sensitive fields (passwords, credit cards, SSNs) are masked <strong>before
        any data leaves the customer's browser</strong>. The masking engine runs
        inside the SDK &mdash; agents never see raw values. Configure masking
        rules via the portal or the API.
      </p>

      <h3 className={s.subHeading}>4. Consent-first design</h3>
      <p className={s.paragraph}>
        Customers must explicitly accept co-browsing. They can pause, resume,
        or stop sharing at any time. The consent UI is rendered by the SDK and
        cannot be bypassed by the agent.
      </p>

      <h3 className={s.subHeading}>5. Scoped Ably tokens</h3>
      <p className={s.paragraph}>
        Each participant receives an Ably token with the minimum required
        channel permissions. Customers can only publish to their session
        channel. Agents can only subscribe to sessions they created.
        Tokens are short-lived and session-bound.
      </p>

      <h3 className={s.subHeading}>6. Tenant isolation</h3>
      <p className={s.paragraph}>
        All database queries are scoped by <code>tenant_id</code>. Ably channels
        are prefixed with the tenant identifier. One tenant's data is never
        accessible to another, even in a shared deployment.
      </p>
    </section>
  );
}

export default Security;
