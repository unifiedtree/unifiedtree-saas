import '@unifiedtree/design-system/tokens.css'
import './globals.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ThemeProvider } from './providers/ThemeProvider'
import { QueryProvider } from './providers/QueryProvider'
import { AuthProvider } from './providers/AuthProvider'
import { NotificationProvider } from './core/notifications/NotificationProvider'
import { ConfirmDialogProvider } from './shared/components/ConfirmDialog'
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
      <ThemeProvider>
        <QueryProvider>
          <BrowserRouter>
            <AuthProvider>
              <NotificationProvider>
                <ConfirmDialogProvider>
                  <App />
                  <Toaster richColors position="top-right" />
                </ConfirmDialogProvider>
              </NotificationProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryProvider>
      </ThemeProvider>
    </React.StrictMode>
  )
})
