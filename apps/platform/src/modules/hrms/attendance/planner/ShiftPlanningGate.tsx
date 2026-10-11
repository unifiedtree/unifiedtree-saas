// The planner's and the Excel import's pages open only for a business in shift planning's pilot (the test businesses
// first; com.hrms.api.roster.RosterPilot decides). Anyone else who follows one of their links lands on Shifts & overtime.
// Nothing shows until the answer is in (once a sign-in), so a page never appears and then goes away.
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useShiftPlanningAvailability } from '../../api/useShiftPlanning'

export function ShiftPlanningGate({ children }: { children: ReactNode }) {
  const planning = useShiftPlanningAvailability()
  if (!planning.known) return null
  if (!planning.enabled) return <Navigate to="/hrms/shifts" replace />
  return <>{children}</>
}
