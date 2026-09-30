import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { AmountMask, AmountToggle, maskAmount, maskAmountsIn, maskDots, currencyOf } from './data'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => {}

describe('amount masking', () => {
  it('the design’s dots: five by default, spaced', () => {
    expect(maskDots()).toBe('• • • • •')
    expect(maskDots(6)).toBe('• • • • • •')
    expect(maskDots(0)).toBe('•')
  })
  it('keeps the currency sign the amount starts with', () => {
    expect(currencyOf('₹1,24,850')).toBe('₹')
    expect(currencyOf('− ₹2,000')).toBe('₹')
    expect(currencyOf('$ 42')).toBe('$')
    expect(currencyOf('Rs. 500')).toBe('Rs.')
    expect(currencyOf('42 days')).toBeNull()
    expect(currencyOf(1200)).toBeNull()
    expect(currencyOf(null)).toBeNull()
  })
  it('maskAmount: "₹ • • • • •" — the figure and its sign never show', () => {
    expect(maskAmount('₹1,24,850')).toBe('₹ • • • • •')
    expect(maskAmount('-₹2,000')).toBe('₹ • • • • •')
    expect(maskAmount('₹2,18,640', { dots: 6 })).toBe('₹ • • • • • •')
    expect(maskAmount(124850)).toBe('₹ • • • • •')
    expect(maskAmount('€90')).toBe('€ • • • • •')
    expect(maskAmount('₹90', { currency: null })).toBe('• • • • •')
    expect(maskAmount('90', { currency: 'USD' })).toBe('USD • • • • •')
  })
  it('maskAmountsIn: every amount in a sentence (titles, aria-labels, toasts)', () => {
    expect(maskAmountsIn('Paid ₹1,24,850 on 30 Sep')).toBe('Paid ₹ • • • • • on 30 Sep')
    expect(maskAmountsIn('Take-home ₹1,24,850, gross ₹1,49,972.')).toBe('Take-home ₹ • • • • •, gross ₹ • • • • •.')
    expect(maskAmountsIn('Tax − ₹22,122 this month')).toBe('Tax ₹ • • • • • this month')
    expect(maskAmountsIn('Cost ₹59.6L last month, ₹2.1 Cr this year')).toBe('Cost ₹ • • • • • last month, ₹ • • • • • this year')
    expect(maskAmountsIn('Team dinner · ₹8,400')).toBe('Team dinner · ₹ • • • • •')
    expect(maskAmountsIn('Pay - ₹2,000')).toBe('Pay - ₹ • • • • •')
  })
  it('maskAmountsIn leaves everything else alone', () => {
    expect(maskAmountsIn('Hours 5 · 3 of 6 days')).toBe('Hours 5 · 3 of 6 days')
    expect(maskAmountsIn('₹ symbol alone')).toBe('₹ symbol alone')
    expect(maskAmountsIn('')).toBe('')
  })
})

describe('AmountMask / AmountToggle: markup', () => {
  it('shown: the amount as given', () => {
    expect(html(<AmountMask value="₹1,24,850" hidden={false} />)).toBe('<span class="uk-amask">₹1,24,850</span>')
  })
  it('hidden: the dots for the eye, "… hidden" for screen readers (never the figure)', () => {
    const s = html(<AmountMask value="₹1,24,850" hidden label="Take-home" />)
    expect(s).toBe('<span class="uk-amask is-hidden"><span aria-hidden="true">₹ • • • • •</span><span class="uk-sr">Take-home hidden</span></span>')
    expect(s).not.toContain('1,24,850')
    expect(html(<AmountMask value={<b>₹9</b>} hidden />)).toContain('Amount hidden')
  })
  it('the header pill: eye icon and "Hide amounts" / "Show amounts"', () => {
    const on = html(<AmountToggle hidden={false} onToggle={noop} />)
    expect(on).toContain('class="uk-amtoggle uk-amtoggle--md"')
    expect(on).toContain('<span class="uk-amtoggle__icon" aria-hidden="true"><svg')
    expect(on).toContain('Hide amounts</button>')
    expect(html(<AmountToggle hidden onToggle={noop} controls="pay" />)).toContain('aria-controls="pay"')
    expect(html(<AmountToggle hidden onToggle={noop} />)).toContain('Show amounts</button>')
  })
  it('the card pill: "Show" / "Hide" on screen, the full words for screen readers', () => {
    const s = html(<AmountToggle hidden onToggle={noop} size="sm" />)
    expect(s).toContain('aria-label="Show amounts"')
    expect(s).toContain('>Show</button>')
    expect(s).not.toContain('uk-amtoggle__icon')
    expect(html(<AmountToggle hidden={false} onToggle={noop} size="sm" />)).toContain('aria-label="Hide amounts"')
  })
})
