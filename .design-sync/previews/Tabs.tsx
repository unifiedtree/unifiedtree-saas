import { HrStatusPill, Tabs, TabsContent, TabsList, TabsTrigger } from '@unifiedtree/design-sync-entry'
import type { ReactNode } from 'react'

const noop = () => {}

const overview: Array<[string, ReactNode]> = [
  ['Employee code', 'EMP-0142'],
  ['Department', 'Engineering'],
  ['Designation', 'Senior Engineer'],
  ['Reporting manager', 'Arjun Mehta'],
  ['Location', 'Bengaluru'],
  ['Status', <HrStatusPill tone="ok">Active</HrStatusPill>],
]
const job: Array<[string, ReactNode]> = [
  ['Date of joining', '3 Mar 2021'],
  ['Employment type', 'Full time'],
  ['Probation', <HrStatusPill tone="ok">Confirmed</HrStatusPill>],
  ['Cost centre', 'ENG-BLR-02'],
  ['Shift', 'General (09:30 – 18:30)'],
  ['Notice period', '60 days'],
]

function FactGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="ut-card grid grid-cols-2 gap-x-8 gap-y-3 p-5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-[var(--text-tertiary)]">{k}</span>
          <span className="font-medium text-[var(--text-primary)]">{v}</span>
        </div>
      ))}
    </div>
  )
}

// The default underline variant: the employee-record tab strip with the
// Overview panel open.
export function Underline() {
  return (
    <Tabs defaultValue="overview" variant="underline">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="personal" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="job" className="pt-4"><FactGrid rows={job} /></TabsContent>
      <TabsContent value="documents" className="pt-4"><FactGrid rows={overview} /></TabsContent>
    </Tabs>
  )
}

// variant="pills": the triggers sit in a compact tray that hugs its content.
export function Pills() {
  return (
    <Tabs defaultValue="overview" variant="pills">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="personal" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="job" className="pt-4"><FactGrid rows={job} /></TabsContent>
      <TabsContent value="documents" className="pt-4"><FactGrid rows={overview} /></TabsContent>
    </Tabs>
  )
}

// variant="cards": each trigger is its own bordered chip; the active one is tinted.
export function Cards() {
  return (
    <Tabs defaultValue="overview" variant="cards">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="personal" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="job" className="pt-4"><FactGrid rows={job} /></TabsContent>
      <TabsContent value="documents" className="pt-4"><FactGrid rows={overview} /></TabsContent>
    </Tabs>
  )
}

// Controlled: `value` + `onValueChange` let the route own the active tab —
// here the Job tab is pinned open from the URL.
export function ControlledJobTab() {
  return (
    <Tabs value="job" onValueChange={noop} variant="underline">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="personal" className="pt-4"><FactGrid rows={overview} /></TabsContent>
      <TabsContent value="job" className="pt-4"><FactGrid rows={job} /></TabsContent>
      <TabsContent value="documents" className="pt-4"><FactGrid rows={overview} /></TabsContent>
    </Tabs>
  )
}
