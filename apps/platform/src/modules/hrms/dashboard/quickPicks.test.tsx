// G-59 quick-action customisation: up to 6 of the actions the person is allowed, in their order; the default tiles
// when nothing is picked; a pick the person can no longer use is dropped. Rendered as markup (no DOM environment).
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { applyPicks, dialogOrder, movePick, picksToSave, startDraft, togglePick } from './quickPicks'

vi.mock('@/design/kit/overlays', async () => ({
  ...(await vi.importActual<object>('@/design/kit/overlays')),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
import { QuickActionsSection, type QuickTile } from './QuickActionsSection'

const t = (key: string) => ({ key, label: key.toUpperCase() })
const ALL = ['att', 'shift', 'off', 'pay', 'rep', 'org', 'extra'].map(t)

describe('applyPicks', () => {
  it('shows the default tiles when nothing is picked', () => {
    expect(applyPicks(ALL, null).map((x) => x.key)).toEqual(ALL.map((x) => x.key))
    expect(applyPicks(ALL, []).map((x) => x.key)).toEqual(ALL.map((x) => x.key))
  })

  it('shows the picks in the picked order, only the allowed ones, at most 6', () => {
    expect(applyPicks(ALL, ['pay', 'att', 'gone', 'rep']).map((x) => x.key)).toEqual(['pay', 'att', 'rep'])
    expect(applyPicks(ALL, ['extra', 'org', 'rep', 'pay', 'off', 'shift', 'att']).length).toBe(6)
    expect(applyPicks(ALL, ['pay', 'pay']).map((x) => x.key)).toEqual(['pay'])
  })

  it('falls back to the default when none of the picks is allowed any more', () => {
    expect(applyPicks(ALL.slice(0, 2), ['pay', 'rep']).map((x) => x.key)).toEqual(['att', 'shift'])
  })
})

describe('the Customise draft', () => {
  it('starts from what is shown now (at most 6)', () => {
    expect(startDraft(ALL, null)).toEqual(['att', 'shift', 'off', 'pay', 'rep', 'org'])
    expect(startDraft(ALL, ['rep', 'att'])).toEqual(['rep', 'att'])
  })

  it('ticks a new action last, never more than 6, and unticks', () => {
    expect(togglePick(['att'], 'pay')).toEqual(['att', 'pay'])
    expect(togglePick(['att', 'pay'], 'att')).toEqual(['pay'])
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(togglePick(six, 'g')).toEqual(six)
  })

  it('moves an action up and down, never past the ends', () => {
    expect(movePick(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(movePick(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(movePick(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(movePick(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })

  it('saves null (the default) when the draft is exactly the default, else the picks', () => {
    const six = ALL.slice(0, 6)
    expect(picksToSave(six, six.map((x) => x.key))).toBeNull()
    expect(picksToSave(six, ['pay', 'att'])).toEqual(['pay', 'att'])
    // seven allowed: six of them is a real choice
    expect(picksToSave(ALL, startDraft(ALL, null))).toEqual(['att', 'shift', 'off', 'pay', 'rep', 'org'])
  })

  it('lists the ticked actions first, in their order, then the rest', () => {
    expect(dialogOrder(ALL, ['rep', 'att']).map((x) => x.key)).toEqual(['rep', 'att', 'shift', 'off', 'pay', 'org', 'extra'])
  })
})

describe('QuickActionsSection', () => {
  const tiles: QuickTile[] = ['att', 'pay', 'rep'].map((k) => ({ key: k, label: `Tile ${k}`, kind: 'chart', onClick: () => {} }))
  const render = (prefs: unknown) => {
    const qc = new QueryClient()
    if (prefs !== undefined) qc.setQueryData(['me', 'quick-actions', 'dashboard'], prefs)
    return renderToStaticMarkup(<QueryClientProvider client={qc}><QuickActionsSection surface="dashboard" tiles={tiles} /></QueryClientProvider>)
  }
  const order = (html: string) => ['att', 'pay', 'rep'].map((k) => [k, html.indexOf(`Tile ${k}`)] as const)
    .filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k)

  it('shows the saved picks in order, with Customise', () => {
    const html = render({ available: true, value: { available: true, picked: ['rep', 'att'], month: '2026-10', uses: {} } })
    expect(order(html)).toEqual(['rep', 'att'])
    expect(html).toContain('Customise')
  })

  it('shows the default tiles and no Customise while the preferences are not switched on', () => {
    const html = render({ available: false, reason: 'FEATURE_NOT_READY' })
    expect(order(html)).toEqual(['att', 'pay', 'rep'])
    expect(html).not.toContain('Customise')
  })

  it('shows nothing when the person has no quick actions', () => {
    const qc = new QueryClient()
    expect(renderToStaticMarkup(<QueryClientProvider client={qc}><QuickActionsSection surface="home" tiles={[]} /></QueryClientProvider>)).toBe('')
  })
})
