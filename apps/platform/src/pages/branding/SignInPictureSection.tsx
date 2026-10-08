// Settings → Branding → Sign-in picture (owner, 6 Oct 2026): one large picture beside the business's
// sign-in page — one per business, not per company. Until one is uploaded the sign-in shows our
// brand panel. Stored like the letterhead (POST / DELETE /v1/workspace/branding/login, V144_3).
import { useRef, useState } from 'react'
import { getAccessToken } from '@unifiedtree/sdk'
import { Image as ImageIcon, Upload } from 'lucide-react'
import { Modal } from '@unifiedtree/ui-kit'
import { API_BASE_URL } from '@/core/api/client'
import { resolveAssetUrl, type BrandingDto } from '@/core/tenant/workspaceBranding'
import { HrButton } from '@/shared/components/hr'
import { SettingsNote, SettingsSection } from '@/design/settings/SettingsKit'

type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void

/** The sign-in picture must be at least this many pixels on its shortest side (BrandingImage.LOGIN_MIN_SIDE). */
export const SIGN_IN_MIN_SIDE = 600
const MAX_BYTES = 2 * 1024 * 1024

/** Why a picked file can't be the sign-in picture, or null when it can (checked again on the server). */
export function signInPictureProblem(type: string, bytes: number, w: number, h: number): string | null {
  if (!/^image\/(png|jpeg|webp)$/.test(type)) return 'Use a PNG, JPEG or WebP picture.'
  if (bytes > MAX_BYTES) return 'The picture must be 2 MB or smaller. Save it at a lower quality and try again.'
  if (Math.min(w, h) < SIGN_IN_MIN_SIDE) return `The picture is ${w} × ${h} px. It must be at least ${SIGN_IN_MIN_SIDE} px on its shortest side so it stays sharp on a large screen.`
  return null
}

async function send(method: 'POST' | 'DELETE', file?: File): Promise<{ ok: true; dto: BrandingDto } | { ok: false; status: number; message: string }> {
  const bearer = getAccessToken()
  try {
    const init: RequestInit = { method, credentials: 'include', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }
    if (file) { const form = new FormData(); form.append('file', file, file.name); init.body = form }
    const resp = await fetch(`${API_BASE_URL}/v1/workspace/branding/login`, init)
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
    : status === 403 ? 'Only workspace admins can change the sign-in picture.'
      : status === 503 || status === 404 ? 'Sign-in picture uploads aren’t switched on for this workspace yet. Try again after the next update.'
        : message || 'Please try again.'

function sizeOf(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { reject(new Error('unreadable')); URL.revokeObjectURL(url) }
    img.src = url
  })
}

export function SignInPictureSection({ dto, canEdit, show, onSaved }: {
  dto: BrandingDto; canEdit: boolean; show: Show
  onSaved: (d: BrandingDto, title: string, msg: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const current = resolveAssetUrl(dto.loginUrl)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setProblem(null)
    let size: { w: number; h: number }
    try { size = await sizeOf(file) } catch { setProblem('That file isn’t a picture we can read.'); return }
    const why = signInPictureProblem(file.type, file.size, size.w, size.h)
    if (why) { setProblem(why); return }
    setBusy('save')
    const r = await send('POST', file)
    setBusy(null)
    if (!r.ok) { show('error', 'Sign-in picture not saved', failWords(r.status, r.message)); return }
    onSaved(r.dto, 'Sign-in picture saved', 'Your business’s sign-in page now shows it.')
  }

  const remove = async () => {
    setBusy('remove')
    const r = await send('DELETE')
    setBusy(null)
    setConfirmRemove(false)
    if (!r.ok) { show('error', 'Sign-in picture not removed', failWords(r.status, r.message)); return }
    onSaved(r.dto, 'Sign-in picture removed', 'The sign-in page shows the standard panel again.')
  }

  return (
    <SettingsSection id="sign-in-picture" icon="sunrise" title="Sign-in picture"
      summary="One large picture beside your business’s sign-in page. Without one, the page shows the standard panel.">
      {current ? (
        <img src={current} alt="Your sign-in picture" style={{ width: '100%', maxWidth: 480, aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--u-ln,#E3E9E6)' }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 480, padding: '18px 16px', borderRadius: 12, border: '1px dashed var(--u-ln,#E3E9E6)', color: 'var(--u-ink3,#6A7A73)', fontSize: 13.5 }}>
          <ImageIcon size={18} aria-hidden /> No sign-in picture yet: the standard panel shows instead.
        </div>
      )}
      {problem && <SettingsNote tone="amber">{problem}</SettingsNote>}
      {canEdit ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} aria-label="Choose a sign-in picture" />
          <HrButton disabled={busy !== null} onClick={() => input.current?.click()}>
            <Upload size={15} aria-hidden /> {busy === 'save' ? 'Saving…' : current ? 'Replace picture' : 'Upload a picture'}
          </HrButton>
          {current && <HrButton variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>Remove</HrButton>}
        </div>
      ) : (
        <SettingsNote>Only workspace admins can change the sign-in picture.</SettingsNote>
      )}
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>
        A landscape photo works best (it is cropped to fill the space). PNG, JPEG or WebP, up to 2 MB, at least {SIGN_IN_MIN_SIDE} px on the shortest side.
      </p>
      <Modal open={confirmRemove} onOpenChange={(o: boolean) => { if (!o && busy === null) setConfirmRemove(false) }}
        title="Remove the sign-in picture?"
        description="Your business’s sign-in page will show the standard panel instead. You can upload a picture again at any time."
        size="sm">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <HrButton variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemove(false)}>Keep it</HrButton>
          <HrButton variant="danger" disabled={busy !== null} onClick={() => { void remove() }}>{busy === 'remove' ? 'Removing…' : 'Remove'}</HrButton>
        </div>
      </Modal>
    </SettingsSection>
  )
}
