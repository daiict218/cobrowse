import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import s from './SessionReplayPage.module.scss';

// ─── Dynamic rrweb loader ────────────────────────────────────────────────────

function useRrweb() {
  const [loaded, setLoaded] = useState(!!window.rrweb);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (window.rrweb) {
      setLoaded(true);
      return;
    }

    // Load CSS
    if (!document.querySelector('link[href="/static/vendor/rrweb.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/static/vendor/rrweb.css';
      document.head.appendChild(link);
    }

    // Load JS
    const existing = document.querySelector('script[src="/static/vendor/rrweb.js"]');
    if (existing) {
      existing.addEventListener('load', () => setLoaded(true));
      existing.addEventListener('error', () => setError('Failed to load rrweb'));
      return;
    }

    const script = document.createElement('script');
    script.src = '/static/vendor/rrweb.js';
    script.onload = () => setLoaded(true);
    script.onerror = () => setError('Failed to load rrweb');
    document.head.appendChild(script);
  }, []);

  return { loaded, error };
}

// ─── Time formatting ─────────────────────────────────────────────────────────

function formatTime(ms) {
  if (ms == null || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const SPEEDS = [1, 2, 4, 8];

function SessionReplayPage() {
  const { id, sessionId } = useParams();
  const { data, loading, error, reload } = useFetch(`/tenants/${id}/recordings/${sessionId}`);
  const { loaded: rrwebLoaded, error: rrwebError } = useRrweb();

  const containerRef = useRef(null);
  const replayerRef = useRef(null);
  const rafRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [speed, setSpeed] = useState(1);

  // Initialize replayer once data + rrweb are ready
  useEffect(() => {
    if (!rrwebLoaded || !data?.events?.length || !containerRef.current) return;

    // Destroy existing replayer
    if (replayerRef.current) {
      try { replayerRef.current.pause(); } catch { /* ignore */ }
      replayerRef.current = null;
    }

    // Clear container
    containerRef.current.innerHTML = '';

    const replayer = new window.rrweb.Replayer(data.events, {
      root: containerRef.current,
      liveMode: false,
      mouseTail: false,
      skipInactive: true,
    });

    replayerRef.current = replayer;

    // Calculate total duration from events
    const firstTs = data.events[0]?.timestamp || 0;
    const lastTs = data.events[data.events.length - 1]?.timestamp || 0;
    const duration = lastTs - firstTs;
    setTotalTime(duration);
    setCurrentTime(0);
    setPlaying(false);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (replayerRef.current) {
        try { replayerRef.current.pause(); } catch { /* ignore */ }
        replayerRef.current = null;
      }
    };
  }, [rrwebLoaded, data]);

  // Progress tracking loop
  useEffect(() => {
    if (!playing || !replayerRef.current) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    function tick() {
      if (!replayerRef.current) return;
      try {
        const time = replayerRef.current.getCurrentTime();
        setCurrentTime(time);
        if (time >= totalTime) {
          setPlaying(false);
          return;
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, totalTime]);

  // Sync speed
  useEffect(() => {
    if (replayerRef.current) {
      replayerRef.current.setConfig({ speed });
    }
  }, [speed]);

  const handlePlayPause = useCallback(() => {
    if (!replayerRef.current) return;
    if (playing) {
      replayerRef.current.pause();
      setPlaying(false);
    } else {
      // If at end, restart from beginning
      if (currentTime >= totalTime && totalTime > 0) {
        replayerRef.current.play(0);
      } else {
        replayerRef.current.play(currentTime);
      }
      setPlaying(true);
    }
  }, [playing, currentTime, totalTime]);

  const handleSeek = useCallback((e) => {
    if (!replayerRef.current || totalTime <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = Math.floor(ratio * totalTime);
    replayerRef.current.play(targetTime);
    setCurrentTime(targetTime);
    setPlaying(true);
  }, [totalTime]);

  const progress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (rrwebError) return <ErrorBanner message={rrwebError} />;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <Link to={`/portal/tenants/${id}/recordings`} className={s.backLink}>
          &larr; Back to recordings
        </Link>
        <h1 className={s.title}>Session Replay</h1>
        {data?.meta && (
          <div className={s.meta}>
            <span>Agent: {data.meta.agent_id || '-'}</span>
            <span>Events: {data.meta.event_count || data.events?.length || 0}</span>
            <span>Duration: {formatTime(data.meta.duration_ms || totalTime)}</span>
          </div>
        )}
      </div>

      <div className={s.viewer}>
        {!rrwebLoaded && <LoadingSpinner />}
        <div ref={containerRef} className={s.replayContainer} />
      </div>

      <div className={s.controls}>
        <button
          className={s.playBtn}
          onClick={handlePlayPause}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '\u23F8' : '\u25B6'}
        </button>

        <span className={s.time}>
          {formatTime(currentTime)} / {formatTime(totalTime)}
        </span>

        <div className={s.progressBar} onClick={handleSeek}>
          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className={s.speedControls}>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              className={`${s.speedBtn} ${speed === sp ? s.speedBtnActive : ''}`}
              onClick={() => setSpeed(sp)}
            >
              {sp}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SessionReplayPage;
