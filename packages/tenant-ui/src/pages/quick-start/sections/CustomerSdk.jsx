import CodeBlock from '../../../components/CodeBlock.jsx';
import s from '../QuickStartPage.module.scss';

function CustomerSdk({ serverUrl }) {
  return (
    <section id="customer-sdk">
      <h2 className={s.sectionHeading}>Customer SDK</h2>
      <p className={s.paragraph}>
        The Customer SDK runs on your customer-facing website. It listens for
        co-browse invites, shows the consent prompt, captures the DOM (with sensitive
        fields masked), and streams it to the agent in real time.
      </p>

      <h3 className={s.subHeading}>1. Load the script</h3>
      <p className={s.paragraph}>
        Add the SDK script to every page where co-browsing should be available.
      </p>
      <CodeBlock
        label="HTML"
        code={`<script src="${serverUrl}/sdk/cobrowse.js"><\/script>`}
      />

      <h3 className={s.subHeading}>2. Initialize with the customer's ID</h3>
      <p className={s.paragraph}>
        The <code>customerId</code> is how CoBrowse knows which browser to reach.
        When an agent starts a session for <code>cust_123</code>, CoBrowse delivers
        the invite to the browser where the SDK was initialized
        with <code>customerId: 'cust_123'</code>.
      </p>
      <div className={s.callout}>
        <strong>Use your existing user ID.</strong> Whatever ID your system already
        assigns to this customer &mdash; user ID, account number, email, support
        ticket ID &mdash; pass it here. This must match the <code>customerId</code> your
        agent's backend sends when creating a session.
      </div>
      <CodeBlock
        label="JavaScript"
        code={`// Your app already knows who this user is
const currentUser = getCurrentUser(); // your auth system

CoBrowse.init({
  serverUrl:  '${serverUrl}',
  publicKey:  'YOUR_PUBLIC_KEY',
  customerId: currentUser.id,         // same ID your agent sees in the CRM
  onStateChange: function(state) {
    console.log('Co-browse state:', state);
  }
});`}
      />
      <p className={s.paragraph}>
        After this call, the SDK subscribes to a real-time channel scoped to this
        customer. It sits idle until an agent starts a session &mdash; no resources
        used, no data sent.
      </p>

      <h3 className={s.subHeading}>3. What the customer experiences</h3>
      <div className={s.flowTimeline}>
        <div className={s.flowStep}>
          <div className={s.flowStepLeft}>
            <div className={s.flowStepNumber}>1</div>
            <div className={s.flowStepLine} />
          </div>
          <div className={s.flowStepContent}>
            <div className={s.flowStepTitle}>SDK initialized &mdash; idle</div>
            <div className={s.flowStepDetail}>
              No visible UI, no data sent. The SDK waits for an invite from an agent.
            </div>
          </div>
        </div>
        <div className={s.flowStep}>
          <div className={s.flowStepLeft}>
            <div className={s.flowStepNumber}>2</div>
            <div className={s.flowStepLine} />
          </div>
          <div className={s.flowStepContent}>
            <div className={s.flowStepTitle}>Consent prompt appears</div>
            <div className={s.flowStepDetail}>
              When an agent starts a session, the customer sees: "Your support agent wants to
              view your screen." with <strong>Allow</strong> and <strong>Decline</strong> buttons.
            </div>
          </div>
        </div>
        <div className={s.flowStep}>
          <div className={s.flowStepLeft}>
            <div className={s.flowStepNumber}>3</div>
            <div className={s.flowStepLine} />
          </div>
          <div className={s.flowStepContent}>
            <div className={s.flowStepTitle}>Session active</div>
            <div className={s.flowStepDetail}>
              If the customer clicks Allow: a banner shows "Screen sharing is active",
              DOM capture starts streaming, and the agent's pointer overlay becomes visible.
              If they decline, the session ends and the agent is notified.
            </div>
          </div>
        </div>
        <div className={s.flowStep}>
          <div className={s.flowStepLeft}>
            <div className={s.flowStepNumber}>4</div>
          </div>
          <div className={s.flowStepContent}>
            <div className={s.flowStepTitle}>Session ended</div>
            <div className={s.flowStepDetail}>
              Either the customer or the agent ends the session. The banner disappears
              and the SDK returns to idle, ready for the next session.
            </div>
          </div>
        </div>
      </div>

      <h3 className={s.subHeading}>4. End session &amp; cleanup</h3>
      <CodeBlock
        label="JavaScript"
        code={`// End the current session (customer stays on page, SDK returns to idle)
CoBrowse.endSession();

// Full teardown (e.g. on logout or SPA route change)
CoBrowse.destroy();`}
      />

      <h3 className={s.subHeading}>5. Masking</h3>
      <p className={s.paragraph}>
        Sensitive fields (passwords, credit cards, SSNs) are masked <strong>client-side
        before any data leaves the customer's browser</strong>. Agents never see raw
        values. Configure masking rules from the tenant's <strong>Masking Rules</strong> page
        in this portal, or via the API.
      </p>
    </section>
  );
}

export default CustomerSdk;
