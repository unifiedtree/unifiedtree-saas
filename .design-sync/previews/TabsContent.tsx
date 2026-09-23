import { Button, HrStatusPill, Tabs, TabsContent, TabsList, TabsTrigger } from '@unifiedtree/design-sync-entry'
import { Download, FileText } from 'lucide-react'

const documents = [
  { name: 'Offer letter — Priya Raghavan.pdf', added: '3 Mar 2021', status: 'Verified' as const },
  { name: 'PAN card.pdf', added: '5 Mar 2021', status: 'Verified' as const },
  { name: 'Aadhaar (masked).pdf', added: '5 Mar 2021', status: 'Verified' as const },
  { name: 'Form 16 — FY 2025-26.pdf', added: '12 Jun 2026', status: 'Pending' as const },
]

const personal: Array<[string, string]> = [
  ['Date of birth', '14 Aug 1994'],
  ['Gender', 'Female'],
  ['Blood group', 'O+'],
  ['Marital status', 'Single'],
  ['Personal email', 'priya.r@gmail.com'],
  ['Mobile', '+91 98450 12345'],
]

// Only the active panel's children mount (hidden panels render nothing): the
// Documents tab open, with a document list as its content.
export function DocumentsPanel() {
  return (
    <Tabs defaultValue="documents" variant="underline">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4">
        <p className="text-sm text-[var(--text-secondary)]">Overview</p>
      </TabsContent>
      <TabsContent value="personal" className="pt-4">
        <p className="text-sm text-[var(--text-secondary)]">Personal</p>
      </TabsContent>
      <TabsContent value="job" className="pt-4">
        <p className="text-sm text-[var(--text-secondary)]">Job</p>
      </TabsContent>
      <TabsContent value="documents" className="pt-4">
        <div className="ut-card divide-y divide-slate-100">
          {documents.map((d) => (
            <div key={d.name} className="flex items-center gap-3 px-5 py-3 text-sm">
              <FileText size={18} className="shrink-0 text-[var(--text-tertiary)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[var(--text-primary)]">{d.name}</p>
                <p className="text-xs text-[var(--text-tertiary)]">Added {d.added}</p>
              </div>
              <HrStatusPill tone={d.status === 'Verified' ? 'ok' : 'warn'}>{d.status}</HrStatusPill>
              <Button size="sm" variant="ghost" aria-label={`Download ${d.name}`}><Download size={16} /></Button>
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  )
}

// The Personal panel under the pills variant: a two-column fact grid, with
// `className` adding the top gap between tray and panel.
export function PersonalPanel() {
  return (
    <Tabs defaultValue="personal" variant="pills">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4">
        <p className="text-sm text-[var(--text-secondary)]">Overview</p>
      </TabsContent>
      <TabsContent value="personal" className="pt-4">
        <div className="ut-card grid grid-cols-2 gap-x-8 gap-y-3 p-5 text-sm">
          {personal.map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{k}</span>
              <span className="font-medium text-[var(--text-primary)]">{v}</span>
            </div>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="job" className="pt-4">
        <p className="text-sm text-[var(--text-secondary)]">Job</p>
      </TabsContent>
      <TabsContent value="documents" className="pt-4">
        <p className="text-sm text-[var(--text-secondary)]">Documents</p>
      </TabsContent>
    </Tabs>
  )
}
