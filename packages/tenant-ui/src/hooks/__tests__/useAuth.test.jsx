import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../useAuth.jsx';

vi.mock('../../api/client.js', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../api/client.js';

function TestConsumer() {
  const { user, loading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{loading.toString()}</span>
      <span data-testid="user">{user ? user.name : 'none'}</span>
      <button onClick={() => login('test@test.com', 'pass')}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAuth', () => {
  it('starts loading and fetches /auth/me', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/auth/me') {
        return Promise.resolve({ user: { name: 'TestUser', email: 'test@t.com', role: 'admin' } });
      }
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Initially loading
    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('user').textContent).toBe('TestUser');
  });

  it('sets user to null when /auth/me fails', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new Error('Unauthorized')));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('login sets user', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/auth/me') return Promise.reject(new Error('No session'));
      if (path === '/auth/login') {
        return Promise.resolve({ user: { name: 'LoggedIn', email: 'x@x.com', role: 'admin' } });
      }
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    await act(async () => {
      screen.getByText('Login').click();
    });

    expect(screen.getByTestId('user').textContent).toBe('LoggedIn');
  });

  it('logout clears user', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/auth/me') return Promise.resolve({ user: { name: 'User', email: 'x', role: 'admin' } });
      if (path === '/auth/logout') return Promise.resolve({ ok: true });
      return Promise.resolve({});
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('User');
    });

    await act(async () => {
      screen.getByText('Logout').click();
    });

    expect(screen.getByTestId('user').textContent).toBe('none');
  });
});
