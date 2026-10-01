// /me and /hrms/ess: the self-service Home (redesign P-HOME, EmpHome.dc.html).
// The route and the export name stay as they were; the page itself lives in ./home.
import { HomePage } from './home/HomePage'

export function EssDashboard() {
  return <HomePage />
}
