// Page-level buttons (StyleGuide "Components", the page headers of the
// dashboard / Home / Team today / Companies, card and row actions).
//
//   size   46  dashboard / Home header buttons ("Add employee", "Apply leave", "Export headcount"), lift on hover
//          44  side-panel footers (= the overlay kit's PanelButton lg)
//          40  module page headers ("Add company", "Team schedule", "Open Salary Structure")
//          38  the default: directory / attendance / payroll headers ("Import", "Export"), dialogs (= PanelButton md)
//          36  card buttons ("Manage", "Confirm", "Customise")
//          32  small inline buttons ("Approve" / "Reject" on rows, "Remind")
//          30  row actions and text links ("See all", "Undo"; in a CellActions they drop to 12px text)
//          A secondary's icon is grey at 38 and brand at 46, as on those pages.
//
//   variant  primary (brand fill) · secondary (white, hairline) · neutral (white, grey text)
//            ghost (brand text link) · soft (brand soft fill → solid on hover, row "main" actions)
//            plain (grey icon/utility button) · danger (red fill) · danger-outline (turns red on hover:
//            Archive, Reject)
//
// Icon-only buttons need an aria-label (enforced by the types). `loading`
// keeps the button's width, shows a spinner and sets aria-busy. `href` renders
// a real link; a plain click still calls onClick (for in-app navigation).
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react'
import { useHoverFx } from '@/design/theme/motion'
import { cx, linkClick, renderIcon, type KitIcon } from './displayUtil'
import './display.css'

export type ButtonVariant = 'primary' | 'secondary' | 'neutral' | 'ghost' | 'soft' | 'plain' | 'danger' | 'danger-outline'
export type ButtonSize = 30 | 32 | 36 | 38 | 40 | 44 | 46

const ICON_PX: Record<ButtonSize, number> = { 30: 14, 32: 14, 36: 15, 38: 16, 40: 16, 44: 16, 46: 17 }

interface ButtonOwnProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon: a name from design/dc/icons or an element. */
  icon?: KitIcon
  /** Trailing icon (e.g. the arrow on "Manage →"). */
  trailingIcon?: KitIcon
  /** Spinner in place of the content; the width stays; clicks are ignored; aria-busy. */
  loading?: boolean
  /** Full width. */
  block?: boolean
  /** round = circle (icon-only approve / reject), pill = fully rounded ends. */
  shape?: 'default' | 'round' | 'pill'
  /** Renders an <a href>. Disabled or loading links render as disabled buttons. */
  href?: string
  target?: string
  rel?: string
  onClick?: (e: MouseEvent<HTMLElement>) => void
}

type LabelledContent = { children: ReactNode; 'aria-label'?: string }
type IconOnlyContent = { children?: undefined; icon: KitIcon; 'aria-label': string }

export type ButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'aria-label'> &
  (LabelledContent | IconOnlyContent)

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = 'secondary', size = 38, icon, trailingIcon, loading = false, block, shape = 'default', href, target, rel, onClick,
    className, children, type = 'button', disabled, ...rest
  } = props
  const iconOnly = children == null || children === false || children === ''
  const hasIcon = icon != null && icon !== false && icon !== ''
  const hasTrailing = trailingIcon != null && trailingIcon !== false && trailingIcon !== ''
  const px = size === 46 && variant !== 'primary' ? 16 : ICON_PX[size]
  const header = size === 46 && variant === 'primary'
  const fx = useHoverFx<HTMLElement>('spot')
  const cls = cx(
    'uk-btn', `uk-btn--${variant}`, `uk-btn--s${size}`, iconOnly ? 'uk-btn--icon' : hasIcon && 'has-icon', shape !== 'default' && `uk-btn--${shape}`,
    block && 'uk-btn--block', loading && 'is-loading', header && 'ufx-spot', className,
  )
  const content = (
    <>
      {header && <span aria-hidden="true" className="uk-fx-spot" />}
      <span className="uk-btn__in">
        {hasIcon && <span className="uk-btn__icon" aria-hidden="true">{renderIcon(icon, px)}</span>}
        {!iconOnly && <span className="uk-btn__label">{children}</span>}
        {hasTrailing && <span className="uk-btn__icon" aria-hidden="true">{renderIcon(trailingIcon, px)}</span>}
      </span>
      {loading && <span className="uk-btn__spin" aria-hidden="true" />}
    </>
  )
  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (loading) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }

  if (href && !disabled && !loading) {
    const a = rest as unknown as AnchorHTMLAttributes<HTMLAnchorElement>
    return (
      <a {...a} ref={ref as Ref<HTMLAnchorElement>} href={href} target={target} rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
        className={cls} onClick={linkClick(onClick)} {...(header ? fx : {})}>
        {content}
      </a>
    )
  }
  return (
    <button {...rest} ref={ref as Ref<HTMLButtonElement>} type={type} className={cls} disabled={disabled}
      aria-busy={loading || undefined} aria-disabled={loading ? true : rest['aria-disabled']} onClick={handleClick} {...(header ? fx : {})}>
      {content}
    </button>
  )
})
