// The buttons used in panel and dialog footers (PgCompanies side panel, TeamApprovals):
// primary = brand solid, secondary = white with a hairline, danger, ghost (text).
// `blockedReason` keeps the button focusable but inactive and explains why: a tooltip on
// hover and keyboard focus, and the same text as the button's description for screen readers.
import { forwardRef, useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { kitIcon, type KitIcon } from './overlayCore'
import './overlays.css'

export interface PanelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  /** md = 38px (dialogs, rows), lg = 44px (side panel footer). */
  size?: 'md' | 'lg'
  icon?: KitIcon
  trailingIcon?: KitIcon
  /** Shows a spinner and blocks clicks. */
  busy?: boolean
  /** When set the button is inactive: clicks do nothing and this text is shown as its tooltip. */
  blockedReason?: string | null | false
  /** Which edge the blocked tooltip lines up with (end suits a right-hand footer button). */
  tipAlign?: 'start' | 'end'
  /** Called instead of onClick while the button is blocked (e.g. to reveal the missing fields). */
  onBlockedClick?: () => void
  children?: ReactNode
}

export const PanelButton = forwardRef<HTMLButtonElement, PanelButtonProps>(function PanelButton(
  { variant = 'secondary', size = 'md', icon, trailingIcon, busy, blockedReason, tipAlign = 'end', onBlockedClick, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  const reasonId = useId()
  const blocked = !!blockedReason
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) { e.preventDefault(); return }
    if (blocked) { e.preventDefault(); onBlockedClick?.(); return }
    onClick?.(e)
  }
  const describedBy = [rest['aria-describedby'], blocked ? reasonId : ''].filter(Boolean).join(' ') || undefined
  return (
    <>
      <button
        ref={ref}
        type={type}
        {...rest}
        aria-disabled={blocked || busy ? true : rest['aria-disabled']}
        aria-busy={busy || undefined}
        aria-describedby={describedBy}
        data-variant={variant}
        data-size={size}
        data-blocked={blocked ? '' : undefined}
        data-tip={blocked ? String(blockedReason) : undefined}
        data-tip-align={blocked ? tipAlign : undefined}
        className={['uko-btn', className].filter(Boolean).join(' ')}
        onClick={click}
      >
        {busy ? <span className="uko-spin" aria-hidden="true" /> : kitIcon(icon, 16)}
        {children}
        {!busy && kitIcon(trailingIcon, 16)}
      </button>
      {blocked && <span id={reasonId} className="uko-sr">{String(blockedReason)}</span>}
    </>
  )
})
