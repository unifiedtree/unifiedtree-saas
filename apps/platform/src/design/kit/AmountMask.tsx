// Hide amounts (prototype EmpPay's "Hide amounts" pill, Home's pay card "Show / Hide").
//
// AmountMask draws an amount, or the design's dots in its place ("₹ • • • • •") while
// `hidden`. AmountToggle is the pill that flips it. The page owns the choice and where it
// is kept (a per-viewer preference); these only draw it.
//
// A hidden amount is hidden from screen readers too: they hear "Take-home hidden", never the
// figure. For words that carry an amount somewhere else (a title, an aria-label, a toast),
// run them through maskAmount / maskAmountsIn while amounts are hidden.
import type { ReactNode } from 'react'
import { cx, renderIcon } from './displayUtil'
import './display.css'
import './data.css'

const SYMBOL = /^[−-]?\s*(₹|Rs\.?|INR|\$|€|£)/i

/** The design's mask: dots with a thin space between them ("• • • • •"). */
export function maskDots(count = 5): string {
  return Array.from({ length: Math.max(1, Math.floor(count) || 1) }, () => '•').join(' ')
}

/** The currency sign an amount starts with ("₹1,24,850" → "₹"), or null. */
export function currencyOf(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const m = SYMBOL.exec(String(value).trim())
  return m ? m[1] : null
}

export interface MaskOptions {
  /** The sign before the dots. Default: the value's own sign, else ₹. null = no sign. */
  currency?: string | null
  /** How many dots (default 5, as on the payslip; Home's pay card uses 6). */
  dots?: number
}

/** "₹1,24,850" → "₹ • • • • •". The minus of a deduction goes too, so nothing about the figure shows. */
export function maskAmount(value: unknown, options: MaskOptions = {}): string {
  const sign = options.currency === undefined ? currencyOf(value) ?? '₹' : options.currency
  const dots = maskDots(options.dots)
  return sign ? `${sign} ${dots}` : dots
}

// An amount inside a sentence: an optional minus ("− ₹2,000" as the payslip writes it, or
// "-₹2,000"), a currency sign, the figure, and an Indian short scale word if there is one
// ("₹59.6L", "₹2.1 Cr"). A spaced hyphen ("Pay - ₹2,000") is punctuation and stays.
const IN_TEXT = /(?:−\s?|-)?(₹|Rs\.?|INR|\$|€|£)\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?(?:L|lakh|lakhs|Cr|crore|crores|K|k|M)\b)?/g

/** Masks every amount in a sentence: "Paid ₹1,24,850 on 30 Sep" → "Paid ₹ • • • • • on 30 Sep". */
export function maskAmountsIn(text: string, options: Omit<MaskOptions, 'currency'> = {}): string {
  return String(text ?? '').replace(IN_TEXT, (_m, sign: string) => `${sign} ${maskDots(options.dots)}`)
}

export interface AmountMaskProps {
  /** The amount as the page formats it ("₹1,24,850"), or any node (a CountUp). */
  value: ReactNode
  hidden: boolean
  /** What screen readers hear while it's hidden: "{label} hidden" (default "Amount hidden"). */
  label?: string
  currency?: string | null
  dots?: number
  className?: string
}

export function AmountMask({ value, hidden, label = 'Amount', currency, dots, className }: AmountMaskProps) {
  if (!hidden) return <span className={cx('uk-amask', className)}>{value}</span>
  const text = maskAmount(typeof value === 'string' || typeof value === 'number' ? value : null, { currency, dots })
  return (
    <span className={cx('uk-amask', 'is-hidden', className)}>
      <span aria-hidden="true">{text}</span>
      <span className="uk-sr">{label} hidden</span>
    </span>
  )
}

export interface AmountToggleProps {
  hidden: boolean
  /** Gets the new value (true = hide). */
  onToggle: (hidden: boolean) => void
  /** md = the page header pill (EmpPay: 38px, eye icon, "Hide amounts"); sm = a card's small pill (Home's pay card: 28px, "Show" / "Hide"). */
  size?: 'md' | 'sm'
  /** id of the part of the page whose amounts it hides (aria-controls). */
  controls?: string
  className?: string
}

export function AmountToggle({ hidden, onToggle, size = 'md', controls, className }: AmountToggleProps) {
  const long = hidden ? 'Show amounts' : 'Hide amounts'
  return (
    <button type="button" className={cx('uk-amtoggle', `uk-amtoggle--${size}`, className)} aria-label={size === 'sm' ? long : undefined}
      aria-controls={controls} onClick={() => onToggle(!hidden)}>
      {size === 'md' && <span className="uk-amtoggle__icon" aria-hidden="true">{renderIcon('eye', 15)}</span>}
      {size === 'sm' ? (hidden ? 'Show' : 'Hide') : long}
    </button>
  )
}
