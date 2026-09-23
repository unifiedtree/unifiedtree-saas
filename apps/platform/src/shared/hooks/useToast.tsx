import { toast as notify } from 'sonner'
import type { Toast } from '@/types'

// Use the Toaster mounted in main.tsx. The former context silently discarded
// every notification because its provider was never mounted in the live app.
const notifications = {
  toast(message: string, type: Toast['type']) {
    notify[type](message)
  },
}
export const useToast = () => notifications
