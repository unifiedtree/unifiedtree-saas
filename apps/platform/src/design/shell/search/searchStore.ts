// Whether the ⌘K search dialog is open. One dialog for the whole app: the top bar's search pill,
// ⌘K / Ctrl+K and the phone's search icon all open it (openSearch).
import { create } from 'zustand'

interface SearchState {
  open: boolean
  /** Text to start with. */
  initial: string
  openSearch: (initial?: string) => void
  closeSearch: () => void
  toggleSearch: () => void
}

export const useSearchStore = create<SearchState>()((set) => ({
  open: false,
  initial: '',
  openSearch: (initial = '') => set({ open: true, initial }),
  closeSearch: () => set({ open: false }),
  toggleSearch: () => set((s) => ({ open: !s.open, initial: '' })),
}))

/** Opens the search dialog (e.g. the phone's search icon). */
export const openSearch = (initial?: string) => useSearchStore.getState().openSearch(initial)
