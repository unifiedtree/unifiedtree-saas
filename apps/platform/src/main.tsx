import '@unifiedtree/design-system/tokens.css'
import './design/theme/tokens.css'
import './globals.css'
import './design/theme/base.css'
import './design/theme/dark-bridge.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ThemeProvider, ThemeRoute } from './design/theme'
import { QueryProvider } from './providers/QueryProvider'
import { AuthProvider } from './providers/AuthProvider'
import { WorkspaceHostGate } from './core/tenant/WorkspaceHostGate'
import { NotificationProvider } from './core/notifications/NotificationProvider'
import { ConfirmDialogProvider } from './shared/components/ConfirmDialog'
import { CurrentCompanyProvider } from './modules/hrms/company/CurrentCompany'
import { AppCrashBoundary } from './shared/components/AppCrashBoundary'
import App from './App'

// In production builds import.meta.env.DEV is a static `false`, so Vite/Rollup
// tree-shakes the entire `./mocks/browser` (and its transitive `./mocks/handlers`
// with the fake HR_ADMIN token) out of the shipped bundle. Guarded a second
// time inside browser.ts by an import.meta.env.PROD early-return, so even a
// stray dev-time import cannot start the worker in a prod deploy.
const enableMocking = import.meta.env.DEV
  ? async () => {
      const { enableMocking: startWorker } = await import('./mocks/browser')
      await startWorker()
    }
  : async () => {}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* Above everything: a crash in a provider or the shell shows "Something went wrong", never a white page. */}
      <AppCrashBoundary>
      <ThemeProvider>
        <QueryProvider>
          <BrowserRouter>
            <ThemeRoute />
            {/* An unknown or reserved address (tata., admin., ...) gets its own page, never a sign-in. */}
            <WorkspaceHostGate>
            <AuthProvider>
              <NotificationProvider>
                <ConfirmDialogProvider>
                  {/* The HRMS's current company (the top bar's company selector). */}
                  <CurrentCompanyProvider>
                    <App />
                  </CurrentCompanyProvider>
                  <Toaster richColors position="top-right" />
                </ConfirmDialogProvider>
              </NotificationProvider>
            </AuthProvider>
            </WorkspaceHostGate>
          </BrowserRouter>
        </QueryProvider>
      </ThemeProvider>
      </AppCrashBoundary>
    </React.StrictMode>
  )
})
