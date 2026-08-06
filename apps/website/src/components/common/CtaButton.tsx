import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCtaMode } from '../../hooks/useCtaMode'

interface Props {
  /** Extra classes appended to the base button style. */
  className?: string
  /**
   * Optional per-mode label overrides — falls back to sensible defaults.
   * Rendered exactly as given (no interpolation) so pages that need to
   * show a computed amount ("Pay ₹390/mo & Create Workspace") can pass
   * the full string here.
   */
  trialLabel?: string
  paidLabel?: string
  /** Optional secondary text shown under the button (e.g. autopay disclosure). */
  subline?: string
  /** Icon on the right — set to null to hide. Defaults to arrow. */
  icon?: React.ReactNode | null
  /** Called on click for analytics; navigation still happens via Link. */
  onClick?: () => void
  /** Match the size language used elsewhere in the site. */
  size?: 'md' | 'lg'
  /** If true, hides itself entirely while the mode is still resolving. */
  hideWhileResolving?: boolean
}

/**
 * The single site-wide CTA that renders the right label + href per
 * useCtaMode(). Drop-in replacement for the four hardcoded
 * `<Link to="/trial-signup">` / `<button onClick={navigate('/signup')}>`
 * usages in Navbar, CTABanner, PricingCalculator and PricingCard.
 */
export function CtaButton({
  className = '',
  trialLabel = 'Start free trial',
  paidLabel = 'Create workspace',
  subline,
  icon = <ArrowRight size={18} />,
  onClick,
  size = 'lg',
  hideWhileResolving = true,
}: Props) {
  const { mode, href, ready } = useCtaMode()

  if (!ready && hideWhileResolving) {
    return (
      <div
        aria-hidden
        className={`inline-block rounded-xl bg-slate-100 animate-pulse ${
          size === 'lg' ? 'h-12 w-44' : 'h-10 w-36'
        } ${className}`}
      />
    )
  }

  const label = mode === 'trial' ? trialLabel : paidLabel
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-body font-semibold ' +
    'bg-primary text-white hover:bg-primary-dark transition-colors shadow-md'
  const sz = size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2.5 text-sm'

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <Link to={href} onClick={onClick} className={`${base} ${sz} ${className}`}>
        {label}
        {icon}
      </Link>
      {subline && (
        <span className="text-xs text-text-secondary font-body max-w-xs">{subline}</span>
      )}
    </div>
  )
}
