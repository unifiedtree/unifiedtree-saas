// The face station screens, rendered as markup (the repo has no DOM test environment) with the
// data hooks answering as the server does: the setup page is closed without both permissions and
// lists stations with their state; the station page shows its start screen only with a station
// sign-in in this browser.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FaceStation, StationSession } from './stationApi'

const perms = new Set<string>()
const answers: { stations: FaceStation[]; session: StationSession | null } = { stations: [], session: null }
const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() })
const mutation = { mutateAsync: async () => ({}), isPending: false }

vi.mock('@unifiedtree/sdk', async () => ({ ...(await vi.importActual<object>('@unifiedtree/sdk')), usePermission: (c: string) => perms.has(c) }))
vi.mock('../../api/useOrg', async () => ({ ...(await vi.importActual<object>('../../api/useOrg')), useBranches: () => ok([]) }))
vi.mock('./stationApi', async () => ({
  ...(await vi.importActual<object>('./stationApi')),
  useFaceStations: () => ok(answers.stations),
  useStationActions: () => ({ create: mutation, revoke: mutation, remove: mutation, startHere: mutation }),
  readStation: () => answers.session,
}))

import { FaceStationsPage } from './FaceStationsPage'
import { StationPage } from './StationPage'

function html(el: JSX.Element) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const station = (o: Partial<FaceStation>): FaceStation => ({
  id: 'st1', companyId: 'c1', branchId: 'b1', branchName: 'Hyderabad office', name: 'Front desk', status: 'ACTIVE',
  createdByName: 'Hema Rao', createdAt: '2026-10-06T03:00:00Z', revokedByName: null, revokedAt: null,
  lastStartedAt: null, lastStartedByName: null, lastUsedAt: null, punchesToday: 0, waitingApproval: 0, ...o,
})

describe('Face stations (setup page)', () => {
  it('is closed without both permissions', () => {
    perms.clear(); perms.add('attendance.policy.manage')
    const out = html(<FaceStationsPage />)
    expect(out).toContain('Not available for your role')
    expect(out).not.toContain('New station')
  })

  it('lists the stations with what waits for approval, and the actions each one allows', () => {
    perms.clear(); perms.add('attendance.policy.manage'); perms.add('attendance.assisted_punch.any')
    answers.stations = [
      station({ waitingApproval: 2, lastUsedAt: '2026-10-06T04:10:00Z', punchesToday: 5 }),
      station({ id: 'st2', name: 'Old gate', status: 'REVOKED', revokedByName: 'Hema Rao', revokedAt: '2026-10-05T10:00:00Z' }),
    ]
    const out = html(<FaceStationsPage />)
    expect(out).toContain('Front desk')
    expect(out).toContain('2 to confirm')
    expect(out).toContain('5 today')
    expect(out).toContain('Open on this computer')
    expect(out).toContain('Switch off')
    expect(out).toContain('Old gate')
    expect(out).toContain('switched off by Hema Rao')
    expect(out).toContain('Delete Old gate')
  })
})

describe('Station page', () => {
  it('shows the start screen with the station’s name when this browser holds a station sign-in', () => {
    answers.session = { token: 't', expiresAt: '2026-11-05T06:00:00Z', station: { stationId: 'st1', name: 'Front desk', branchId: 'b1', branchName: 'Hyderabad office' } }
    const out = html(<StationPage />)
    expect(out).toContain('Front desk')
    expect(out).toContain('Hyderabad office')
    expect(out).toContain('Punch with your face')
    expect(out).toContain('Punch in')
    expect(out).toContain('Punch out')
  })

  it('says it is switched off without one', () => {
    answers.session = null
    const out = html(<StationPage />)
    expect(out).toContain('This station is switched off')
    expect(out).not.toContain('Punch with your face')
  })
})
