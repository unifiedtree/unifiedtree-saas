// /hrms/pli — the production-linked incentive's route (a seam: App.tsx points here so its package can
// replace this page without touching App.tsx). Until then it renders today's page.
import { PayrollContainer } from './PayrollContainer'

export function PliRoute() {
  return <PayrollContainer />
}
