// The design's side panel (PgCompanies "Create branch" / "Add company", UtMore): square edges,
// a 1px left border, the gradient-blur backdrop, a header with title, sub-line and a round
// close button, an optional numbered step list (196px, done / current / todo), a scrolling
// body and a sticky footer. Full width on phones, where the step list becomes a row.
//
// Steps: every step stays mounted (inactive ones are `hidden`), so nothing typed is lost when
// moving between steps. A step's `blocker` keeps Next inactive with that text as its tooltip.
// Keyboard: Escape closes (unless something inside handled it first), Tab stays inside the panel,
// and focus goes back to where it was when the panel closes.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { kitIcon, useEscape, useFocusTrap, useLayer, type InitialFocus, type KitIcon } from './overlayCore'
import { PanelButton } from './PanelButton'
import './overlays.css'

export interface SidePanelStep {
  /** Stable key; defaults to the label. */
  key?: string
  /** Name in the step list, e.g. "Branch details". */
  label: string
  /** Section heading above the fields; defaults to the label. */
  title?: ReactNode
  /** One line under the section heading, e.g. "Basic details about this branch". */
  sub?: ReactNode
  /** Section icon: a design icon name (see design/dc/icons) or a node. */
  icon?: KitIcon
  /** While set, the step is incomplete: Next stays inactive and this text is its tooltip. */
  blocker?: string | null | false
  /** The step's fields. */
  content: ReactNode
}

export interface SidePanelProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  sub?: ReactNode
  /** Width in px: 480 by default, 680 with steps. Always full width on phones. */
  width?: number
  /** Extra classes on the panel; with one and no `width`, the classes decide the width. */
  panelClassName?: string
  /** Numbered steps shown in a list on the left; leave out for a plain panel. */
  steps?: SidePanelStep[]
  /** Controlled current step (0-based). Leave out to let the panel keep track. */
  step?: number
  onStepChange?: (index: number) => void
  /** Someone tried to move past a step that still has a blocker (e.g. show its inline errors). */
  onBlocked?: (index: number, reason: string) => void
  /** The last step's action (e.g. "Create branch"). */
  onFinish?: () => void
  finishLabel?: ReactNode
  nextLabel?: ReactNode
  backLabel?: ReactNode
  cancelLabel?: ReactNode
  /** Saving: the footer buttons are inactive and the panel can't be closed. */
  busy?: boolean
  busyLabel?: ReactNode
  /** Body of a plain panel. With steps it renders under the current step (e.g. a save error). */
  children?: ReactNode
  /** Footer of a plain panel; its buttons line up on the right unless `footerAlign="between"`. */
  footer?: ReactNode
  footerAlign?: 'end' | 'between'
  /** Accessible name of the round close button. */
  closeLabel?: string
  titleAs?: 'h2' | 'h3'
  /** Clicking the backdrop closes the panel (default true). */
  closeOnBackdrop?: boolean
  /** Where focus goes on open: the panel itself (default), its first control, or a given element. */
  initialFocus?: InitialFocus
  zIndex?: number
}

export function SidePanel(props: SidePanelProps) {
  if (!props.open || typeof document === 'undefined') return null
  return <OpenSidePanel {...props} />
}

function OpenSidePanel({
  onClose, title, sub, width, panelClassName, steps = [], step, onStepChange, onBlocked, onFinish,
  finishLabel = 'Save', nextLabel = 'Next', backLabel = 'Back', cancelLabel = 'Cancel', busy = false, busyLabel = 'Saving…',
  children, footer, footerAlign = 'end', closeLabel = 'Close', titleAs = 'h2', closeOnBackdrop = true,
  initialFocus = 'container', zIndex = 1000,
}: SidePanelProps) {
  const uid = useId()
  const titleId = `${uid}-title`, subId = `${uid}-sub`
  const panelRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const heads = useRef<(HTMLDivElement | null)[]>([])
  const moved = useRef(false)
  const [ownStep, setOwnStep] = useState(0)
  const isTop = useLayer(true)

  const hasSteps = steps.length > 0
  const last = Math.max(0, steps.length - 1)
  const cur = Math.min(Math.max(step ?? ownStep, 0), last)

  const close = () => { if (!busy) onClose() }
  useEscape(true, isTop, close)
  useFocusTrap(panelRef, true, isTop, initialFocus)

  /** The first unfinished step between `from` (inclusive) and `to` (exclusive). */
  const blockerIn = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const b = steps[i]?.blocker
      if (b) return { index: i, reason: String(b) }
    }
    return null
  }

  const goTo = (i: number) => {
    if (i === cur || i < 0 || i > last || busy) return
    if (i > cur) {
      const b = blockerIn(cur, i)
      if (b) { onBlocked?.(b.index, b.reason); return }
    }
    moved.current = true
    if (step === undefined) setOwnStep(i)
    onStepChange?.(i)
  }

  // After a step change, bring the new section into view and move focus to its heading.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    mainRef.current?.scrollTo?.({ top: 0 })
    heads.current[cur]?.focus({ preventScroll: true })
  }, [cur])

  const finishBlocker = hasSteps ? blockerIn(0, steps.length) : null
  const finish = () => { if (!busy) onFinish?.() }
  const finishBlocked = () => {
    if (!finishBlocker) return
    if (finishBlocker.index !== cur) goTo(finishBlocker.index)
    onBlocked?.(finishBlocker.index, finishBlocker.reason)
  }
  const nextBlocker = hasSteps && cur < last ? steps[cur]?.blocker || null : null

  const w = width ?? (panelClassName ? undefined : hasSteps ? 680 : 480)
  const panelStyle: CSSProperties | undefined = w ? { width: `min(${w}px, 100vw)` } : undefined
  const Title = titleAs

  const footerNode = hasSteps ? (
    <div className="uko-panel-foot" data-align="between">
      {cur === 0
        ? <PanelButton size="lg" onClick={close} aria-disabled={busy || undefined}>{cancelLabel}</PanelButton>
        : <PanelButton size="lg" onClick={() => goTo(cur - 1)} aria-disabled={busy || undefined}>{backLabel}</PanelButton>}
      {cur < last ? (
        <PanelButton size="lg" variant="primary" trailingIcon={nextBlocker ? undefined : 'arrowRight'} blockedReason={nextBlocker}
          onBlockedClick={() => nextBlocker && onBlocked?.(cur, String(nextBlocker))}
          busy={busy} onClick={() => goTo(cur + 1)}>
          {nextLabel}
        </PanelButton>
      ) : (
        <PanelButton size="lg" variant="primary" trailingIcon={busy || finishBlocker ? undefined : 'arrowRight'} blockedReason={finishBlocker?.reason}
          onBlockedClick={finishBlocked} busy={busy} onClick={finish}>
          {busy ? busyLabel : finishLabel}
        </PanelButton>
      )}
    </div>
  ) : footer ? (
    <div className="uko-panel-foot" data-align={footerAlign}>{footer}</div>
  ) : null

  return createPortal(
    <div className="uko-layer" style={{ zIndex }} data-uko-layer="">
      <div className="uko-backdrop" aria-hidden="true" onClick={closeOnBackdrop ? close : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={sub ? subId : undefined}
        tabIndex={-1}
        className={['uko-panel', panelClassName].filter(Boolean).join(' ')}
        style={panelStyle}
        data-steps={hasSteps ? '' : undefined}
      >
        <div className="uko-panel-head">
          <div className="uko-panel-headtext">
            <Title id={titleId} className="uko-panel-title">{title}</Title>
            {sub && <p id={subId} className="uko-panel-sub">{sub}</p>}
          </div>
          <button type="button" className="uko-close" aria-label={closeLabel} title={closeLabel} onClick={close} disabled={busy}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {hasSteps ? (
          <div className="uko-panel-body">
            <ol className="uko-steps" aria-label="Steps">
              {steps.map((s, i) => {
                const state = i < cur ? 'done' : i === cur ? 'current' : 'todo'
                const b = i > cur ? blockerIn(cur, i) : null
                return (
                  <li key={s.key ?? s.label}>
                    <button
                      type="button"
                      className="uko-step"
                      data-state={state}
                      aria-current={i === cur ? 'step' : undefined}
                      aria-disabled={b || busy ? true : undefined}
                      title={b ? b.reason : undefined}
                      onClick={() => goTo(i)}
                    >
                      <span className="uko-step-dot" aria-hidden="true">
                        {state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}
                      </span>
                      <span className="uko-step-label">{s.label}</span>
                      {state === 'done' && <span className="uko-sr">, done</span>}
                    </button>
                  </li>
                )
              })}
            </ol>
            <div ref={mainRef} className="uko-panel-main">
              {steps.map((s, i) => (
                <section key={s.key ?? s.label} className="uko-step-pane" hidden={i !== cur} aria-labelledby={`${uid}-h${i}`}>
                  <div className="uko-section-head">
                    {s.icon && <span className="uko-section-icon" aria-hidden="true">{kitIcon(s.icon, 19)}</span>}
                    <div className="uko-section-text">
                      <div
                        id={`${uid}-h${i}`}
                        ref={(el) => { heads.current[i] = el }}
                        role="heading"
                        aria-level={titleAs === 'h2' ? 3 : 4}
                        tabIndex={-1}
                        className="uko-section-title"
                      >
                        {s.title ?? s.label}
                      </div>
                      {s.sub && <div className="uko-section-sub">{s.sub}</div>}
                    </div>
                  </div>
                  {s.content}
                </section>
              ))}
              {children}
            </div>
          </div>
        ) : (
          <div ref={mainRef} className="uko-panel-main" data-plain="">{children}</div>
        )}

        {footerNode}
      </div>
    </div>,
    document.body,
  )
}
