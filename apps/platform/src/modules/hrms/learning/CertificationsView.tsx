// Learning · Certifications (PgGrow p-learn tab 3): everyone's certifications on file with when
// they were certified, when they expire and where that leaves them (BW-85,
// hrms.learning.skill.read). A certification is recorded on the person's skill in Skill matrix.
import { useState } from 'react'
import { CellPerson, EmptyState, FilterPills, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Input } from '@/design/kit/overlays'
import { useCertifications, type Certification } from '../api/useLearning'
import { certificationState, dateLong } from '../performance/growModel'

type Filter = 'all' | 'expiring' | 'expired'

export function CertificationsView() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const q = useCertifications({ status: filter, search, page, size: 25 })
  const columns: TableColumn<Certification>[] = [
    { key: 'employee', header: 'Employee', primary: true, render: (c) => <CellPerson name={c.employeeName || 'Employee'} sub={c.department || c.employeeCode || undefined} /> },
    { key: 'cert', header: 'Certification', render: (c) => <span style={{ display: 'grid' }}><span>{c.certificationName || 'Certified'}</span><span className="grw-muted">{c.skillName}</span></span> },
    { key: 'on', header: 'Certified on', render: (c) => (c.certifiedOn ? dateLong(c.certifiedOn) : '—') },
    { key: 'exp', header: 'Expires on', render: (c) => (c.expiresOn ? dateLong(c.expiresOn) : '—') },
    { key: 'status', header: 'Status', render: (c) => { const s = certificationState(c); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
  ]
  return (
    <Section title="Certifications" body="flush" error={q.error} onRetry={() => q.refetch()}
      actions={(
        <div className="grw-filters" style={{ justifyContent: 'flex-end', width: 'min(100%, 620px)' }}>
          <FilterPills label="Certification status" size="sm" value={filter} onChange={(v) => { setFilter(v); setPage(0) }}
            options={[{ value: 'all', label: 'All' }, { value: 'expiring', label: 'Expiring soon' }, { value: 'expired', label: 'Expired' }]} />
          <div className="grw-filters__fixed"><Input label="Search certifications" type="search" value={search} placeholder="Name, code or certification" onChange={(e) => { setSearch(e.target.value); setPage(0) }} /></div>
        </div>
      )}
      footer={(q.data?.total ?? 0) > 25 ? <Pager page={page} pageSize={25} total={q.data?.total ?? 0} onPageChange={setPage} noun="certifications" /> : undefined}>
      <Table label="Certifications" columns={columns} rows={q.data?.items ?? []} rowKey={(c) => c.skillId} loading={q.isLoading} mobile="cards"
        empty={<EmptyState variant="plain" icon="award" title={filter === 'all' && !search ? 'No certifications yet' : 'No certifications in this selection'}
          hint={filter === 'all' && !search ? 'Mark a skill as certified in Skill matrix to list it here.' : undefined} />} />
    </Section>
  )
}
