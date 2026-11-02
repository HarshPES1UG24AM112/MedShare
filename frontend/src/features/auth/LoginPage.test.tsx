import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/ui';
import { createQueryClient } from '@/lib/queryClient';
import { LoginPage } from './LoginPage';

function renderLogin() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/login']}>
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
  it('validates required fields before calling the API', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('shows the server error for wrong credentials', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/Work email/), 'admin@medshare.health');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('signs in with a demo account and redirects to the dashboard', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /Administrator/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });
});
