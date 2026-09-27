// /hrms/att-analytics — Attendance analytics' route (a seam: App.tsx points here so the analytics
// package can replace this page without touching App.tsx). Until then it renders today's page.
import { AttendanceContainer } from './AttendanceContainer'

export function AnalyticsRoute() {
  return <AttendanceContainer />
}
