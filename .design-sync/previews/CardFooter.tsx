import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button,
} from '@unifiedtree/design-sync-entry'
import { Lock, Trash2 } from 'lucide-react'

// Right-aligned confirm/cancel pair.
export function ActionsRight() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Leave request</CardTitle>
        <CardDescription>Arjun Mehta · Casual leave · 25–26 Sep 2026</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-gray-500">2 days · balance after approval: 6 days</CardContent>
      <CardFooter className="justify-end">
        <Button variant="ghost" size="sm">Reject</Button>
        <Button size="sm">Approve</Button>
      </CardFooter>
    </Card>
  )
}

// Meta on the left, action on the right.
export function SplitMeta() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Offer letter</CardTitle>
        <CardDescription>Template v3 · Software Engineer II</CardDescription>
      </CardHeader>
      <CardFooter className="justify-between">
        <span className="text-xs text-gray-500">Last edited 18 Sep 2026 by Priya Sharma</span>
        <Button variant="secondary" size="sm">Save draft</Button>
      </CardFooter>
    </Card>
  )
}

// A destructive action opposite the primary one.
export function DestructiveAction() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Payroll · Sep 2026</CardTitle>
        <CardDescription>412 employees · {'₹' + (38120000).toLocaleString('en-IN')} net</CardDescription>
      </CardHeader>
      <CardFooter className="justify-between">
        <Button variant="danger-ghost" size="sm" leftIcon={<Trash2 size={14} />}>Delete run</Button>
        <Button size="sm" leftIcon={<Lock size={14} />}>Lock payroll</Button>
      </CardFooter>
    </Card>
  )
}
