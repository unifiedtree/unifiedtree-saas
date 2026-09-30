// Company notices (PgDashboard "upcoming"): a strip of notice chips. A chip opens the notice in a side panel,
// where people who manage the company can Edit it or Archive it (with the confirmation, as before). Five per
// page with Newer / Older; read-only on a past date. Notice event date (BW-118) and audience are not built yet.
import { useState } from 'react'
import { Button } from '@/design/kit/display'
import { DateInput, Input, SidePanel, Textarea } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import { fmtShort } from '@/design/dc/dates'

export interface NoticeVm { id: string; title: string; body: string; createdAt: string; expiresOn?: string | null }
export interface NoticeForm { title: string; body: string; expiry: string }

export function NoticesStrip({ notices, total, page, pages, isPast, sel, today, canManage, loading, error, onRetry, onPage, onSave, onArchive }: {
  notices: NoticeVm[]; total: number; page: number; pages: number; isPast: boolean; sel: string; today: string; canManage: boolean
  loading: boolean; error: boolean; onRetry: () => void; onPage: (p: number) => void
  onSave: (n: { id?: string | null; title: string; body: string; expiry: string | null }) => Promise<boolean>
  onArchive: (id: string) => Promise<void>
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<(NoticeForm & { id: string | null }) | null>(null)
  const [saving, setSaving] = useState(false)
  const open = notices.find((n) => n.id === openId) || null
  const meta = (n: NoticeVm) => `Posted ${fmtShort(n.createdAt.slice(0, 10))}${n.expiresOn ? ` · Until ${fmtShort(n.expiresOn)}` : ''}`
  const countText = isPast ? `${total} ${total === 1 ? 'notice was' : 'notices were'} up on ${fmtShort(sel)}` : total ? `${total} active` : 'None active'
  const save = async () => {
    if (!form || !form.title.trim() || !form.body.trim() || saving) return
    setSaving(true)
    try {
      const ok = await onSave({ id: form.id, title: form.title.trim(), body: form.body.trim(), expiry: form.expiry || null })
      if (ok) setForm(null)
    } finally { setSaving(false) }
  }

  return (
    <div className="ud-notices ufx-rise" role="region" aria-labelledby="ud-notices-title">
      <div className="ud-notices__lead">
        <span className="ud-notices__ic" aria-hidden="true">{dashIcon('megaphone', 17)}</span>
        <div>
          <h3 id="ud-notices-title" className="ud-notices__title">Company notices</h3>
          <div className="ud-notices__count">{loading ? 'Loading…' : error ? 'Couldn’t load' : countText}{pages > 1 && !loading ? ` · page ${page + 1} of ${pages}` : ''}</div>
        </div>
      </div>
      {error ? (
        <div className="ud-notices__none" role="alert">Couldn’t load the notices. <Button variant="plain" size={30} onClick={onRetry}>Try again</Button></div>
      ) : loading ? (
        <div className="ud-notices__list" aria-busy="true">{[0, 1, 2].map((i) => <span key={i} className="uk-skel uk-skel--hv" style={{ width: 180, height: 44, borderRadius: 10, flexShrink: 0 }} />)}</div>
      ) : notices.length ? (
        <div className="ud-notices__list" role="list" aria-label="Notices">
          {notices.map((n) => (
            <div key={n.id} role="listitem" style={{ display: 'flex', flexShrink: 0 }}>
              <button type="button" className="ud-nchip" onClick={() => setOpenId(n.id)} aria-label={`${n.title}. ${meta(n)}. Open the notice`}>
                <span className="ud-nchip__t">{n.title}</span>
                <span className="ud-nchip__m">{meta(n)}</span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="ud-notices__none">{isPast ? `No company notices were up on ${fmtShort(sel)}.` : 'No current company notices.'}</div>
      )}
      <div className="ud-notices__acts">
        {pages > 1 && (
          <>
            <Button variant="ghost" size={32} disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Newer notices">Newer</Button>
            <Button variant="ghost" size={32} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Older notices">Older</Button>
          </>
        )}
        {canManage && <Button variant="primary" size={32} icon="plus" onClick={() => setForm({ id: null, title: '', body: '', expiry: '' })}>Add notice</Button>}
      </div>

      <SidePanel open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ''} sub="Company notice · everyone" width={480}
        footer={open && canManage ? (
          <>
            <Button variant="danger-outline" icon="archive" onClick={() => { const id = open.id; setOpenId(null); void onArchive(id) }} aria-label="Archive notice">Archive</Button>
            <Button variant="primary" icon="pencil" onClick={() => { setForm({ id: open.id, title: open.title, body: open.body, expiry: open.expiresOn || '' }); setOpenId(null) }} aria-label="Edit notice">Edit</Button>
          </>
        ) : undefined}>
        {open && (
          <article aria-label={open.title}>
            <p className="ud-notice-meta">{meta(open)}{isPast ? ' · back to today to edit' : ''}</p>
            <p className="ud-notice-body">{open.body}</p>
          </article>
        )}
      </SidePanel>

      <SidePanel open={!!form} onClose={() => { if (!saving) setForm(null) }} title={form?.id ? 'Edit notice' : 'New notice'}
        sub="Short company-wide announcement shown on every dashboard." width={520} busy={saving}
        footer={<>
          <Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!form?.title.trim() || !form?.body.trim()} onClick={save}>Save notice</Button>
        </>}>
        {form && (
          <div style={{ display: 'grid', gap: 14 }}>
            <Input label="Notice title" maxLength={200} value={form.title} placeholder="e.g. Diwali holiday — office closed 20–21 Oct"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea label="Notice message" maxLength={5000} rows={5} value={form.body} placeholder="What should everyone know?"
              onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <DateInput label="Expiry (optional)" hint="The notice disappears from dashboards after this date." value={form.expiry} min={today} clearable placeholder="No expiry"
              onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
          </div>
        )}
      </SidePanel>
    </div>
  )
}
