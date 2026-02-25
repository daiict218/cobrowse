import CodeBlock from '../../../components/CodeBlock.jsx';
import s from '../QuickStartPage.module.scss';

function AgentSdk({ serverUrl }) {
  return (
    <section id="agent-sdk">
      <h2 className={s.sectionHeading}>Agent Integration</h2>
      <p className={s.paragraph}>
        When an agent clicks "Start Co-Browse" in your app, your backend creates the
        session via the CoBrowse API, and your frontend opens the live viewer. Here's the
        full flow:
      </p>

      <div className={s.stateFlow}>
        <span className={s.state}>Agent clicks button</span>
        <span className={s.arrow}>&rarr;</span>
        <span className={s.state}>Your frontend</span>
        <span className={s.arrow}>&rarr;</span>
        <span className={s.state}>Your backend</span>
        <span className={s.arrow}>&rarr;</span>
        <span className={s.state}>CoBrowse API</span>
        <span className={s.arrow}>&rarr;</span>
        <span className={s.state}>Viewer opens</span>
      </div>

      <h3 className={s.subHeading}>1. Set up JWT authentication (one-time)</h3>
      <p className={s.paragraph}>
        Agents are authenticated automatically via your existing login system &mdash;
        no agent setup required. This is a <strong>one-time</strong> developer task.
      </p>

      <h4 className={s.stepLabel}>How it works</h4>
      <p className={s.paragraph}>
        You generate a key pair &mdash; two mathematically linked keys. You keep
        the <strong>private key</strong> on your server and share
        the <strong>public key</strong> with CoBrowse. Your backend signs JWTs with the
        private key. CoBrowse verifies the signature using the public key you uploaded.
        If it checks out, we trust that you vouched for this agent. Your private key
        never leaves your server; we never see it.
      </p>

      <h4 className={s.stepLabel}>a) Generate an RS256 key pair</h4>
      <CodeBlock
        label="Terminal — run once"
        code={`# Generate private key (keep on your server, never share)
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048

# Extract public key (this gets uploaded to CoBrowse)
openssl rsa -in private.pem -pubout -out public.pem`}
      />

      <h4 className={s.stepLabel}>b) Upload your public key to CoBrowse</h4>
      <p className={s.paragraph}>
        Call this once per tenant (and again if you rotate keys).
      </p>
      <CodeBlock
        label="Terminal"
        code={`curl -X PUT ${serverUrl}/api/v1/admin/jwt-config \\
  -H "X-API-Key: YOUR_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "publicKeyPem": "'$(cat public.pem | sed ':a;N;$!ba;s/\\n/\\\\n/g')'"
  }'`}
      />

      <h3 className={s.subHeading}>2. Add two endpoints to your backend</h3>
      <p className={s.paragraph}>
        Your backend needs two endpoints: one to create a co-browse session, and one
        to generate a JWT so the agent's browser can open the viewer.
      </p>

      <h4 className={s.stepLabel}>a) Create session endpoint</h4>
      <p className={s.paragraph}>
        When the agent clicks "Start Co-Browse", your frontend calls your backend.
        Your backend then calls the CoBrowse API with the secret key. The secret key
        never leaves your server.
      </p>
      <CodeBlock
        label="Node.js — your backend"
        code={`import { SignJWT } from 'jose';
import { readFileSync } from 'fs';
import { createPrivateKey } from 'crypto';

const privateKey = createPrivateKey(readFileSync('./private.pem'));

// Agent clicks "Start Co-Browse" → your frontend calls this endpoint
app.post('/api/start-cobrowse', requireAuth, async (req, res) => {
  const { customerId } = req.body;

  // 1. Your backend creates the session via CoBrowse API
  const session = await fetch('${serverUrl}/api/v1/sessions', {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.COBROWSE_SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerId: customerId,
      agentId: req.user.id,
    }),
  }).then(r => r.json());

  // 2. Mint a JWT so the agent's browser can open the viewer
  const token = await new SignJWT({
    tenantId: process.env.COBROWSE_TENANT_ID,
    name: req.user.displayName,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(req.user.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  // 3. Return both to the frontend
  res.json({
    sessionId: session.sessionId,
    viewerUrl: '${serverUrl}/embed/session/'
      + session.sessionId
      + '?token=' + encodeURIComponent(token),
  });
});`}
      />
      <p className={s.paragraph}>
        The JWT must include these claims:
      </p>
      <div className={s.callout}>
        <div className={s.calloutRow}>
          <strong><code>sub</code></strong> (required) &mdash; the agent's unique ID in your system
        </div>
        <div className={s.calloutRow}>
          <strong><code>tenantId</code></strong> (required) &mdash; your CoBrowse tenant UUID
        </div>
        <div className={s.calloutRow}>
          <strong><code>name</code></strong> (optional) &mdash; agent display name shown to customers
        </div>
        <div className={s.calloutRow}>
          <strong><code>exp</code></strong> (recommended) &mdash; expiration (e.g. 1 hour)
        </div>
      </div>

      <h4 className={s.stepLabel}>b) End session endpoint</h4>
      <CodeBlock
        label="Node.js — your backend"
        code={`app.post('/api/end-cobrowse', requireAuth, async (req, res) => {
  await fetch('${serverUrl}/api/v1/sessions/' + req.body.sessionId, {
    method: 'DELETE',
    headers: { 'X-API-Key': process.env.COBROWSE_SECRET_KEY },
  });
  res.json({ ended: true });
});`}
      />

      <h3 className={s.subHeading}>3. Open the viewer in your frontend</h3>
      <p className={s.paragraph}>
        When the agent clicks the button, your frontend calls your backend, gets back
        a <code>viewerUrl</code>, and opens it. The viewer is a self-contained page hosted
        by CoBrowse &mdash; it handles the Ably connection, rrweb rendering, and all
        real-time updates automatically.
      </p>
      <CodeBlock
        label="JavaScript — your frontend"
        code={`document.getElementById('start-cobrowse').addEventListener('click', async () => {
  // 1. Call YOUR backend (not CoBrowse directly)
  const res = await fetch('/api/start-cobrowse', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: currentCustomerId }),
  });
  const { sessionId, viewerUrl } = await res.json();

  // 2. Open viewer in a new window
  window.open(viewerUrl, 'cobrowse-viewer', 'width=1024,height=768');

  // 3. Or embed in an iframe
  // document.getElementById('viewer-frame').src = viewerUrl;
});`}
      />

      <h3 className={s.subHeading}>4. What happens next</h3>
      <ul className={s.list}>
        <li>CoBrowse sends an invite to the customer's browser via Ably (real-time).</li>
        <li>The customer sees a consent prompt and clicks <strong>Allow</strong>.</li>
        <li>The customer's SDK starts capturing the DOM and streaming it.</li>
        <li>The viewer reconstructs the page live &mdash; the agent sees exactly what the customer sees (with sensitive fields masked).</li>
        <li>Either side can end the session at any time.</li>
      </ul>

      <h3 className={s.subHeading}>5. Alternative: Agent SDK (optional convenience wrapper)</h3>
      <p className={s.paragraph}>
        If you prefer a JavaScript SDK instead of direct API calls, you can use
        the Agent SDK. It wraps <code>createSession</code> and <code>openViewer</code> into
        a single script. This calls the CoBrowse API directly from the agent's browser
        using a JWT &mdash; useful for quick prototyping but means session creation
        happens client-side instead of through your backend.
      </p>
      <CodeBlock
        label="HTML"
        code={`<script src="${serverUrl}/sdk/cobrowse-agent.js"><\/script>
<script>
  // Fetch JWT from your backend
  const res = await fetch('/api/cobrowse-token', { credentials: 'include' });
  const { token } = await res.json();

  const agent = CoBrowseAgent.init({
    serverUrl: '${serverUrl}',
    token: token,
  });

  // Creates session + opens viewer in one flow
  const session = await agent.createSession({ customerId: 'cust_123' });
  agent.openViewer(session.sessionId);
</script>`}
      />
    </section>
  );
}

export default AgentSdk;
