import { describe, expect, it } from 'vitest'
import {
  WISH_MAX, canWish, composerTitle, fromWishes, isWished, occasionOf, occasionWords, receivedLine, sentKeys, wishMessage, wishPresets,
} from './wishModel'
import { fromCelebrations, sectionsOf } from './peopleModel'

const TODAY = '2026-10-05'
const ME = 'e-me'
const c = (kind: string, date: string, over: Partial<{ employeeId: string | null; name: string; years: number | null }> = {}) =>
  ({ kind, date, employeeId: 'e-kavya', name: 'Kavya Menon', years: null, ...over })

describe('wishModel: who can be wished', () => {
  it('offers birthdays and work anniversaries on the day only', () => {
    expect(canWish(c('BIRTHDAY', TODAY), TODAY, ME)).toBe(true)
    expect(canWish(c('BIRTHDAY', '2026-10-06'), TODAY, ME)).toBe(false)
    expect(canWish(c('BIRTHDAY', '2026-10-03'), TODAY, ME)).toBe(false)
    expect(canWish(c('WORK_ANNIVERSARY', TODAY, { years: 3 }), TODAY, ME)).toBe(true)
    expect(canWish(c('WORK_ANNIVERSARY', '2026-10-09', { years: 3 }), TODAY, ME)).toBe(false)
  })

  it('offers a welcome for the first 30 days', () => {
    expect(canWish(c('NEW_JOINER', TODAY), TODAY, ME)).toBe(true)
    expect(canWish(c('NEW_JOINER', '2026-09-05'), TODAY, ME)).toBe(true)
    expect(canWish(c('NEW_JOINER', '2026-09-04'), TODAY, ME)).toBe(false)
    expect(canWish(c('NEW_JOINER', '2026-10-06'), TODAY, ME)).toBe(false)
  })

  it('never offers wishes to yourself, without an id, or before knowing who you are', () => {
    expect(canWish(c('BIRTHDAY', TODAY, { employeeId: ME }), TODAY, ME)).toBe(false)
    expect(canWish(c('BIRTHDAY', TODAY, { employeeId: null }), TODAY, ME)).toBe(false)
    expect(canWish(c('BIRTHDAY', TODAY), TODAY, undefined)).toBe(false)
    expect(canWish(c('HOLIDAY', TODAY), TODAY, ME)).toBe(false)
    expect(occasionOf('RETIREMENT')).toBeNull()
  })
})

describe('wishModel: the composer', () => {
  it('has ready-made messages with the first name and the years', () => {
    expect(wishPresets(c('BIRTHDAY', TODAY))[0]).toBe('Happy birthday, Kavya! 🎂')
    expect(wishPresets(c('WORK_ANNIVERSARY', TODAY, { years: 5 }))[0]).toBe('Congratulations on 5 years! 🎉')
    expect(wishPresets(c('WORK_ANNIVERSARY', TODAY, { years: 1 }))[0]).toBe('Congratulations on 1 year! 🎉')
    expect(wishPresets(c('NEW_JOINER', TODAY))[0]).toBe('Welcome aboard, Kavya! 👋')
    for (const kind of ['BIRTHDAY', 'WORK_ANNIVERSARY', 'NEW_JOINER']) {
      const all = wishPresets(c(kind, TODAY, { years: 2 }))
      expect(all.length).toBe(3)
      expect(new Set(all).size).toBe(3)
      for (const p of all) expect(p.length).toBeLessThanOrEqual(WISH_MAX)
    }
    expect(composerTitle(c('BIRTHDAY', TODAY))).toBe('Wish Kavya a happy birthday')
    expect(composerTitle(c('NEW_JOINER', TODAY))).toBe('Welcome Kavya aboard')
  })

  it('sends the person’s own words when they wrote any, else the picked message', () => {
    expect(wishMessage('Happy birthday, Kavya! 🎂', '')).toBe('Happy birthday, Kavya! 🎂')
    expect(wishMessage('Happy birthday, Kavya! 🎂', '   ')).toBe('Happy birthday, Kavya! 🎂')
    expect(wishMessage('Happy birthday, Kavya! 🎂', '  Have a  lovely\nday ')).toBe('Have a lovely day')
  })
})

describe('wishModel: sent and received', () => {
  const raw = {
    today: TODAY,
    received: [
      { id: 'w2', fromEmployeeId: 'e-priya', fromName: 'Priya Rao', occasion: 'BIRTHDAY', occasionDate: TODAY, message: 'Happy birthday!', createdAt: '2026-10-05T05:00:00Z' },
      { id: 'w1', fromEmployeeId: 'e-ravi', fromName: '', occasion: 'BIRTHDAY', occasionDate: TODAY, message: 'Many happy returns', createdAt: '2026-10-05T04:00:00Z' },
      { id: '', message: 'broken' },
    ],
    receivedPeople: 2,
    sent: [{ toEmployeeId: 'e-kavya', occasion: 'BIRTHDAY', occasionDate: TODAY }, { toEmployeeId: 'e-new', occasion: 'WELCOME', occasionDate: '2026-09-28' }],
  }

  it('reads the server’s answer, defensively', () => {
    const d = fromWishes(raw)
    expect(d.received.map((w) => w.id)).toEqual(['w2', 'w1'])
    expect(d.received[1].fromName).toBe('A colleague')
    expect(d.receivedPeople).toBe(2)
    expect(fromWishes(null)).toEqual({ today: null, received: [], receivedPeople: 0, sent: [] })
  })

  it('remembers who was wished, for which occasion and day', () => {
    const sent = sentKeys(fromWishes(raw).sent)
    expect(isWished(c('BIRTHDAY', TODAY), sent)).toBe(true)
    expect(isWished(c('WORK_ANNIVERSARY', TODAY), sent)).toBe(false)
    expect(isWished(c('NEW_JOINER', '2026-09-28', { employeeId: 'e-new' }), sent)).toBe(true)
    expect(isWished(c('BIRTHDAY', TODAY, { employeeId: 'e-other' }), sent)).toBe(false)
  })

  it('says who wished you', () => {
    expect(receivedLine(fromWishes(raw))).toBe('2 people wished you')
    expect(receivedLine({ received: fromWishes(raw).received.slice(0, 1), receivedPeople: 1 })).toBe('Priya wished you')
    expect(receivedLine({ received: [], receivedPeople: 0 })).toBe('')
    expect(occasionWords('ANNIVERSARY')).toBe('Work anniversary')
  })
})

describe('peopleModel: a company that hides birthdays', () => {
  it('has no Birthdays section, and an older server keeps it', () => {
    const hidden = fromCelebrations({ today: TODAY, items: [], included: ['NEW_JOINER', 'WORK_ANNIVERSARY'], birthdaysHidden: true })
    expect(hidden.birthdaysHidden).toBe(true)
    expect(sectionsOf(hidden, TODAY).map((s) => s.key)).toEqual(['WORK_ANNIVERSARY', 'NEW_JOINER'])
    const older = fromCelebrations({ today: TODAY, items: [], included: ['BIRTHDAY', 'NEW_JOINER', 'WORK_ANNIVERSARY'] })
    expect(older.birthdaysHidden).toBe(false)
    expect(sectionsOf(older, TODAY).map((s) => s.key)).toEqual(['BIRTHDAY', 'WORK_ANNIVERSARY', 'NEW_JOINER'])
  })
})
