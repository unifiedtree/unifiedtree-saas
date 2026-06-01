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
import App from './App'

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <QueryProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
              <Toaster richColors position="top-right" />
            </AuthProvider>
          </BrowserRouter>
        </QueryProvider>
      </ThemeProvider>
    </React.StrictMode>
  )
})
