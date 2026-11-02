import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/ui';
import { createQueryClient } from '@/lib/queryClient';
import { LoginPage } from './LoginPage';

const login = vi.fn();
const me = vi.fn();

// The page talks to the API module only; replace it so no network is involved.
vi.mock('@/api', async () => {
  const client = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ApiError: client.ApiError, api: { auth: { login: (...a: unknown[]) => login(...a), me: () => me() } } };
});

const ME = {
  id: 1,
  email: 'admin@medshare.health',
  fullName: 'Asha Raman (Synthetic)',
  roles: [{ role: 'SYSTEM_ADMIN', organizationId: null, organizationName: null }],
  facilities: [],
  scopeFacilityIds: [1],
  platformScope: true,
  permissions: ['user:manage'],
  facilityPermissions: {},
};

function renderLogin() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<p>Dashboard home</p>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    login.mockReset();
    me.mockReset();
  });

  it('validates required fields before calling the API', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the server message for wrong credentials', async () => {
    login.mockRejectedValue(new ApiError('Incorrect email or password.', 401, 'INVALID_CREDENTIALS'));
    renderLogin();
    await userEvent.type(screen.getByLabelText(/Work email/), 'admin@medshare.health');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('stores the access token and redirects to the dashboard', async () => {
    login.mockResolvedValue({ accessToken: 'token-123', tokenType: 'Bearer', expiresIn: '8h', user: ME });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/Work email/), 'admin@medshare.health');
    await userEvent.type(screen.getByLabelText(/^Password/), 'MedShare@2026');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({ email: 'admin@medshare.health', password: 'MedShare@2026' });
    expect(localStorage.getItem('medshare.accessToken')).toBe('token-123');
  });

  it('offers the synthetic demo accounts in development builds only', () => {
    renderLogin();
    // Vitest runs with import.meta.env.DEV = true; production builds tree-shake this panel away.
    expect(screen.getByText(/Synthetic demo accounts/)).toBeInTheDocument();
    expect(screen.queryByText(/Request an account/)).not.toBeInTheDocument();
  });
});
