import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { WishButton, WishComposerBody, WishesReceivedCard, type WishControls } from './WishBlocks'
import { CelebrationsCard, CelebrationSectionCard } from './PeopleBlocks'
import { sectionsOf, type Celebration } from './peopleModel'
import { fromWishes, sentKeys, isWished, canWish, receivedLine, wishPresets } from './wishModel'
import { celebrationWishesQuery, sendWishMutation } from './homeApi'
import { expectSharedMapping, fakeApi, spyQueryClient } from '../../api/shared/testing'

const TODAY = '2026-10-05'
const text = (s: string) => s.replace(/<!-- -->/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const KAVYA: Celebration = { kind: 'BIRTHDAY', date: TODAY, employeeId: 'e-kavya', name: 'Kavya Menon', departmentName: 'Ops', years: null }
const ASHA: Celebration = { kind: 'WORK_ANNIVERSARY', date: '2026-10-08', employeeId: 'e-asha', name: 'Asha Rao', departmentName: null, years: 3 }
const ME: Celebration = { kind: 'BIRTHDAY', date: TODAY, employeeId: 'e-me', name: 'Priya Rao', departmentName: null, years: null }

function controls(sent: { toEmployeeId: string; occasion: string; occasionDate: string }[] = [], received = 0): WishControls {
  const data = fromWishes({
    today: TODAY, receivedPeople: received, sent,
    received: Array.from({ length: received }, (_, i) => ({ id: `w${i}`, fromEmployeeId: `e${i}`, fromName: `Person ${i}`, occasion: 'BIRTHDAY', occasionDate: TODAY, message: `Wish ${i}`, createdAt: '2026-10-05T04:00:00Z' })),
  })
  const keys = sentKeys(data.sent)
  return { canWish: (c) => canWish(c, TODAY, 'e-me'), isWished: (c) => isWished(c, keys), open: () => {}, receivedLine: receivedLine(data), data }
}

describe('Send wishes: the button', () => {
  it('shows "Send wishes" on today’s people only, "Wished ✓" once sent, and nothing without the feature', () => {
    expect(text(renderToString(createElement(WishButton, { c: KAVYA, wishes: controls() })))).toContain('Send wishes')
    expect(renderToString(createElement(WishButton, { c: KAVYA, wishes: controls() }))).toContain('aria-label="Send wishes to Kavya Menon"')
    expect(text(renderToString(createElement(WishButton, { c: KAVYA, wishes: controls([{ toEmployeeId: 'e-kavya', occasion: 'BIRTHDAY', occasionDate: TODAY }]) })))).toContain('Wished ✓')
    expect(renderToString(createElement(WishButton, { c: ASHA, wishes: controls() }))).toBe('')
    expect(renderToString(createElement(WishButton, { c: ME, wishes: controls() }))).toBe('')
    expect(renderToString(createElement(WishButton, { c: KAVYA, wishes: null }))).toBe('')
    expect(text(renderToString(createElement(WishButton, { c: KAVYA, wishes: controls(), compact: true })))).toContain('Wish')
  })

  it('puts the button on Home’s faces and the page’s rows, and the card says who wished you', () => {
    const home = text(renderToString(createElement(CelebrationsCard, {
      items: [KAVYA, ASHA, ME], loading: false, error: null, onRetry: () => {}, today: TODAY, onSeeAll: () => {}, wishes: controls([], 12),
    })))
    expect(home).toContain('12 people wished you')
    expect(home).toContain('aria-label="Send wishes to Kavya Menon"')
    expect(home).not.toContain('Send wishes to Asha Rao')
    expect(home).not.toContain('Send wishes to Priya Rao')
    const before = text(renderToString(createElement(CelebrationsCard, {
      items: [KAVYA], loading: false, error: null, onRetry: () => {}, today: TODAY, onSeeAll: () => {},
    })))
    expect(before).not.toContain('Wish')
    expect(before).toContain('Birthdays, work anniversaries and new joiners')

    const [birthdays] = sectionsOf({ today: TODAY, items: [KAVYA, ME], joinersKnown: true }, TODAY)
    const page = text(renderToString(createElement(CelebrationSectionCard, { section: birthdays, today: TODAY, index: 0, wishes: controls() })))
    expect(page).toContain('Send wishes to Kavya Menon')
    expect(page).not.toContain('Send wishes to Priya Rao')
  })

  it('leaves birthdays out of the words where the company hides them', () => {
    const out = text(renderToString(createElement(CelebrationsCard, {
      items: [], loading: false, error: null, onRetry: () => {}, today: TODAY, onSeeAll: () => {}, birthdaysHidden: true,
    })))
    expect(out).toContain('Work anniversaries and new joiners show here.')
    expect(out).not.toContain('Birthdays')
  })
})

describe('Send wishes: the composer', () => {
  const body = (over: Partial<Parameters<typeof WishComposerBody>[0]> = {}) => text(renderToString(createElement(WishComposerBody, {
    presets: wishPresets(KAVYA), pick: 0, own: '', error: null, first: 'Kavya', onPick: () => {}, onOwn: () => {}, ...over,
  })))

  it('offers the ready-made messages, the first one picked, and an optional message of up to 280 characters', () => {
    const out = body()
    expect(out).toContain('role="radiogroup"')
    expect(out).toContain('Happy birthday, Kavya! 🎂')
    expect(out).toContain('Many happy returns, Kavya! Have a great day.')
    expect(out.match(/checked=""/g)?.length).toBe(1)
    expect(out).toContain('Or write your own')
    expect(out).toContain('maxLength="280"')
    expect(out).toContain('0/280')
  })

  it('says the own words go instead, and shows what went wrong', () => {
    const out = body({ own: 'See you at lunch!', error: 'It isn’t their birthday today.' })
    expect(out).toContain('Your own words are sent instead of the message above.')
    expect(out).toContain('17/280')
    expect(out.match(/checked=""/g)).toBeNull()
    expect(out).toContain('role="alert"')
    expect(out).toContain('It isn’t their birthday today.')
  })
})

describe('Send wishes: who wished me (the page)', () => {
  it('lists the wishes with the sender and their words', () => {
    const out = text(renderToString(createElement(WishesReceivedCard, { data: controls([], 2).data })))
    expect(out).toContain('Your wishes')
    expect(out).toContain('2 people wished you this week')
    expect(out).toContain('Person 0')
    expect(out).toContain('Wish 1')
    expect(renderToString(createElement(WishesReceivedCard, { data: controls().data }))).toBe('')
  })
})

describe('Send wishes: the API', () => {
  it('reads what I received and sent, and is not available before the backend has it', async () => {
    const { api, calls } = fakeApi(() => ({ today: TODAY, received: [], receivedPeople: 0, sent: [] }))
    const q = celebrationWishesQuery(api)
    expect(q.queryKey).toEqual(['ess', 'celebration-wishes'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: { today: TODAY, received: [], receivedPeople: 0, sent: [] } })
    expect(calls[0]).toEqual({ path: '/v1/ess/celebrations/wishes', method: 'GET', body: undefined })
    await expectSharedMapping((a) => celebrationWishesQuery(a).queryFn())
  })

  it('sends with POST and the button reads "Wished" at once', async () => {
    const answer = { wish: { id: 'w9', toEmployeeId: 'e-kavya', occasion: 'BIRTHDAY', occasionDate: TODAY, message: 'Happy birthday, Kavya! 🎂', createdAt: '2026-10-05T05:00:00Z' }, created: true }
    const { api, calls } = fakeApi(() => answer)
    const { qc, invalidated } = spyQueryClient()
    qc.setQueryData(['ess', 'celebration-wishes'], { available: true, value: { today: TODAY, received: [], receivedPeople: 0, sent: [] } })
    const m = sendWishMutation(qc, api)
    const vars = { toEmployeeId: 'e-kavya', occasion: 'BIRTHDAY' as const, message: 'Happy birthday, Kavya! 🎂' }
    const r = await m.mutationFn(vars)
    expect(calls[0]).toEqual({ path: '/v1/ess/celebrations/wishes', method: 'POST', body: vars })
    await m.onSuccess?.(r, vars)
    const cached = qc.getQueryData<{ available: true; value: { sent: unknown[] } }>(['ess', 'celebration-wishes'])
    expect(cached?.value.sent).toEqual([{ toEmployeeId: 'e-kavya', occasion: 'BIRTHDAY', occasionDate: TODAY }])
    expect(invalidated).toContainEqual(['ess', 'celebration-wishes'])
    await expectSharedMapping((a) => sendWishMutation(qc, a).mutationFn(vars))
  })
})
