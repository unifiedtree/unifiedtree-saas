// The signed-in person's own work record: probation, confirmation, notice, designation, manager.
//
// Contract C0 · BW-98 · owner P-WF-PEOPLE
//   GET /v1/hrms/employees/me   → MyEmployeeRecord
//   Permission: isAuthenticated(); always the caller's own record (employee id
//   from the token). No pay, bank or identity fields. Today's GET
//   /v1/employees/me stays as it is (F3a's More profile card keeps using it).
//   Not available: until P-WF-PEOPLE adds the literal path, the request matches
//   today's /employees/{id} and answers 400 INVALID_PARAMETER ("me" isn't an
//   id); the hook reads that as not built yet, like a 404. It is also not
//   available for a login with no employee record (404).
// Used by: P-PROFILE (My profile), later F3a.
// The key sits under today's ['hrms','employees'], so every employee change refreshes it.
import { SHARED_KEYS, type MyEmployeeRecord } from './contracts'
import { asAvailable, defaultApi, unmatchedPathParam, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const MY_EMPLOYEE_RECORD_PATH = '/v1/hrms/employees/me'

export function myEmployeeRecordQuery(api: ApiFetch = defaultApi): SharedQueryOptions<MyEmployeeRecord> {
  return {
    queryKey: SHARED_KEYS.myEmployeeRecord,
    queryFn: () => asAvailable(() => api<MyEmployeeRecord>(MY_EMPLOYEE_RECORD_PATH), unmatchedPathParam),
  }
}

export function useMyEmployeeRecord(opts?: { enabled?: boolean }) {
  return useAvailableQuery<MyEmployeeRecord>({ ...myEmployeeRecordQuery(), enabled: opts?.enabled ?? true, staleTime: 60_000 })
}
