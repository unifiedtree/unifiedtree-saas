import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardedGo, hasNavigationGuard, registerNavigationGuard, runNavigationGuards } from './navigationGuard'

describe('leave guards', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('moves at once when no guard is set', () => {
    const go = vi.fn()
    expect(hasNavigationGuard()).toBe(false)
    guardedGo(go)
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('a guard that stops the move gets to carry it on later, once', () => {
    let later: (() => void) | null = null
    const off = registerNavigationGuard((proceed) => { later = proceed; return true })
    const go = vi.fn()
    guardedGo(go)
    expect(go).not.toHaveBeenCalled()
    expect(hasNavigationGuard()).toBe(true)
    later!()
    later!()
    expect(go).toHaveBeenCalledTimes(1)
    off()
    expect(hasNavigationGuard()).toBe(false)
  })

  it('a guard with nothing unsaved lets the move through', () => {
    const off = registerNavigationGuard(() => false)
    const go = vi.fn()
    guardedGo(go)
    expect(go).toHaveBeenCalledTimes(1)
    off()
  })

  it('asks the newest guard first and stops at the first that blocks', () => {
    const seen: string[] = []
    const a = registerNavigationGuard(() => { seen.push('a'); return true })
    const b = registerNavigationGuard(() => { seen.push('b'); return true })
    expect(runNavigationGuards(() => {})).toBe(true)
    expect(seen).toEqual(['b'])
    b(); a()
  })

  it('keeps the old window.__utLeaveGuard working (payroll settings still sets it)', () => {
    let later: (() => void) | null = null
    vi.stubGlobal('window', { __utLeaveGuard: (proceed: () => void) => { later = proceed; return true } })
    expect(hasNavigationGuard()).toBe(true)
    const go = vi.fn()
    guardedGo(go)
    expect(go).not.toHaveBeenCalled()
    later!()
    expect(go).toHaveBeenCalledTimes(1)
  })
})
