// Settings → Branding → Letterhead (audit H-55: "upload previews for logo, letterhead and templates").
// A full-width banner for the top of generated letters, payslips and salary registers (V143_100). Pick
// an image and see it on a page before saving; once saved, "Preview a payslip" shows the payslip
// template exactly as the server draws it, with your letterhead and example figures (nothing real).
// Without a banner, documents keep the wide logo and the company name, as before.
//
// Degrades: before the server knows letterheads (no letterheadUrl in the answer, or 503 on upload)
// the section says so; the payslip preview has its own error and Retry.
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, usePermission } from '@unifiedtree/sdk'
import { FileText, Upload } from 'lucide-react'
import { apiJson, API_BASE_URL } from '@/core/api/client'
import { resolveAssetUrl, type BrandingDto } from '@/core/tenant/workspaceBranding'
import { HrButton } from '@/shared/components/hr'
import { Dialog } from '@/design/kit/Dialog'
import { SettingsNote, SettingsSection } from '@/design/settings/SettingsKit'
import { LETTERHEAD_MAX_SIDE, letterheadProblem, letterheadSaveSize, letterheadSizeText } from './letterheadModel'
import './letterhead.css'

type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void
interface Picked { name: string; url: string; blob: Blob; w: number; h: number }

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 2 * 1024 * 1024

/** Read the picked file, check its shape and turn it into a PNG (or JPEG, if the PNG is too big) the PDF can draw. */
async function prepare(file: File): Promise<Picked> {
  if (!ACCEPT.split(',').includes((file.type || '').toLowerCase())) throw new Error('Pick a PNG, JPEG or WebP image.')
  const src = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => fail(new Error('This file could not be opened as an image.'))
      i.src = src
    })
    const w0 = img.naturalWidth, h0 = img.naturalHeight
    const problem = letterheadProblem(w0, h0)
    if (problem) throw new Error(problem)
    if (Math.max(w0, h0) > LETTERHEAD_MAX_SIDE * 4) throw new Error('This image is far too large. Export it at about 2500 px wide and retry.')
    const { w, h } = letterheadSaveSize(w0, h0)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser cannot prepare images here.')
    ctx.drawImage(img, 0, 0, w, h)
    const encode = (type: string, q?: number) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, q))
    let blob = await encode('image/png')
    if (blob && blob.size > MAX_BYTES) {
      // A photographic banner: JPEG on white keeps it under 2 MB.
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      blob = await encode('image/jpeg', 0.9)
    }
    if (!blob) throw new Error('The image could not be prepared.')
    if (blob.size > MAX_BYTES) throw new Error('Even compressed, the image is larger than 2 MB. Pick a simpler one.')
    return { name: file.name, url: URL.createObjectURL(blob), blob, w, h }
  } finally {
    URL.revokeObjectURL(src)
  }
}

async function send(method: 'POST' | 'DELETE', blob?: Blob): Promise<{ ok: true; dto: BrandingDto } | { ok: false; status: number; message: string }> {
  const bearer = getAccessToken()
  try {
    const init: RequestInit = { method, credentials: 'include', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }
    if (blob) { const form = new FormData(); form.append('file', blob, blob.type === 'image/jpeg' ? 'letterhead.jpg' : 'letterhead.png'); init.body = form }
    const resp = await fetch(`${API_BASE_URL}/v1/workspace/branding/letterhead`, init)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      let message = ''
      try { message = (JSON.parse(text) as { message?: string }).message ?? '' } catch { /* not JSON */ }
      return { ok: false, status: resp.status, message }
    }
    return { ok: true, dto: await resp.json() as BrandingDto }
  } catch {
    return { ok: false, status: 0, message: '' }
  }
}

const failWords = (status: number, message: string) =>
  status === 0 ? 'Could not reach the server. Check your connection and try again.'
    : status === 403 ? 'Only workspace admins can change the letterhead.'
      : status === 503 || status === 404 ? 'Letterhead uploads aren’t switched on for this workspace yet. Try again after the next update.'
        : message || 'Please try again.'

/** A page as it prints: the letterhead on top (or the logo and name without one), then a letter or a payslip. */
export function PagePreview({ banner, logo, name, kind, label }: { banner: string | null; logo: string | null; name: string; kind: 'letter' | 'payslip'; label: string }) {
  return (
    <figure className="lh-page" aria-label={label}>
      <div className="lh-paper">
        <div className="lh-head">
          {banner
            ? <img src={banner} alt="" className="lh-banner" />
            : <span className="lh-fallback">{logo && <img src={logo} alt="" />}<b>{name || 'Your company'}</b></span>}
        </div>
        {kind === 'letter' ? (
          <div className="lh-body" aria-hidden="true">
            <i style={{ width: '30%' }} /><i style={{ width: '45%' }} /><br />
            <i /><i /><i style={{ width: '88%' }} /><i /><i style={{ width: '62%' }} /><br />
            <i style={{ width: '24%' }} />
          </div>
        ) : (
          <div className="lh-body lh-body--slip" aria-hidden="true">
            <b className="lh-slip-t" />
            <span className="lh-grid"><i /><i /><i /><i /></span>
            <span className="lh-table"><i /><i /><i /><i /></span>
            <span className="lh-table"><i /><i /></span>
            <b className="lh-net" />
          </div>
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

export function LetterheadSection({ dto, name, logo, canEdit, show, onSaved }: {
  dto: BrandingDto; name: string; logo: string | null; canEdit: boolean; show: Show
  onSaved: (d: BrandingDto, title: string, msg: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const canPayroll = usePermission('payroll.runs.read')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [slip, setSlip] = useState<{ open: boolean; html: string | null; error: boolean }>({ open: false, html: null, error: false })
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url) }, [picked])

  const saved = resolveAssetUrl(dto.letterheadUrl)
  // An older server answers without the letterhead fields at all.
  const known = 'letterheadUrl' in dto

  const pick = async (file: File | undefined) => {
    if (!file) return
    setPickError(null)
    try { setPicked(await prepare(file)) } catch (e) { setPickError(e instanceof Error ? e.message : 'This image can’t be used.') }
    finally { if (inputRef.current) inputRef.current.value = '' }
  }
  const save = async () => {
    if (!picked) return
    setBusy('save')
    const r = await send('POST', picked.blob)
    setBusy(null)
    if (!r.ok) { show('error', 'The letterhead wasn’t saved', failWords(r.status, r.message)); return }
    setPicked(null)
    onSaved(r.dto, 'Letterhead saved', 'Letters, payslips and salary registers generated from now on open with it.')
  }
  const remove = async () => {
    setBusy('remove')
    const r = await send('DELETE')
    setBusy(null)
    if (!r.ok) { show('error', 'The letterhead wasn’t removed', failWords(r.status, r.message)); return }
    onSaved(r.dto, 'Letterhead removed', 'Documents go back to your wide logo and the company name.')
  }
  const openSlip = () => {
    setSlip({ open: true, html: null, error: false })
    apiJson<{ html: string }>('/v1/payroll/payslips/template-preview')
      .then((r) => setSlip({ open: true, html: r.html, error: false }))
      .catch(() => setSlip({ open: true, html: null, error: true }))
  }

  const summary = !known ? 'Letters and payslips use your wide logo and the company name'
    : saved ? `Letterhead set · ${letterheadSizeText(dto.letterheadWidth, dto.letterheadHeight)}`
      : 'No letterhead · documents use your wide logo and the company name'

  return (
    <SettingsSection id="letterhead" icon="fileText" title="Letterhead" summary={summary}>
      <p className="lh-intro">A banner across the top of generated letters, payslips and salary registers. Without one, they open with your wide logo and the company name.</p>
      <div className="lh-previews">
        <PagePreview banner={saved} logo={logo} name={name} kind="letter" label={saved ? 'Your letters now' : 'Your letters now (no letterhead)'} />
        <PagePreview banner={saved} logo={logo} name={name} kind="payslip" label={saved ? 'Your payslips now' : 'Your payslips now (no letterhead)'} />
        {picked && <PagePreview banner={picked.url} logo={logo} name={name} kind="letter" label="With the new letterhead" />}
      </div>

      {canEdit && (
        <div className="lh-actions">
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} aria-label="Letterhead image" />
          <HrButton onClick={() => inputRef.current?.click()} disabled={!!busy}><Upload size={14} className="mr-1.5" />{picked ? 'Pick another image' : saved ? 'Replace the letterhead' : 'Upload a letterhead'}</HrButton>
          {picked && <HrButton onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save letterhead'}</HrButton>}
          {picked && <HrButton variant="ghost" onClick={() => setPicked(null)} disabled={!!busy}>Cancel</HrButton>}
          {!picked && saved && <HrButton variant="danger" size="sm" onClick={remove} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</HrButton>}
          <span className="lh-hint">{picked ? `${picked.name} · saved as ${letterheadSizeText(picked.w, picked.h)}` : 'PNG, JPEG or WebP, at least twice as wide as tall, 128 px tall or more, up to 2 MB.'}</span>
        </div>
      )}
      {pickError && <SettingsNote tone="amber">{pickError}</SettingsNote>}
      {(canEdit || canPayroll) && (
        <div className="lh-actions">
          <HrButton variant="ghost" onClick={openSlip}><FileText size={14} className="mr-1.5" />Preview a payslip</HrButton>
          <span className="lh-hint">The payslip template as it prints, with your letterhead and example figures.</span>
        </div>
      )}

      <Dialog open={slip.open} onClose={() => setSlip({ open: false, html: null, error: false })} title="Payslip preview" width={720}
        sub="The payslip template with your letterhead. The figures are examples; nothing real is shown.">
        {slip.error ? (
          <SettingsNote tone="amber">Couldn’t load the payslip preview. <button type="button" className="lh-link" onClick={openSlip}>Try again</button></SettingsNote>
        ) : slip.html == null ? (
          <p className="lh-hint" role="status">Loading the preview…</p>
        ) : (
          <div className="lh-doc"><iframe title="Payslip preview" srcDoc={slip.html} sandbox="" className="lh-doc__frame" /></div>
        )}
      </Dialog>
    </SettingsSection>
  )
}
