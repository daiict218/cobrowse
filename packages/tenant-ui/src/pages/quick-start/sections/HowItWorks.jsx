import s from '../QuickStartPage.module.scss';

const steps = [
  {
    actor: 'customer',
    label: 'Customer browses your website',
    detail: 'SDK is loaded and initialized with customerId: "cust_123". It subscribes to an Ably channel scoped to this ID and sits idle — no UI, no data sent.',
  },
  {
    actor: 'agent',
    label: 'Agent clicks "Start Co-Browse"',
    detail: 'The agent is already talking to cust_123 in your CRM. They click a button to start co-browsing.',
  },
  {
    actor: 'vendor',
    label: 'Your frontend calls your backend',
    detail: 'POST /api/start-cobrowse with { customerId: "cust_123" }. The agent\'s browser never talks to CoBrowse directly.',
  },
  {
    actor: 'vendor',
    label: 'Your backend calls CoBrowse API',
    detail: 'POST /api/v1/sessions with the secret key and customerId. The secret key never leaves your server.',
  },
  {
    actor: 'cobrowse',
    label: 'CoBrowse publishes invite via Ably',
    detail: 'The invite is sent to channel invite:{tenantId}:cust_123. Only the browser initialized with that customerId receives it.',
  },
  {
    actor: 'customer',
    label: 'Customer sees consent prompt',
    detail: '"Your support agent wants to view your screen. Allow?" The customer can accept or decline.',
  },
  {
    actor: 'customer',
    label: 'Customer clicks Allow',
    detail: 'The SDK starts capturing the DOM with sensitive fields masked client-side. Streaming begins via Ably.',
  },
  {
    actor: 'agent',
    label: 'Viewer opens with live reconstruction',
    detail: 'Your frontend opens the embed viewer URL. The viewer connects to Ably, receives DOM events, and reconstructs the page in real time.',
  },
];

const actorConfig = {
  agent: { label: 'Agent', className: 'actorAgent' },
  vendor: { label: 'Your System', className: 'actorVendor' },
  cobrowse: { label: 'CoBrowse', className: 'actorCobrowse' },
  customer: { label: 'Customer', className: 'actorCustomer' },
};

function HowItWorks() {
  return (
    <section id="how-it-works">
      <h2 className={s.sectionHeading}>How It Works</h2>
      <p className={s.paragraph}>
        Before diving into code, here's how the pieces connect. The most important
        concept: <strong>the <code>customerId</code> is how CoBrowse knows which browser
        to reach</strong>.
      </p>

      <h3 className={s.subHeading}>The key idea: customerId</h3>
      <p className={s.paragraph}>
        Your system already has an ID for every customer (user ID, account number,
        email, etc.). You pass this same ID to CoBrowse on <strong>both sides</strong>:
      </p>
      <ul className={s.list}>
        <li>
          <strong>Customer side</strong> &mdash; the SDK on the customer's browser
          is initialized with <code>customerId: 'cust_123'</code>
        </li>
        <li>
          <strong>Agent side</strong> &mdash; when the agent clicks "Start Co-Browse",
          your backend sends <code>customerId: 'cust_123'</code> to the CoBrowse API
        </li>
      </ul>
      <p className={s.paragraph}>
        CoBrowse uses this ID to route the invite to the right browser. That's it &mdash;
        no magic, no device fingerprinting. Your system is the source of truth for
        customer identity.
      </p>

      <h3 className={s.subHeading}>Full session flow</h3>
      <div className={s.flowTimeline}>
        {steps.map((step, i) => {
          const actor = actorConfig[step.actor];
          return (
            <div key={i} className={s.flowStep}>
              <div className={s.flowStepLeft}>
                <div className={s.flowStepNumber}>{i + 1}</div>
                {i < steps.length - 1 && <div className={s.flowStepLine} />}
              </div>
              <div className={s.flowStepContent}>
                <span className={`${s.actorBadge} ${s[actor.className]}`}>
                  {actor.label}
                </span>
                <div className={s.flowStepTitle}>{step.label}</div>
                <div className={s.flowStepDetail}>{step.detail}</div>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className={s.subHeading}>What you need to build</h3>
      <p className={s.paragraph}>
        The flow above shows two integration points on your side:
      </p>
      <div className={s.diagram2Col}>
        <div className={s.diagramCard}>
          <div className={s.diagramCardTitle}>Customer's website</div>
          <div className={s.diagramCardBody}>
            Add the CoBrowse SDK script and
            call <code>CoBrowse.init()</code> with
            the customer's ID. That's it &mdash; the SDK handles
            invites, consent, capture, and streaming.
          </div>
        </div>
        <div className={s.diagramCard}>
          <div className={s.diagramCardTitle}>Agent's app (your CRM)</div>
          <div className={s.diagramCardBody}>
            Add a backend endpoint that calls the CoBrowse API
            to create sessions. Frontend opens the embed viewer URL.
            The viewer is hosted by CoBrowse &mdash; it handles
            everything.
          </div>
        </div>
      </div>
    </section>
  );
}

export default HowItWorks;
