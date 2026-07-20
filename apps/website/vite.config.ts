import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Backend the dev server proxies /api/* to. Defaults to the hosted API so
// local login works out of the box; override with VITE_PROXY_TARGET if needed.
// (Previous target: https://erpinfrastructure-production.up.railway.app)
const API_PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'https://api.unifiedtree.com'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
          })
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['lucide-react', 'clsx', 'framer-motion'],
          'state': ['zustand'],
        },
      },
    },
  },
})
