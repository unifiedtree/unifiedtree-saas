// /hrms/shifts — Shifts & overtime's route (a seam: App.tsx points here so the shifts package can
// replace this page without touching App.tsx). Until then it renders today's page.
import { AttendanceContainer } from './AttendanceContainer'

export function ShiftsRoute() {
  return <AttendanceContainer />
}
