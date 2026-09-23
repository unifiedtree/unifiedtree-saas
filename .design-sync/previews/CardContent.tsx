import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, Badge,
} from '@unifiedtree/design-sync-entry'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

// Key-value rows: the salary-structure breakdown.
export function KeyValueRows() {
  const rows: Array<[string, number]> = [
    ['Basic', 46250],
    ['HRA', 18500],
    ['Special allowance', 27750],
  ]
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Salary structure</CardTitle>
        <CardDescription>Monthly · effective 1 Apr 2026</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between py-1">
              <dt className="text-gray-500">{k}</dt>
              <dd className="tabular-nums">{inr(v)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between py-2 font-semibold" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <dt>Gross</dt>
            <dd className="tabular-nums">{inr(92500)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

// A divided list inside the content area.
export function WithList() {
  const items: Array<[string, string, 'success' | 'warning' | 'info', string]> = [
    ['Priya Sharma', 'Casual leave · 22 Sep', 'success', 'Approved'],
    ['Arjun Mehta', 'Sick leave · 23 Sep', 'warning', 'Pending'],
    ['Sneha Reddy', 'WFH · 23 Sep', 'info', 'Noted'],
  ]
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Away this week</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {items.map(([name, what, tone, label]) => (
            <div key={name} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium">{name}</div>
                <div className="text-xs text-gray-500">{what}</div>
              </div>
              <Badge tone={tone} size="sm">{label}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Content without a header: pt-5 restores the top padding CardContent drops.
export function ContentOnly() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="pt-5 text-sm">
        <div className="font-medium">Payroll cut-off is 25 Sep 2026</div>
        <p className="mt-1 text-gray-500">
          Attendance regularisations and reimbursements raised after the cut-off will be
          processed in the October run.
        </p>
      </CardContent>
    </Card>
  )
}
