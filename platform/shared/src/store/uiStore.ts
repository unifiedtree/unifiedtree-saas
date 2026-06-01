import { create } from 'zustand'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
}

interface UIState {
  sidebarCollapsed: boolean
  cmdPaletteOpen: boolean
  notificationPanelOpen: boolean
  theme: 'dark' | 'light'
  toasts: Toast[]

  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  openCmdPalette: () => void
  closeCmdPalette: () => void
  toggleCmdPalette: () => void
  openNotifications: () => void
  closeNotifications: () => void
  toggleNotifications: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void
  setTheme: (theme: 'dark' | 'light') => void
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  cmdPaletteOpen: false,
  notificationPanelOpen: false,
  theme: 'dark',
  toasts: [],

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  openCmdPalette: () => set({ cmdPaletteOpen: true }),

  closeCmdPalette: () => set({ cmdPaletteOpen: false }),

  toggleCmdPalette: () => set((s) => ({ cmdPaletteOpen: !s.cmdPaletteOpen })),

  openNotifications: () => set({ notificationPanelOpen: true }),

  closeNotifications: () => set({ notificationPanelOpen: false }),

  toggleNotifications: () =>
    set((s) => ({ notificationPanelOpen: !s.notificationPanelOpen })),

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newToast: Toast = { id, duration: 4000, ...toast }
    set((s) => ({ toasts: [...s.toasts, newToast] }))

    // Auto-remove after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => get().removeToast(id), newToast.duration)
    }
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clearToasts: () => set({ toasts: [] }),

  setTheme: (theme) => set({ theme }),
}))
