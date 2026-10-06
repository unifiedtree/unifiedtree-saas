// Seats, soft limit (contract 1): the line reads the new fields when the server sends them and keeps
// today's text on an old server. Rendered as markup (the repo has no DOM test environment).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { fmtShort } from '@/design/dc/dates'
import { SeatsStrip } from '../dashboard/OverviewBlocks'
import { overageText, seatsView } from './useSeats'

const OLD = { purchased: 10, current: 10, remaining: 0 }
const NEW = { ...OLD, current: 12, seatsBought: 10, seatsUsed: 12, overBy: 2, extraBilledAtCycleEnd: true, cycleEndsOn: '2026-11-06', companyId: 'c1' }

describe('seatsView', () => {
  it('an old server: the old numbers, a hard limit', () => {
    expect(seatsView(OLD)).toEqual({ used: 10, total: 10, soft: false, overBy: 0, billedAtCycleEnd: false, cycleEndsOn: null })
    expect(seatsView(undefined)).toBeNull()
  })
  it('a new server: seatsUsed / seatsBought, how many over, and when they are billed', () => {
    expect(seatsView(NEW)).toEqual({ used: 12, total: 10, soft: true, overBy: 2, billedAtCycleEnd: true, cycleEndsOn: '2026-11-06' })
  })
  it('the over-the-seats line', () => {
    expect(overageText(seatsView(NEW)!, fmtShort)).toBe('2 extra users will be billed at the end of the cycle (on 6 Nov 2026)')
    expect(overageText(seatsView({ ...NEW, overBy: 1, seatsUsed: 11, cycleEndsOn: null })!, fmtShort)).toBe('1 extra user will be billed at the end of the cycle')
    expect(overageText(seatsView({ ...NEW, extraBilledAtCycleEnd: false })!, fmtShort)).toBe('2 extra users over your 10 seats')
  })
})

describe('SeatsStrip', () => {
  const strip = (p: Partial<Parameters<typeof SeatsStrip>[0]>) => renderToStaticMarkup(<SeatsStrip used={10} total={10} isPast={false} onAdd={() => {}} {...p} />)
  it('an old server, every seat used: today’s text', () => {
    const html = strip({})
    expect(html).toContain('Adding employees is blocked until you add seats.')
    expect(html).toContain('Upgrade to add more employees')
  })
  it('a new server over the seats: who will be billed, not blocked', () => {
    const v = seatsView(NEW)!
    const html = strip({ used: v.used, total: v.total, soft: true, overNote: overageText(v, fmtShort) })
    expect(html).toContain('2 extra users will be billed at the end of the cycle (on 6 Nov 2026).')
    expect(html).not.toContain('blocked')
    expect(html).toContain('Add seats')
    expect(html).not.toContain('role="alert"')
  })
  it('a new server with every seat used and none over: not blocked either', () => {
    const html = strip({ soft: true })
    expect(html).toContain('You can still add employees')
    expect(html).not.toContain('blocked')
  })
})
