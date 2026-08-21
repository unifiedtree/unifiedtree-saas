import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

export async function enableMocking(): Promise<void> {
  // Hard block: never start the MSW worker in a production build, even if
  // something imports this module and calls enableMocking() directly. The
  // fake HR_ADMIN token in ./handlers must never intercept real requests.
  if (import.meta.env.PROD) return
  if (import.meta.env.VITE_MOCK !== 'true') return
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
