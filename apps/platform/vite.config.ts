import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Subpath alias must come before the package root alias
      {
        find: '@unifiedtree/design-system/tokens.css',
        replacement: path.resolve(__dirname, '../../packages/design-system/src/tokens.css'),
      },
      {
        find: '@unifiedtree/design-system',
        replacement: path.resolve(__dirname, '../../packages/design-system/src'),
      },
      {
        find: '@unifiedtree/sdk',
        replacement: path.resolve(__dirname, '../../packages/sdk/src'),
      },
      {
        find: '@unifiedtree/ui-kit',
        replacement: path.resolve(__dirname, '../../packages/ui-kit/src'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api': {
        target: 'https://unifiedtree-saas-production.up.railway.app',
        changeOrigin: true,
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
          'charts':       ['recharts'],
          'ui-vendor':    ['lucide-react', 'clsx', 'tailwind-merge', 'date-fns'],
          'forms':        ['react-hook-form', 'zod', '@hookform/resolvers'],
          'state':        ['zustand'],
          'motion':       ['framer-motion'],
        },
      },
    },
  },
})
