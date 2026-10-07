// The admin dashboard's trend ending today left out people who have since left (7 Oct 2026): a past
// day's trend and a range asked for includeLeavers, today's did not. The hook now takes the option,
// as useTeamDashboard does; without it the request is exactly as before. (No DOM test environment:
// useQuery is stubbed, so the hook runs as a plain function and its request is read back.)
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seen: { queryKey: unknown[]; queryFn: () => Promise<unknown> }[] = []
const urls: string[] = []

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (o: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => { seen.push(o); return {} },
}))
vi.mock('@/core/api/client', () => ({ apiJson: async (url: string) => { urls.push(url); return [] } }))

const { useAttendanceTrend } = await import('./useAttendance')

async function request(...args: Parameters<typeof useAttendanceTrend>) {
  // A plain call, not a render: useQuery is stubbed above, so no React rules apply here.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useAttendanceTrend(...args)
  const q = seen[seen.length - 1]
  await q.queryFn()
  return { key: q.queryKey, url: urls[urls.length - 1] }
}

describe('useAttendanceTrend', () => {
  beforeEach(() => { seen.length = 0; urls.length = 0 })

  it('includeLeavers: asks for people who have left since, under its own key', async () => {
    const r = await request('2026-09-07', '2026-10-07', undefined, true, { includeSelf: true, includeLeavers: true })
    expect(r.url).toBe('/v1/attendance/dashboard/trend?from=2026-09-07&to=2026-10-07&includeLeavers=true&includeSelf=true')
    expect(r.key).toEqual(['hrms', 'attendance', 'dashboard', 'trend', '2026-09-07', '2026-10-07', undefined, 'leavers', 'self'])
  })

  it('without it: the request and key are as before', async () => {
    const r = await request('2026-09-07', '2026-10-07', undefined, true, { includeSelf: true })
    expect(r.url).toBe('/v1/attendance/dashboard/trend?from=2026-09-07&to=2026-10-07&includeSelf=true')
    expect(r.url).not.toContain('includeLeavers')
    expect(r.key).toEqual(['hrms', 'attendance', 'dashboard', 'trend', '2026-09-07', '2026-10-07', undefined, 'self'])
    const bare = await request()
    expect(bare.url).toBe('/v1/attendance/dashboard/trend?')
    expect(bare.key).toEqual(['hrms', 'attendance', 'dashboard', 'trend', undefined, undefined, undefined])
  })
})
