import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@unifiedtree/design-sync-entry'

// A one-line description under the title.
export function UnderTitle() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Tax regime</CardTitle>
        <CardDescription>Applies from FY 2026–27 onwards.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">New regime · Section 115BAC</CardContent>
    </Card>
  )
}

// A longer description that wraps to two lines.
export function LongText() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Full and final settlement</CardTitle>
        <CardDescription>
          Computed from the last working day. Unused earned leave is encashed and pending
          advances are recovered before the net amount is paid.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="flex justify-between py-1"><span className="text-gray-500">Last working day</span><span>30 Sep 2026</span></div>
        <div className="flex justify-between py-1"><span className="text-gray-500">Net payable</span><span className="tabular-nums font-semibold">{'₹' + (148200).toLocaleString('en-IN')}</span></div>
      </CardContent>
    </Card>
  )
}

// Description used as an employee meta line.
export function MetaLine() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Ananya Iyer</CardTitle>
        <CardDescription>EMP-0142 · Product Design · Joined 12 Mar 2024</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-gray-500">Reports to Priya Sharma</CardContent>
    </Card>
  )
}
