// "Create" beside a form field: the panel's steps (open, save, fail, cancel) and
// the button's inactive-with-a-reason state. The repo has no DOM test
// environment, so the steps run on their own (createFlow, what useCreatePanel
// drives) and the button is checked as rendered markup.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CLOSED, createFlow, needPermission, type CreateFlowState } from './inlineCreateFlow'
import { CreateButton } from './InlineCreate'

const errorOf = (e: unknown) => (e instanceof Error ? e.message : 'failed')
function flowWithLog() {
  const log: CreateFlowState[] = []
  const flow = createFlow((s) => log.push(s), errorOf)
  return { flow, log }
}

describe('createFlow', () => {
  it('opens the panel', () => {
    const { flow } = flowWithLog()
    expect(flow.state()).toEqual(CLOSED)
    flow.open()
    expect(flow.state()).toEqual({ open: true, busy: false, error: null })
  })

  it('saves, hands the new item over before closing, then closes', async () => {
    const { flow, log } = flowWithLog()
    flow.open()
    const seen: string[] = []
    const ok = await flow.save(async () => 'dept-42', (id) => { seen.push(id); expect(flow.state().open).toBe(true) })
    expect(ok).toBe(true)
    expect(seen).toEqual(['dept-42'])
    expect(flow.state()).toEqual(CLOSED)
    expect(log.map((s) => [s.open, s.busy])).toEqual([[true, false], [true, true], [false, false]])
  })

  it('keeps the panel open with the reason when the save fails, and nothing is selected', async () => {
    const { flow } = flowWithLog()
    flow.open()
    const then = vi.fn()
    const ok = await flow.save(async () => { throw new Error('Department code ‘ENG’ is already used') }, then)
    expect(ok).toBe(false)
    expect(then).not.toHaveBeenCalled()
    expect(flow.state()).toEqual({ open: true, busy: false, error: 'Department code ‘ENG’ is already used' })
    // Trying again clears the old reason while it saves.
    let during: CreateFlowState | null = null
    await flow.save(async () => { during = flow.state(); return 'x' })
    expect(during).toEqual({ open: true, busy: true, error: null })
  })

  it('ignores Cancel and a second save while saving', async () => {
    const { flow } = flowWithLog()
    flow.open()
    let finish: (v: string) => void = () => {}
    const work = vi.fn(() => new Promise<string>((r) => { finish = r }))
    const first = flow.save(work)
    flow.cancel()
    expect(flow.state().open).toBe(true)
    await expect(flow.save(work)).resolves.toBe(false)
    expect(work).toHaveBeenCalledTimes(1)
    finish('id-1')
    await expect(first).resolves.toBe(true)
    expect(flow.state()).toEqual(CLOSED)
  })

  it('cancel closes without selecting anything', () => {
    const { flow } = flowWithLog()
    const then = vi.fn()
    flow.open()
    flow.cancel()
    expect(flow.state()).toEqual(CLOSED)
    expect(then).not.toHaveBeenCalled()
  })

  it('a save with the panel closed does nothing', async () => {
    const { flow } = flowWithLog()
    const work = vi.fn(async () => 'x')
    await expect(flow.save(work)).resolves.toBe(false)
    expect(work).not.toHaveBeenCalled()
  })
})

describe('CreateButton', () => {
  it('names what it creates', () => {
    const html = renderToStaticMarkup(<CreateButton noun="department" onClick={() => {}} />)
    expect(html).toContain('aria-label="Create department"')
    expect(html).toContain('>Create</button>')
    expect(html).not.toContain('aria-disabled')
    expect(html).not.toContain('data-blocked')
  })

  it('without the permission: shown, inactive, and says why', () => {
    const why = needPermission('departments')
    expect(why).toBe('You need permission to manage departments — ask an admin.')
    const html = renderToStaticMarkup(<CreateButton noun="department" blockedReason={why} onClick={() => {}} />)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('data-blocked=""')
    expect(html).toContain(`data-tip="${why}"`)
    // Screen readers get the same reason as the button's description.
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    expect(html).toContain(`<span id=`)
    expect(html).toContain(`class="uko-sr">${why}</span>`)
  })
})
