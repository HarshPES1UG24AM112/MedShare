import { lazy, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from '@/auth/AuthContext';
import { FacilityScopeProvider } from '@/auth/FacilityScope';
import { ProtectedRoute, RequirePermission } from '@/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui';
import { createQueryClient } from '@/lib/queryClient';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/NotFoundPage';

// Route-level code splitting keeps the first load small; charts are the heaviest chunk.
const MedicinesPage = lazy(() => import('@/features/medicines/MedicinesPage'));
const MedicineDetailPage = lazy(() => import('@/features/medicines/MedicineDetailPage'));
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'));
const MovementsPage = lazy(() => import('@/features/inventory/MovementsPage'));
const FacilitiesPage = lazy(() => import('@/features/facilities/FacilitiesPage'));
const FacilityDetailPage = lazy(() => import('@/features/facilities/FacilityDetailPage'));
const ExpiryPage = lazy(() => import('@/features/expiry/ExpiryPage'));
const ShortagesPage = lazy(() => import('@/features/shortages/ShortagesPage'));
const RedistributionPage = lazy(() => import('@/features/redistribution/RedistributionPage'));
const TransfersPage = lazy(() => import('@/features/transfers/TransfersPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));

function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-ink-400">
      <Loader2 className="size-5 animate-spin" aria-label="Loading page" />
    </div>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route element={<ProtectedRoute />}>
                <Route
                  element={
                    <FacilityScopeProvider>
                      <AppShell fallback={<PageFallback />} />
                    </FacilityScopeProvider>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="medicines" element={<MedicinesPage />} />
                  <Route path="medicines/:id" element={<MedicineDetailPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="inventory/movements" element={<MovementsPage />} />
                  <Route path="facilities" element={<FacilitiesPage />} />
                  <Route path="facilities/:id" element={<FacilityDetailPage />} />
                  <Route path="expiry" element={<ExpiryPage />} />
                  <Route path="shortages" element={<ShortagesPage />} />
                  <Route path="redistribution" element={<RedistributionPage />} />
                  <Route path="transfers" element={<TransfersPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route
                    path="audit"
                    element={
                      <RequirePermission permission="audit:view">
                        <AuditPage />
                      </RequirePermission>
                    }
                  />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
