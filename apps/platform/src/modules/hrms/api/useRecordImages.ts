// Employee photos, branch logos and agency logos (V143.102, testers' Workforce feedback 6 Oct).
//   POST/DELETE /v1/hrms/employees/{id}/photo   — the person themself, or hrms.employee.write
//   POST/DELETE /v1/hrms/branches/{id}/logo     — org.company.write
//   POST/DELETE /v1/hrms/contractors/{id}/logo  — hrms.contractor.write
//   GET /v1/hrms/record-images?kind=…          — { available, urls: { recordId: "/v1/public/images/…" } }
// The browser shrinks the picture first (a photo to a 512 px square JPG, a logo to at most 512 px PNG),
// so a large phone photo still goes up well under the server's 2 MB limit; the server checks and
// re-encodes it again. The addresses are API paths: the kit Avatar (mediaSrc) loads them.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type ImageKind = 'employee' | 'branch' | 'agency'

/** What the browser accepts to pick (it is converted before upload). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif'
/** The largest picture the browser will try to shrink. */
export const MAX_PICK_BYTES = 10 * 1024 * 1024
/** The largest file the server takes (RecordImage.MAX_BYTES). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const OUT_SIDE = 512

const BASE: Record<ImageKind, (id: string) => string> = {
  employee: (id) => `/v1/hrms/employees/${id}/photo`,
  branch: (id) => `/v1/hrms/branches/${id}/logo`,
  agency: (id) => `/v1/hrms/contractors/${id}/logo`,
}

/** Why a picked file can't be used, or null. */
export function pickProblem(file: File): string | null {
  if (!file.type || !file.type.startsWith('image/')) return 'Choose a picture (JPG or PNG)'
  if (file.size > MAX_PICK_BYTES) return 'Choose a picture of 10 MB or smaller'
  return null
}

/** The size to draw at: a photo is the centred square, a logo keeps its shape; never enlarged. */
export function drawBox(w: number, h: number, shape: 'photo' | 'logo') {
  if (shape === 'photo') {
    const side = Math.min(w, h)
    const out = Math.min(side, OUT_SIDE)
    return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), sw: side, sh: side, dw: out, dh: out }
  }
  const scale = Math.min(1, OUT_SIDE / Math.max(w, h))
  return { sx: 0, sy: 0, sw: w, sh: h, dw: Math.max(1, Math.round(w * scale)), dh: Math.max(1, Math.round(h * scale)) }
}

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file)
      return { img: b, w: b.width, h: b.height, done: () => b.close() }
    } catch { /* fall back to an <img> (some browsers decode more formats there) */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const el = new Image()
    await new Promise<void>((ok, bad) => { el.onload = () => ok(); el.onerror = () => bad(new Error('unreadable')); el.src = url })
    return { img: el, w: el.naturalWidth, h: el.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('This picture can’t be read here. Try a JPG or PNG.')
  }
}

/** Shrinks the picture in the browser: a photo to a square JPG, a logo to a PNG (transparency kept). */
export async function prepareImage(file: File, shape: 'photo' | 'logo'): Promise<Blob> {
  const problem = pickProblem(file)
  if (problem) throw new Error(problem)
  const { img, w, h, done } = await decode(file)
  try {
    if (w < 64 || h < 64) throw new Error('This picture is too small. Use one at least 64 px on each side.')
    const b = drawBox(w, h, shape)
    const canvas = document.createElement('canvas')
    canvas.width = b.dw; canvas.height = b.dh
    const g = canvas.getContext('2d')
    if (!g) throw new Error('This browser can’t prepare the picture. Try another browser.')
    if (shape === 'photo') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, b.dw, b.dh) }
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, b.sx, b.sy, b.sw, b.sh, 0, 0, b.dw, b.dh)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, shape === 'photo' ? 'image/jpeg' : 'image/png', 0.9))
    if (!blob) throw new Error('This browser can’t prepare the picture. Try another browser.')
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('The picture must be 2 MB or smaller')
    return blob
  } finally {
    done()
  }
}

/** Uploads a prepared picture; resolves to its address. */
export async function uploadRecordImage(kind: ImageKind, id: string, blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', blob, kind === 'employee' ? 'photo.jpg' : 'logo.png')
  const r = await apiJson<{ url: string }>(BASE[kind](id), { method: 'POST', body: form })
  return r.url
}

export async function removeRecordImage(kind: ImageKind, id: string): Promise<void> {
  await apiJson<void>(BASE[kind](id), { method: 'DELETE' })
}

export interface RecordImageList { available: boolean; urls: Record<string, string> }
const NONE: RecordImageList = { available: false, urls: {} }

export const recordImagesKey = (kind: ImageKind) => ['hrms', 'record-images', kind] as const

/** Every image of a kind (record id → address). Empty when the server doesn't have them yet. */
export function useRecordImages(kind: ImageKind, enabled = true) {
  return useQuery({
    queryKey: recordImagesKey(kind),
    queryFn: () => apiJson<RecordImageList>(`/v1/hrms/record-images?kind=${kind}`).catch(() => NONE),
    enabled,
    staleTime: 120_000,
  })
}

/** After a change: the lists, the directory and the person's records refetch. */
export function useRefreshImages() {
  const qc = useQueryClient()
  return (kind: ImageKind) => {
    void qc.invalidateQueries({ queryKey: recordImagesKey(kind) })
    if (kind === 'employee') {
      for (const key of [['hrms', 'employees'], ['hrms', 'employee'], ['user', 'me'], ['team'], ['hrms', 'org-chart']]) void qc.invalidateQueries({ queryKey: key })
    }
  }
}
