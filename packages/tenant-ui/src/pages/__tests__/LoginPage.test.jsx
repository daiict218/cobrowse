import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../hooks/useAuth.jsx';

// Mock the apiFetch to control auth behavior
vi.mock('../../api/client.js', () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {
    constructor(status, body) {
      super(body?.message || 'Error');
      this.status = status;
    }
  },
}));

import { apiFetch } from '../../api/client.js';
import LoginPage from '../LoginPage.jsx';

function renderLogin() {
  // Mock /auth/me to return no user (not logged in)
  apiFetch.mockImplementation((path) => {
    if (path === '/auth/me') return Promise.reject(new Error('Not logged in'));
    return Promise.reject(new Error('Unknown'));
  });

  return render(
    <BrowserRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </BrowserRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders login form', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows error on failed login', async () => {
    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    // Override mock for login call
    apiFetch.mockImplementation((path) => {
      if (path === '/auth/me') return Promise.reject(new Error('Not logged in'));
      if (path === '/auth/login') return Promise.reject(new Error('Invalid email or password'));
      return Promise.reject(new Error('Unknown'));
    });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad@test.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
    });
  });

  it('displays portal branding', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.getByText('CoBrowse')).toBeInTheDocument();
    });
    expect(screen.getByText('Vendor Portal')).toBeInTheDocument();
  });
});
