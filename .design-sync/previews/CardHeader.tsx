import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge,
} from '@unifiedtree/design-sync-entry'
import { Plus } from 'lucide-react'

// The default header: title stacked over a description.
export function TitleAndDescription() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Bank account</CardTitle>
        <CardDescription>Salary is credited to the primary account.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="flex justify-between py-1"><span className="text-gray-500">Bank</span><span>HDFC Bank</span></div>
        <div className="flex justify-between py-1"><span className="text-gray-500">Account</span><span className="tabular-nums">XXXX XXXX 4521</span></div>
        <div className="flex justify-between py-1"><span className="text-gray-500">IFSC</span><span>HDFC0001234</span></div>
      </CardContent>
    </Card>
  )
}

// Header with a trailing action (EmployeePersonal section shape).
export function WithAction() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Addresses</CardTitle>
          <CardDescription>Current and permanent</CardDescription>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />}>Add address</Button>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="py-1">14, Brigade Road, Bengaluru 560001</div>
        <div className="py-1 text-gray-500">Permanent · same as current</div>
      </CardContent>
    </Card>
  )
}

// Header with a status badge beside the title.
export function WithStatus() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Probation review</CardTitle>
          <Badge tone="warning" dot>Due in 6 days</Badge>
        </div>
        <CardDescription>Rahul Verma · EMP-0203 · ends 24 Sep 2026</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-gray-500">
        Reporting manager has not submitted the review yet.
      </CardContent>
    </Card>
  )
}
