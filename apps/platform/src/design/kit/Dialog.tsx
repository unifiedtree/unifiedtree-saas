// The design's centred dialog: 12px radius, hairline border, the popover shadow and the same
// gradient-blur backdrop as side panels. Escape and the backdrop close it (unless `busy`),
// Tab stays inside, and focus returns to where it was on close.
import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { kitIcon, useEscape, useFocusTrap, useLayer, type InitialFocus, type KitIcon } from './overlayCore'
import './overlays.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** One line under the title. */
  sub?: ReactNode
  /** Icon tile left of the title: a design icon name or a node. */
  icon?: KitIcon
  /** Colour of the icon tile. */
  tone?: 'brand' | 'danger' | 'warning'
  children?: ReactNode
  /** Action buttons, right-aligned (PanelButton works well here). */
  footer?: ReactNode
  /** Max width in px (default 480). */
  width?: number
  /** Clicking the backdrop closes the dialog (default true). */
  closeOnBackdrop?: boolean
  /** Hide the round close button. */
  hideClose?: boolean
  closeLabel?: string
  /** Where focus goes on open: the dialog itself (default), its first control, or a given element. */
  initialFocus?: InitialFocus
  role?: 'dialog' | 'alertdialog'
  /** Fixed id for the title element (otherwise generated). */
  titleId?: string
  /** Saving: the dialog can't be closed. */
  busy?: boolean
  zIndex?: number
}

export function Dialog(props: DialogProps) {
  if (!props.open || typeof document === 'undefined') return null
  return <OpenDialog {...props} />
}

function OpenDialog({
  onClose, title, sub, icon, tone = 'brand', children, footer, width = 480, closeOnBackdrop = true, hideClose = false,
  closeLabel = 'Close', initialFocus = 'container', role = 'dialog', titleId, busy = false, zIndex = 1100,
}: DialogProps) {
  const uid = useId()
  const tid = titleId || `${uid}-title`, sid = `${uid}-sub`
  const ref = useRef<HTMLDivElement>(null)
  const isTop = useLayer(true)
  const close = () => { if (!busy) onClose() }
  useEscape(true, isTop, close)
  useFocusTrap(ref, true, isTop, initialFocus)

  return createPortal(
    <div className="uko-layer" style={{ zIndex }} data-uko-layer="">
      <div className="uko-backdrop" aria-hidden="true" onClick={closeOnBackdrop ? close : undefined} />
      <div className="uko-dialog-wrap">
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={tid}
          aria-describedby={sub ? sid : undefined}
          tabIndex={-1}
          className="uko-dialog"
          style={{ maxWidth: `min(${width}px, calc(100vw - 32px))` }}
          data-closable={hideClose ? undefined : ''}
        >
          <div className="uko-dialog-head">
            {icon && <span className="uko-dialog-icon" data-tone={tone} aria-hidden="true">{kitIcon(icon, 19)}</span>}
            <div className="uko-dialog-headtext">
              <h2 id={tid} className="uko-dialog-title">{title}</h2>
              {sub && <div id={sid} className="uko-dialog-sub">{sub}</div>}
            </div>
          </div>
          {children != null && children !== false && <div className="uko-dialog-body">{children}</div>}
          {footer && <div className="uko-dialog-foot">{footer}</div>}
          {!hideClose && (
            <button type="button" className="uko-close uko-dialog-close" aria-label={closeLabel} title={closeLabel} onClick={close} disabled={busy}>
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
