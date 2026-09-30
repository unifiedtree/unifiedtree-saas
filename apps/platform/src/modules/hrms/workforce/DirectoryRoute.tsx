// /hrms/employees — the Workforce directory's route (a seam: App.tsx points here so the directory's
// package can replace this page without touching App.tsx). Until then it renders today's page.
import { MasterContainer } from '@/modules/hrms/master/MasterContainer'

export function DirectoryRoute() {
  return <MasterContainer />
}
