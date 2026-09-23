import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Badge,
} from '@unifiedtree/design-sync-entry'
import { FileText, Users } from 'lucide-react'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

// A leave-balance card: header + rows + footer actions.
export function LeaveBalance() {
  const rows: Array<[string, number, number]> = [
    ['Casual leave', 8, 12],
    ['Sick leave', 5, 7],
    ['Earned leave', 14, 18],
  ]
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Leave balance</CardTitle>
        <CardDescription>FY 2026–27 · as of 18 Sep 2026</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {rows.map(([type, left, total]) => (
            <div key={type} className="flex items-center justify-between py-2 text-sm">
              <span>{type}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{left}</span>
                <span className="text-gray-500"> / {total} days</span>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="secondary" size="sm">View history</Button>
        <Button size="sm">Apply for leave</Button>
      </CardFooter>
    </Card>
  )
}

// interactive: pointer cursor + hover lift (the hover itself is not capturable).
export function Interactive() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card interactive className="p-4">
        <Users size={18} className="text-gray-500" />
        <div className="mt-2 text-sm font-semibold">Muster roll</div>
        <div className="text-xs text-gray-500">37 present today</div>
      </Card>
      <Card interactive className="p-4">
        <FileText size={18} className="text-gray-500" />
        <div className="mt-2 text-sm font-semibold">Run payroll</div>
        <div className="text-xs text-gray-500">Sep 2026 · Draft</div>
      </Card>
    </div>
  )
}

// A payslip summary with a status badge in the header.
export function PayslipSummary() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Payslip · Sep 2026</CardTitle>
          <CardDescription>Ananya Iyer · EMP-0142</CardDescription>
        </div>
        <Badge tone="success">Paid</Badge>
      </CardHeader>
      <CardContent>
        <dl className="text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">Gross earnings</dt>
            <dd className="tabular-nums">{inr(92500)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">Deductions</dt>
            <dd className="tabular-nums">− {inr(11840)}</dd>
          </div>
          <div className="mt-1 flex justify-between py-2 font-semibold" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <dt>Net pay</dt>
            <dd className="tabular-nums">{inr(80660)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
