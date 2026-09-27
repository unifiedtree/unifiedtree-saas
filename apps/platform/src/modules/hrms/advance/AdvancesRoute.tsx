// /hrms/advances — Advances & loans' route (a seam: App.tsx points here so its package can replace
// this page without touching App.tsx). Until then it renders today's page.
import { PayrollContainer } from '@/modules/hrms/payroll/PayrollContainer'

export function AdvancesRoute() {
  return <PayrollContainer />
}
