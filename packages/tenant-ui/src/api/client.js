const BASE = '/api/v1/portal';

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Fetch wrapper for portal API calls.
 * - Prepends /api/v1/portal
 * - Sends credentials (cookies)
 * - Auto-redirects to /portal/login on 401
 */
async function apiFetch(path, options = {}) {
  const { body, ...rest } = options;

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

  const config = {
    credentials: 'include',
    headers,
    ...rest,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, config);

  if (response.status === 401 && !path.includes('/auth/')) {
    window.location.href = '/portal/login';
    return;
  }

  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new ApiError(response.status, data);
  }

  return data;
}

export { apiFetch, ApiError };
