// Workspace Settings → Branding. The workspace's own square mark and wide
// logo (white label: customers never see the vendor's). Built only from the
// settings kit (SettingsSection / SettingsNote / SettingsToggleRow), the
// module kit's Views tabs, HrButton and the ui-kit Modal.
//
// Editing happens in the browser (brandingImage.ts): crop to a square mark or
// a wide logo, optionally remove a flat background with a tolerance slider,
// and compare before / after on the dark green rail and on white. The server
// re-validates every upload (type from magic bytes, 2 MB, ≥ 128 px).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAccessToken, usePermission } from '@unifiedtree/sdk'
import { Modal } from '@unifiedtree/ui-kit'
import { Upload } from 'lucide-react'
import { apiJson, API_BASE_URL } from '@/core/api/client'
import { reloadWorkspaceBranding, resolveAssetUrl, monogramOf, type BrandingDto } from '@/core/tenant/workspaceBranding'
import { HrButton } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { SettingsSection, SettingsNote, SettingsToggleRow } from '@/design/settings/SettingsKit'
import { Views } from '@/design/module/ModuleKit'
import {
  ACCEPT_ATTR, ImageCheckError, centredCrop, clampCrop, cropPreviewUrl, exportPng, exportSize, loadSource, processed,
  type Crop, type Source,
} from './brandingImage'

type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void
type Kind = 'mark' | 'logo'

const RAIL_GREEN = '#0c5a45'
const CHECKER = 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%) 50% / 16px 16px'
const LABEL: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#64748b' }
const BODY: React.CSSProperties = { fontSize: 13.5, color: '#475569', lineHeight: 1.5 }

/** Human sentences for the HTTP status codes an upload / removal can return. */
function humanError(status: number, body?: string): { title: string; description: string } {
  const server = (() => { if (!body) return ''; try { return (JSON.parse(body) as { message?: string }).message ?? '' } catch { return '' } })()
  switch (status) {
    case 0: return { title: 'Could not reach the server', description: 'Check your internet connection and try again.' }
    case 401: return { title: 'Your session has expired', description: 'Please sign in again to change the branding.' }
    case 402: return { title: 'Your subscription has ended', description: 'You can view branding, but to change it please renew your subscription from Manage plan.' }
    case 403: return { title: 'You don’t have permission for this', description: 'Only workspace admins can change the logo. Ask your admin to update it.' }
    case 413: return { title: 'That image is too large', description: server || 'Pick a file 2 MB or smaller.' }
    case 415: return { title: 'That file type isn’t supported', description: server || 'Upload a PNG, JPEG or WebP image.' }
    case 422: return { title: 'That image can’t be used', description: server || 'It must be at least 128 px on its shortest side.' }
    default:
      if (status >= 500) return { title: 'Something went wrong on our end', description: 'Please try again in a minute.' }
      return { title: 'That didn’t work', description: server || 'Please try again.' }
  }
}

/** The rail's logo slot as the app draws it: image (or monogram) over the workspace name. */
function RailPreview({ src, letter, name, size = 30 }: { src: string | null; letter: string; name: string; size?: number }) {
  return (
    <div style={{ width: 88, height: 64, borderRadius: 12, background: RAIL_GREEN, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, flex: '0 0 auto' }}>
      {src
        ? <img src={src} alt="" style={{ height: size, maxWidth: 76, objectFit: 'contain', display: 'block' }} />
        : <span style={{ fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontWeight: 800, fontSize: 23, letterSpacing: '-.05em', lineHeight: '.9', color: '#fff', display: 'inline-flex', alignItems: 'flex-end', gap: 2 }}>
            {letter}<i style={{ width: 8, height: 8, borderRadius: 999, background: '#6ee7b7', display: 'inline-block', marginBottom: 3 }} />
          </span>}
      <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>{name}</span>
    </div>
  )
}

/** The same image on white (sign-in card, payslip and letter headers). */
function WhitePreview({ src, letter, height = 40 }: { src: string | null; letter: string; height?: number }) {
  return (
    <div style={{ minWidth: 88, height: 64, padding: '0 12px', borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
      {src
        ? <img src={src} alt="" style={{ height, maxWidth: 200, objectFit: 'contain', display: 'block' }} />
        : <span style={{ width: 40, height: 40, borderRadius: 12, background: '#059669', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontWeight: 800, fontSize: 20 }}>{letter}</span>}
    </div>
  )
}

function PreviewPair({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <span style={LABEL}>{title}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{children}</div>
    </div>
  )
}

async function send(method: 'POST' | 'DELETE', kind: Kind, blob?: Blob): Promise<{ ok: true; dto: BrandingDto } | { ok: false; status: number; body: string }> {
  const bearer = getAccessToken()
  let resp: Response
  try {
    const init: RequestInit = { method, credentials: 'include', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }
    if (blob) { const form = new FormData(); form.append('file', blob, `${kind}.png`); init.body = form }
    resp = await fetch(`${API_BASE_URL}/v1/workspace/branding/${kind}`, init)
  } catch {
    return { ok: false, status: 0, body: '' }
  }
  if (!resp.ok) return { ok: false, status: resp.status, body: await resp.text().catch(() => '') }
  return { ok: true, dto: await resp.json() as BrandingDto }
}

export const BrandingTab: React.FC<{ show: Show }> = ({ show }) => {
  const canEdit = usePermission('settings.branding.write')
  const [dto, setDto] = useState<BrandingDto | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<Kind | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoadError(false)
    apiJson<BrandingDto>('/v1/workspace/branding')
      .then((d) => setDto(d))
      .catch(() => setLoadError(true))
  }, [])
  useEffect(() => { load() }, [load])

  const name = dto?.workspaceName ?? ''
  const letter = dto?.monogram || monogramOf(name)
  const markUrl = resolveAssetUrl(dto?.markUrl)
  const logoUrl = resolveAssetUrl(dto?.logoUrl)

  const onSaved = (d: BrandingDto, title: string, msg: string) => {
    setDto(d)
    reloadWorkspaceBranding()
    show('ok', title, msg)
  }

  const remove = async (kind: Kind) => {
    setBusy(true)
    try {
      const r = await send('DELETE', kind)
      if (!r.ok) { const m = humanError(r.status, r.body); show('error', m.title, m.description); return }
      onSaved(r.dto, kind === 'mark' ? 'Square mark removed' : 'Wide logo removed', 'Everyone sees the change on their next page load.')
    } finally {
      setBusy(false)
      setConfirmRemove(null)
    }
  }

  const summary = dto === null
    ? (loadError ? 'Couldn’t load your branding' : 'Loading…')
    : markUrl || logoUrl
      ? [markUrl ? 'Square mark set' : null, logoUrl ? 'Wide logo set' : null].filter(Boolean).join(' · ')
      : `No logo yet · your workspace’s initial “${letter}” is shown`

  return (
    <>
      <SettingsSection id="logo" icon="building" title="Workspace logo" summary={summary}>
        {dto === null ? (
          loadError
            ? <SettingsNote tone="amber">We couldn’t load your branding just now. <button type="button" onClick={load} style={{ border: 0, background: 'none', padding: 0, color: '#047857', fontWeight: 600, cursor: 'pointer' }}>Try again</button></SettingsNote>
            : <div role="status" aria-label="Loading branding"><SkeletonBlock className="h-20 w-full rounded-xl" /></div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <PreviewPair title="In the app (rail and browser tab)">
                <RailPreview src={markUrl || logoUrl} letter={letter} name={name} />
              </PreviewPair>
              <PreviewPair title="On the sign-in page, payslips and letters">
                <WhitePreview src={logoUrl || markUrl} letter={letter} />
              </PreviewPair>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {([['mark', 'Square mark', markUrl, dto.markWidth, dto.markHeight, 'Shown in the app rail, on the welcome screen and as the browser tab icon.'],
                 ['logo', 'Wide logo', logoUrl, dto.logoWidth, dto.logoHeight, 'Shown on the sign-in page and at the top of payslips, salary registers and letters.']] as const)
                .map(([kind, title, url, w, h, where]) => (
                  <div key={kind} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{title}</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#64748b' }}>
                        {url ? `${w && h ? `${w} × ${h} px · ` : ''}${where}` : `Not set. ${kind === 'mark' ? `The ${logoUrl ? 'wide logo' : `initial “${letter}”`} is shown instead.` : `The ${markUrl ? 'square mark' : `initial “${letter}” and the workspace name are`} shown instead.`}`}
                      </span>
                    </div>
                    {url && <HrButton variant="ghost" size="sm" onClick={() => window.open(url, '_blank', 'noopener')}>Open image</HrButton>}
                    {url && canEdit && <HrButton variant="danger" size="sm" disabled={busy} onClick={() => setConfirmRemove(kind)}>Remove</HrButton>}
                  </div>
                ))}
            </div>
            <SettingsNote>With no image uploaded, the workspace shows its initial (“{letter}”, from “{name}”) in the app’s colours. The image addresses are public so the sign-in page can show them before anyone signs in: don’t put anything private in a logo.</SettingsNote>
          </>
        )}
      </SettingsSection>

      <SettingsSection id="editor" icon="pencil" title="Upload and edit" summary="Pick an image, crop it to a square mark or a wide logo, remove its background if you need to, then save.">
        {canEdit
          ? <BrandingEditor name={name} letter={letter} onSaved={onSaved} show={show} />
          : <SettingsNote>Only workspace admins can change the logo. Ask your admin if it needs updating.</SettingsNote>}
      </SettingsSection>

      <Modal open={confirmRemove !== null} onOpenChange={(o: boolean) => { if (!o && !busy) setConfirmRemove(null) }}
        title={confirmRemove === 'mark' ? 'Remove the square mark?' : 'Remove the wide logo?'}
        description={`Everyone in ${name || 'this workspace'} will see ${confirmRemove === 'mark' ? (logoUrl ? 'the wide logo' : `the initial “${letter}”`) : (markUrl ? 'the square mark' : `the initial “${letter}”`)} instead, on the sign-in page, in the app and on payslips and letters generated from now on. Letters already generated keep the old logo. You can upload an image again at any time.`}
        size="sm">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <HrButton variant="ghost" disabled={busy} onClick={() => setConfirmRemove(null)}>Keep it</HrButton>
          <HrButton variant="danger" disabled={busy} onClick={() => confirmRemove && remove(confirmRemove)}>{busy ? 'Removing…' : 'Remove'}</HrButton>
        </div>
      </Modal>
    </>
  )
}

const LOGO_ASPECTS = [
  { key: 'fit', label: 'Whole image' },
  { key: '2', label: '2 : 1' },
  { key: '3', label: '3 : 1' },
  { key: '4', label: '4 : 1' },
]

/** The in-browser editor: pick, crop, remove background, preview, save. */
function BrandingEditor({ name, letter, onSaved, show }: { name: string; letter: string; onSaved: (d: BrandingDto, title: string, msg: string) => void; show: Show }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('mark')
  const [aspectKey, setAspectKey] = useState('fit')
  const [size, setSize] = useState(100)
  const [crops, setCrops] = useState<Record<Kind, Crop | null>>({ mark: null, logo: null })
  const [removeBg, setRemoveBg] = useState(false)
  const [tolerance, setTolerance] = useState(20)
  const [saving, setSaving] = useState(false)
  const drag = useRef<{ px: number; py: number; crop: Crop } | null>(null)

  const W = source?.canvas.width ?? 1
  const H = source?.canvas.height ?? 1
  const aspect = kind === 'mark' ? 1 : aspectKey === 'fit' ? Math.max(1, W / H) : Number(aspectKey)

  // Background removal runs on the whole working image; re-run only when its inputs change.
  const after = useMemo(() => (source ? processed(source, removeBg, tolerance) : null), [source, removeBg, tolerance])
  const stageUrl = useMemo(() => (after ? after.toDataURL('image/png') : null), [after])

  const crop: Crop | null = source ? (crops[kind] ?? centredCrop(W, H, aspect)) : null

  // A new aspect or size keeps the crop centred where it was.
  const reshape = (nextAspect: number, fraction: number) => {
    if (!source) return
    const base = centredCrop(W, H, nextAspect, fraction / 100)
    const prev = crops[kind]
    const cx = prev ? prev.x + prev.w / 2 : W / 2
    const cy = prev ? prev.y + prev.h / 2 : H / 2
    setCrops((c) => ({ ...c, [kind]: clampCrop({ ...base, x: cx - base.w / 2, y: cy - base.h / 2 }, W, H) }))
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setPickError(null)
    try {
      const s = await loadSource(file)
      setSource(s)
      setCrops({ mark: null, logo: null })
      setSize(100)
      setAspectKey('fit')
      setRemoveBg(false)
    } catch (e) {
      setPickError(e instanceof ImageCheckError ? e.message : 'This file could not be opened as an image.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!crop) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, crop }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const stage = stageRef.current
    if (!d || !stage) return
    const r = stage.getBoundingClientRect()
    const k = W / r.width
    const next = clampCrop({ ...d.crop, x: d.crop.x + (e.clientX - d.px) * k, y: d.crop.y + (e.clientY - d.py) * k }, W, H)
    setCrops((c) => ({ ...c, [kind]: next }))
  }
  const onPointerUp = () => { drag.current = null }
  const nudge = (e: React.KeyboardEvent) => {
    if (!crop) return
    const step = Math.max(1, Math.round(W / 100)) * (e.shiftKey ? 5 : 1)
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    setCrops((c) => ({ ...c, [kind]: clampCrop({ ...crop, x: crop.x + d[0], y: crop.y + d[1] }, W, H) }))
  }

  const before = source && crop ? cropPreviewUrl(source.canvas, crop) : null
  const afterUrl = after && crop ? cropPreviewUrl(after, crop) : null
  const out = crop ? exportSize(crop, kind) : null

  const save = async () => {
    if (!after || !crop) return
    setSaving(true)
    try {
      let blob: Blob
      try { blob = await exportPng(after, crop, kind) }
      catch (e) { show('error', 'The image couldn’t be prepared', e instanceof Error ? e.message : undefined); return }
      const r = await send('POST', kind, blob)
      if (!r.ok) { const m = humanError(r.status, r.body); show('error', m.title, m.description); return }
      onSaved(r.dto, kind === 'mark' ? 'Square mark saved' : 'Wide logo saved', 'Everyone sees it on their next page load.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPT_ATTR} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <HrButton onClick={() => inputRef.current?.click()} disabled={saving}><Upload size={14} className="mr-1.5" />{source ? 'Pick another image' : 'Pick an image'}</HrButton>
        <span style={BODY}>{source ? `${source.name} · ${source.naturalW} × ${source.naturalH} px` : 'PNG, JPEG, WebP or SVG, up to 2 MB, at least 128 px on the shortest side.'}</span>
      </div>
      {pickError && <SettingsNote tone="amber">{pickError}</SettingsNote>}

      {source && crop && (
        <>
          <Views label="What to save" items={[{ key: 'mark', label: 'Square mark' }, { key: 'logo', label: 'Wide logo' }]} active={kind} onChange={(k) => { setKind(k as Kind); setSize(100) }} />
          <span style={BODY}>
            {kind === 'mark'
              ? 'A square image for the app rail, the welcome screen and the browser tab. A symbol or initials work best.'
              : 'A wide image for the sign-in page and the top of payslips, salary registers and letters. Your full logo with its name works best.'}
          </span>

          <div style={{ display: 'grid', gap: 8 }}>
            <span style={LABEL}>Drag the frame to choose the area (arrow keys move it too)</span>
            <div ref={stageRef} style={{ position: 'relative', width: '100%', maxWidth: 520, aspectRatio: `${W} / ${H}`, maxHeight: 360, background: CHECKER, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', touchAction: 'none' }}>
              {stageUrl && <img src={stageUrl} alt="The picked image" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none' }} />}
              <div role="slider" tabIndex={0} aria-label="Crop area. Use the arrow keys to move it."
                aria-valuetext={`${Math.round(crop.x)}, ${Math.round(crop.y)}`}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={nudge}
                style={{ position: 'absolute', left: `${(crop.x / W) * 100}%`, top: `${(crop.y / H) * 100}%`, width: `${(crop.w / W) * 100}%`, height: `${(crop.h / H) * 100}%`, border: '2px solid #fff', borderRadius: 4, boxShadow: '0 0 0 9999px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.35) inset', cursor: 'move', outline: 'none' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
            {kind === 'logo' && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={LABEL}>Shape</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {LOGO_ASPECTS.map((a) => (
                    <HrButton key={a.key} size="sm" variant={aspectKey === a.key ? 'primary' : 'ghost'} aria-pressed={aspectKey === a.key}
                      onClick={() => { setAspectKey(a.key); setSize(100); reshape(a.key === 'fit' ? Math.max(1, W / H) : Number(a.key), 100) }}>{a.label}</HrButton>
                  ))}
                </div>
              </div>
            )}
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={LABEL}>Frame size</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="range" min={20} max={100} value={size} aria-label="Frame size"
                  onChange={(e) => { const v = parseInt(e.target.value, 10); setSize(v); reshape(aspect, v) }} className="h-2 flex-1 cursor-pointer accent-[#059669]" />
                <span style={{ width: 44, textAlign: 'right', fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{`${size}%`}</span>
              </span>
            </label>
          </div>

          <SettingsToggleRow label="Remove background" on={removeBg} onToggle={() => setRemoveBg((v) => !v)}
            detail="Makes the flat colour around your logo transparent, starting from the edges, so it sits cleanly on the green rail. Check the preview: raise the tolerance if a halo is left, lower it if parts of the logo disappear." />
          {removeBg && (
            <label style={{ display: 'grid', gap: 6, maxWidth: 520 }}>
              <span style={LABEL}>Tolerance</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="range" min={0} max={100} value={tolerance} aria-label="Background removal tolerance"
                  onChange={(e) => setTolerance(parseInt(e.target.value, 10))} className="h-2 flex-1 cursor-pointer accent-[#059669]" />
                <span style={{ width: 44, textAlign: 'right', fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{tolerance}</span>
              </span>
            </label>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            <PreviewPair title="Before, on the rail and on white">
              <RailPreview src={before} letter={letter} name={name} size={kind === 'mark' ? 30 : 24} />
              <WhitePreview src={before} letter={letter} height={kind === 'mark' ? 40 : 32} />
            </PreviewPair>
            <PreviewPair title={removeBg ? 'After, on the rail and on white' : 'After (background kept)'}>
              <RailPreview src={afterUrl} letter={letter} name={name} size={kind === 'mark' ? 30 : 24} />
              <WhitePreview src={afterUrl} letter={letter} height={kind === 'mark' ? 40 : 32} />
            </PreviewPair>
          </div>

          {out?.upscaled && <SettingsNote tone="amber">The selected area is smaller than 128 px, so it will be enlarged to {out.w} × {out.h} px and may look soft. Pick a larger image if you can.</SettingsNote>}
          <SettingsNote tone="amber">Saving replaces the {kind === 'mark' ? 'square mark' : 'wide logo'} for everyone in {name || 'this workspace'} straight away: on the sign-in page, in the app, on the browser tab, and on payslips, salary registers and letters generated from now on. Letters already generated keep the old logo.</SettingsNote>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <HrButton onClick={save} disabled={saving}>{saving ? 'Saving…' : kind === 'mark' ? 'Save square mark' : 'Save wide logo'}</HrButton>
            {out && <span style={BODY}>{`Saved as a ${out.w} × ${out.h} px PNG${removeBg ? ' with a transparent background' : ''}.`}</span>}
          </div>
        </>
      )}
    </>
  )
}
