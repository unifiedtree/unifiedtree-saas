import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, Badge,
} from '@unifiedtree/design-sync-entry'
import { CalendarDays } from 'lucide-react'

// A plain title in its header.
export function InHeader() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Upcoming holidays</CardTitle>
        <CardDescription>Bengaluru calendar</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="flex justify-between py-1"><span>Gandhi Jayanti</span><span className="text-gray-500">2 Oct 2026</span></div>
        <div className="flex justify-between py-1"><span>Diwali</span><span className="text-gray-500">8 Nov 2026</span></div>
      </CardContent>
    </Card>
  )
}

// Title with a leading icon (className extends the h3).
export function WithIcon() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays size={16} className="text-gray-500" />
          Shift schedule
        </CardTitle>
        <CardDescription>Week of 21 Sep 2026</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-gray-500">General shift · 09:30 – 18:30 IST</CardContent>
    </Card>
  )
}

// Title with a count badge, as the dashboard "needs attention" tiles do.
export function WithCount() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Pending approvals
          <Badge tone="warning">12</Badge>
        </CardTitle>
        <CardDescription>Leave, expense and advance requests</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-gray-500">Oldest request waiting since 11 Sep 2026.</CardContent>
    </Card>
  )
}
