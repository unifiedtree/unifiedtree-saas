// "Create" beside a form field, and the side panel it opens over the form
// (Add employee → Create beside Branch, Department, Designation, Employment
// type, Shift, Staffing agency and Roles). One pattern for every field:
//   const panel = useCreatePanel()
//   <CreateButton ref={panel.trigger} noun="department" blockedReason={…} onClick={panel.start} />
//   <CreatePanel open={panel.open} busy={panel.busy} error={panel.error} onCancel={panel.cancel}
//     onSubmit={() => panel.save(saveIt, { then: selectIt, focus: () => theField })} …>the add form</CreatePanel>
// The form underneath stays mounted while the panel is open, so nothing typed
// there is lost. Escape closes only the panel (the kit's layer stack; the Master
// design's drawers wait for kit layers). Focus goes back to Create on cancel,
// and to the field that now shows the new item after a save.
import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { SidePanel, PanelButton, kitIcon } from '@/design/kit/overlays'
import { Callout, errorText } from '@/design/kit/display'
import { CLOSED, createFlow, type CreateFlowState } from './inlineCreateFlow'

export { needPermission } from './inlineCreateFlow'

/**
 * The panel's layer: above the Master design's drawers (201) and below its
 * dropdown lists (300), so a Master add form shown in the panel can still open
 * its lists. Kit toasts (1400) and the shared calendar stay on top.
 */
export const CREATE_PANEL_Z = 250

const COMPACT: CSSProperties = { height: 24, padding: '0 7px', gap: 4, fontSize: 12.5, borderRadius: 7 }
const COMPACT_BLOCKED: CSSProperties = { ...COMPACT, color: 'var(--u-ink3, #6A7A73)' }

export interface CreateButtonProps {
  /** What it creates, for its accessible name: "department" → "Create department". */
  noun: string
  /** When set, Create is shown but inactive, with this as its tooltip and description. */
  blockedReason?: string | null
  onClick: () => void
}

/** The small "Create" next to a field's label. */
export const CreateButton = forwardRef<HTMLButtonElement, CreateButtonProps>(function CreateButton({ noun, blockedReason, onClick }, ref) {
  return (
    <PanelButton ref={ref} variant="ghost" icon={kitIcon('plus', 14)} blockedReason={blockedReason} tipAlign="end"
      aria-label={`Create ${noun}`} data-inline-create={noun} style={blockedReason ? COMPACT_BLOCKED : COMPACT} onClick={onClick}>
      Create
    </PanelButton>
  )
})

export interface CreatePanelProps {
  open: boolean
  title: ReactNode
  sub?: ReactNode
  /** The save button, e.g. "Add department". */
  cta: ReactNode
  busy: boolean
  error: string | null
  onSubmit: () => void
  onCancel: () => void
  width?: number
  children: ReactNode
}

/** The side panel over the form: the add form, a save error if there was one, Cancel and the save button. */
export function CreatePanel({ open, title, sub, cta, busy, error, onSubmit, onCancel, width = 560, children }: CreatePanelProps) {
  return (
    <SidePanel open={open} onClose={onCancel} title={title} sub={sub} width={width} busy={busy} zIndex={CREATE_PANEL_Z}
      footer={<>
        <PanelButton size="lg" onClick={onCancel} aria-disabled={busy || undefined}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={busy} onClick={onSubmit}>{busy ? 'Saving…' : cta}</PanelButton>
      </>}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }} data-inline-create-panel="">
        {error && <Callout tone="danger" icon="alertTriangle" live>{error}</Callout>}
        {children}
      </div>
    </SidePanel>
  )
}

export interface CreateSaveOptions<T> {
  /** Runs once the save worked, before the panel closes: select the new item here. */
  then?: (value: T) => void
  /** Where focus goes once the panel has closed (the field now showing the new item). */
  focus?: (value: T) => HTMLElement | null | undefined
}

/** Open / save / cancel for one Create panel, and where focus goes after it closes. */
export function useCreatePanel() {
  const [state, setState] = useState<CreateFlowState>(CLOSED)
  const flow = useMemo(() => createFlow(setState, (e) => errorText(e, 'It couldn’t be saved. Please try again.')), [])
  const trigger = useRef<HTMLButtonElement>(null)
  const focusNext = useRef<(() => HTMLElement | null | undefined) | null>(null)

  // Runs after the panel's own focus return (to Create), so a save moves focus on to the field.
  useEffect(() => {
    if (state.open || !focusNext.current) return
    const target = focusNext.current()
    focusNext.current = null
    if (target && target.isConnected) target.focus()
  }, [state.open])

  return {
    ...state,
    trigger,
    start: flow.open,
    cancel: flow.cancel,
    save: <T,>(work: () => Promise<T>, opts: CreateSaveOptions<T> = {}) => flow.save(work, (value) => {
      focusNext.current = opts.focus ? () => opts.focus!(value) : null
      opts.then?.(value)
    }),
  }
}
