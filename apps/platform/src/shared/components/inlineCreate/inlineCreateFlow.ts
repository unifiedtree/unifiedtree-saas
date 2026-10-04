// The steps behind "Create" beside a form field (Add employee → Create beside
// Department, Shift, Role…): a side panel opens over the form, the new item is
// saved, then the panel closes and the field is given the new item. A failed
// save keeps the panel open with everything typed in it and says why. Plain
// TypeScript so the steps can be tested on their own; useCreatePanel
// (InlineCreate.tsx) drives it from React.

export interface CreateFlowState {
  open: boolean
  /** Saving: the panel's buttons are inactive and it can't be closed. */
  busy: boolean
  /** Why the last save failed, in plain words. */
  error: string | null
}

export const CLOSED: CreateFlowState = { open: false, busy: false, error: null }

/** The reason shown on a Create someone may not use, e.g. "You need permission to manage departments — ask an admin." */
export const needPermission = (what: string) => `You need permission to manage ${what} — ask an admin.`

export interface CreateFlow {
  state: () => CreateFlowState
  open: () => void
  /** Cancel, the close button, Escape or the backdrop. Ignored while saving. */
  cancel: () => void
  /**
   * Runs the save. On success `then` gets its result (the field selects the new
   * item there) and the panel closes; on failure the panel stays open with the
   * reason. Resolves to whether it saved. Ignored while a save is running.
   */
  save: <T>(work: () => Promise<T>, then?: (value: T) => void) => Promise<boolean>
}

export function createFlow(onChange: (s: CreateFlowState) => void, errorOf: (e: unknown) => string): CreateFlow {
  let s = CLOSED
  const emit = (next: CreateFlowState) => { s = next; onChange(next) }
  return {
    state: () => s,
    open: () => { if (!s.open) emit({ open: true, busy: false, error: null }) },
    cancel: () => { if (s.open && !s.busy) emit(CLOSED) },
    async save(work, then) {
      if (!s.open || s.busy) return false
      emit({ open: true, busy: true, error: null })
      let value
      try {
        value = await work()
      } catch (e) {
        emit({ open: true, busy: false, error: errorOf(e) })
        return false
      }
      try { then?.(value) } finally { emit(CLOSED) }
      return true
    },
  }
}
