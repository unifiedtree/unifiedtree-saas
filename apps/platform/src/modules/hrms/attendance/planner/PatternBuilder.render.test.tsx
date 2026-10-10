// The pattern builder, rendered as markup: a select per day with the shifts' codes and WO, the tools to add, remove
// and move days, "Repeat cycle", the two-cycle strip and the note for fixed or custom weekly offs.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WO_TOKEN } from '../../api/rosterTypes'
import { PatternBuilder } from './PatternBuilder'
import { patternDay, toShiftLites } from './plannerModel'
import { POLICIES, SH } from './__fixtures__/rosterFixtures'

const shifts = toShiftLites(POLICIES)
const days = [SH.A, SH.A, SH.B, SH.B, SH.C, SH.C, WO_TOKEN].map(patternDay)
const html = (el: JSX.Element) => renderToStaticMarkup(el)

describe('PatternBuilder', () => {
  it('builds A A B B C C WO with a select per day and a strip of two cycles', () => {
    const out = html(<PatternBuilder days={days} repeats shifts={shifts} onChange={() => {}} />)
    expect((out.match(/<select/g) ?? []).length).toBe(7)
    expect(out).toContain('Day 7')
    expect(out).toContain('WO · Weekly off')
    expect(out).toContain('A · Morning')
    expect(out).toContain('Add day')
    expect(out).toContain('Repeat cycle')
    expect(out).toContain('After day 7 it starts again from day 1.')
    expect((out.match(/data-cycle="2"/g) ?? []).length).toBe(7)
    expect(out).toContain('aria-label="Remove day 1"')
    expect(out).toContain('aria-label="Move day 7 right" disabled=""')
  })
  it('lays the pattern once without “Repeat cycle”', () => {
    const out = html(<PatternBuilder days={days} repeats={false} shifts={shifts} onChange={() => {}} />)
    expect(out).toContain('Days after day 7 are left empty.')
    expect(out).not.toContain('data-cycle="2"')
  })
  it('warns what fixed and custom weekly offs do with the pattern’s WO days', () => {
    expect(html(<PatternBuilder days={days} repeats shifts={shifts} weeklyOffMode="FIXED" onChange={() => {}} />)).toContain('With fixed weekly offs, people also get the pattern’s WO days off.')
    expect(html(<PatternBuilder days={days} repeats shifts={shifts} weeklyOffMode="CUSTOM" onChange={() => {}} />)).toContain('left empty for you to pick in the preview')
    expect(html(<PatternBuilder days={days} repeats shifts={shifts} weeklyOffMode="ROTATIONAL" onChange={() => {}} />)).not.toContain('spl-note')
  })
  it('shows a shift that is no longer active instead of dropping it', () => {
    const out = html(<PatternBuilder days={[patternDay('99999999-0000-0000-0000-000000000000')]} repeats shifts={shifts} onChange={() => {}} />)
    expect(out).toContain('no longer active')
  })
  it('has no tools when read-only', () => {
    const out = html(<PatternBuilder days={days} repeats shifts={shifts} onChange={() => {}} readOnly />)
    expect(out).not.toContain('Add day')
    expect(out).not.toContain('Remove day')
  })
})
