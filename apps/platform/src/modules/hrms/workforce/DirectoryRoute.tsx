// /hrms/employees — the Workforce directory's route (the seam App.tsx points at). The Master
// container still loads the data and saves the changes; the page itself is the redesign kit's
// DirectoryPage instead of the Master design's Employee Master.
import { MasterContainer } from '@/modules/hrms/master/MasterContainer'
import { DirectoryPage } from './DirectoryPage'

export function DirectoryRoute() {
  return <MasterContainer directory={(v) => <DirectoryPage key={v.pageKey} allowed={v.allowed} failed={v.failed} loading={v.loading} retry={v.retry} />} />
}
