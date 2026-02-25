import { useState, useEffect, useRef } from 'react';
import CopyButton from '../../components/CopyButton.jsx';
import GettingStarted from './sections/GettingStarted.jsx';
import HowItWorks from './sections/HowItWorks.jsx';
import CustomerSdk from './sections/CustomerSdk.jsx';
import AgentSdk from './sections/AgentSdk.jsx';
import ApiReference from './sections/ApiReference.jsx';
import Security from './sections/Security.jsx';
import s from './QuickStartPage.module.scss';

const tocItems = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'customer-sdk', label: 'Customer SDK' },
  { id: 'agent-sdk', label: 'Agent Integration' },
  { id: 'api-reference', label: 'API Reference' },
  { id: 'security', label: 'Security' },
];

function QuickStartPage() {
  const [activeId, setActiveId] = useState(tocItems[0].id);
  const contentRef = useRef(null);

  // In dev, Vite runs on 5173 but the CoBrowse server is on 4000.
  // In production, Fastify serves the portal so window.location.origin is correct.
  const serverUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_SERVER_URL || 'http://localhost:4000')
    : window.location.origin;

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const sections = root.querySelectorAll('section[id]');
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    sections.forEach((sec) => observer.observe(sec));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Quick Start Guide</h1>
      </div>

      <div className={`card ${s.serverUrlCard}`}>
        <div className={s.serverUrlLabel}>Server URL</div>
        <p className={s.serverUrlHint}>
          Use this URL in your SDK integration. All code snippets below are pre-filled with it.
        </p>
        <div className={s.serverUrlRow}>
          <code className={s.serverUrlValue}>{serverUrl}</code>
          <CopyButton value={serverUrl} />
        </div>
      </div>

      <div className={s.layout}>
        <div className={s.content} ref={contentRef}>
          <GettingStarted />
          <HowItWorks />
          <CustomerSdk serverUrl={serverUrl} />
          <AgentSdk serverUrl={serverUrl} />
          <ApiReference />
          <Security />
        </div>

        <nav className={s.toc}>
          <div className={s.tocInner}>
            <div className={s.tocTitle}>On this page</div>
            {tocItems.map((item) => (
              <button
                key={item.id}
                className={`${s.tocLink}${activeId === item.id ? ` ${s.tocLinkActive}` : ''}`}
                onClick={() => scrollTo(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default QuickStartPage;
