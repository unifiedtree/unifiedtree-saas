import '@unifiedtree/design-system/tokens.css'
import './globals.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { enableMocking } from './mocks/browser'
import { ThemeProvider } from './providers/ThemeProvider'
import { QueryProvider } from './providers/QueryProvider'
import { AuthProvider } from './providers/AuthProvider'
import { NotificationProvider } from './core/notifications/NotificationProvider'
import { ConfirmDialogProvider } from './shared/components/ConfirmDialog'
import App from './App'

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
