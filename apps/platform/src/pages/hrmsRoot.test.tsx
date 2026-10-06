// A-18: business.unifiedtree.com/hrms opens HRMS's home (/dashboard, which sends each person to
// their own Home), as the launcher's HRMS tile does, instead of "Page not found".
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { createRoutesFromChildren, matchRoutes } from 'react-router-dom'

vi.mock('@/design/shell/useHome', () => ({ useHome: () => ({ ready: true, kind: 'self', path: '/me', label: 'Home', team: false }) }))

import { ROUTE_TREE } from '@/App'
import { APPS } from '@/layouts/appConfig'

const routes = createRoutesFromChildren(ROUTE_TREE)
const deepest = (address: string) => { const m = matchRoutes(routes, address); return m?.[m.length - 1]?.route }

describe('/hrms', () => {
  it('has a route of its own, with or without the trailing slash', () => {
    expect(deepest('/hrms')?.path).toBe('/hrms')
    expect(deepest('/hrms/')?.path).toBe('/hrms')
  })

  it('goes to the HRMS home the launcher opens', () => {
    const el = deepest('/hrms')?.element as ReactElement<{ to: string; replace?: boolean }>
    const hrmsHome = APPS.find((a) => a.key === 'hrms')?.home
    expect(hrmsHome).toBe('/dashboard')
    expect(el.props.to).toBe(hrmsHome)
    expect(el.props.replace).toBe(true)
  })

  it('leaves the HRMS pages and the not-found screen as they were', () => {
    expect(deepest('/hrms/master/departments')?.path).not.toBe('/hrms')
    expect(deepest('/hrms/no-such-page')?.path).toBe('*')
  })
})
