import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../api/client.js';

/**
 * Data fetching hook with loading/error states.
 * Re-fetches when `deps` change. The `path` is read from a ref
 * so that callers can embed dynamic values in it without causing
 * infinite re-fetch loops.
 */
function useFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const currentPath = pathRef.current;
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch(currentPath);
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export { useFetch };
