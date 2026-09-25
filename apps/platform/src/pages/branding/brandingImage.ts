// Image work for Settings → Branding, done in the browser on a canvas:
// load and check the picked file, crop it (square mark or wide logo), remove a
// flat background by flood fill from the edges, and export a PNG. The server
// re-checks everything (BrandingImage.java), so these limits only save a
// round trip: PNG / JPEG / WebP (an SVG is rasterised here, never uploaded
// as SVG), 2 MB at most, at least 128 px on the shortest side.

export const MAX_BYTES = 2 * 1024 * 1024
export const MIN_SIDE = 128
/** Work at no more than this many pixels on the long side (keeps flood fill fast). */
const WORK_MAX = 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
export const ACCEPT_ATTR = ACCEPTED.join(',')

export interface Source {
  /** The picked image, drawn at working size. */
  canvas: HTMLCanvasElement
  /** Pixel size of the picked file itself. */
  naturalW: number
  naturalH: number
  name: string
}

/** A crop in working-canvas pixels. */
export interface Crop { x: number; y: number; w: number; h: number }

export class ImageCheckError extends Error {}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new ImageCheckError('This file could not be opened as an image. Export it again as PNG and retry.'))
    img.src = url
  })
}

/** Read and check a picked file, and draw it on a working canvas. */
export async function loadSource(file: File): Promise<Source> {
  const type = (file.type || '').toLowerCase()
  const isSvg = type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  if (!ACCEPTED.includes(type) && !isSvg) {
    throw new ImageCheckError('Pick a PNG, JPEG, WebP or SVG image.')
  }
  if (file.size > MAX_BYTES) throw new ImageCheckError('The file is larger than 2 MB. Pick a smaller one.')
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    let w = img.naturalWidth
    let h = img.naturalHeight
    if (isSvg && (!w || !h)) { w = 512; h = 512 }
    if (isSvg) {
      // Vector: draw it large enough to be sharp.
      const s = WORK_MAX / Math.max(w, h)
      w = Math.round(w * s); h = Math.round(h * s)
    }
    if (!w || !h) throw new ImageCheckError('This image has no size. Export it again as PNG and retry.')
    if (Math.min(w, h) < MIN_SIDE) {
      throw new ImageCheckError(`The image is ${w} × ${h} px. It must be at least ${MIN_SIDE} px on its shortest side so it stays sharp.`)
    }
    const scale = Math.min(1, WORK_MAX / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new ImageCheckError('Your browser cannot edit images here.')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    try {
      ctx.getImageData(0, 0, 1, 1)
    } catch {
      // Some browsers refuse to read back an SVG that embeds other content.
      throw new ImageCheckError('This SVG cannot be converted in the browser. Save it as PNG and pick that instead.')
    }
    return { canvas, naturalW: isSvg ? w : img.naturalWidth, naturalH: isSvg ? h : img.naturalHeight, name: file.name }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The largest crop of the given aspect (w / h) centred in a W × H image. */
export function centredCrop(W: number, H: number, aspect: number, fraction = 1): Crop {
  let w = W
  let h = w / aspect
  if (h > H) { h = H; w = h * aspect }
  w *= fraction; h *= fraction
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

/** Keep a crop inside the image. */
export function clampCrop(c: Crop, W: number, H: number): Crop {
  const w = Math.min(c.w, W)
  const h = Math.min(c.h, H)
  return { w, h, x: Math.min(Math.max(0, c.x), W - w), y: Math.min(Math.max(0, c.y), H - h) }
}

/**
 * Background removal by colour key + flood fill from the edges.
 *
 * The background colour is taken from the image's border (the median of the
 * edge pixels). Starting from every edge pixel that is close to it, the fill
 * spreads to neighbours whose colour is within `tolerance` (0–100) and makes
 * them transparent. Enclosed areas of the same colour (the inside of an "O")
 * are left alone, which is why it fills from the edges instead of keying out
 * the colour everywhere. Pixels just past the threshold at the boundary get
 * partial transparency so edges stay smooth.
 */
export function removeBackground(src: ImageData, tolerance: number): ImageData {
  const { width: W, height: H, data } = src
  const out = new ImageData(new Uint8ClampedArray(data), W, H)
  const px = out.data
  const n = W * H
  if (n === 0) return out

  // Background reference: per-channel median of the border pixels.
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  const push = (i: number) => { if (px[i * 4 + 3] > 8) { rs.push(px[i * 4]); gs.push(px[i * 4 + 1]); bs.push(px[i * 4 + 2]) } }
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1) }
  if (rs.length === 0) return out // already transparent all round
  const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1] }
  const br = med(rs), bg = med(gs), bb = med(bs)

  // Colour distance 0..~442; tolerance 0..100 maps to 0..~160.
  const tol = Math.max(0, Math.min(100, tolerance)) * 1.6
  const feather = Math.max(12, tol * 0.35)
  const dist = (i: number) => {
    const o = i * 4
    const dr = px[o] - br, dg = px[o + 1] - bg, db = px[o + 2] - bb
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }

  const removed = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const seed = (i: number) => {
    if (removed[i]) return
    if (px[i * 4 + 3] <= 8 || dist(i) <= tol) { removed[i] = 1; stack[sp++] = i }
  }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (sp > 0) {
    const i = stack[--sp]
    const x = i % W, y = (i - x) / W
    if (x > 0) seed(i - 1)
    if (x < W - 1) seed(i + 1)
    if (y > 0) seed(i - W)
    if (y < H - 1) seed(i + W)
  }

  for (let i = 0; i < n; i++) {
    if (removed[i]) { px[i * 4 + 3] = 0; continue }
    // Soft edge: a kept pixel touching the removed area fades by how close it is to the background.
    const x = i % W, y = (i - x) / W
    const touches = (x > 0 && removed[i - 1]) || (x < W - 1 && removed[i + 1]) || (y > 0 && removed[i - W]) || (y < H - 1 && removed[i + W])
    if (touches) {
      const d = dist(i)
      if (d < tol + feather) {
        const a = (d - tol) / feather
        px[i * 4 + 3] = Math.round(px[i * 4 + 3] * Math.max(0, Math.min(1, a)))
      }
    }
  }
  return out
}

/** The source, with the background removed when asked (on a new canvas). */
export function processed(source: Source, removeBg: boolean, tolerance: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = source.canvas.width
  c.height = source.canvas.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source.canvas, 0, 0)
  if (removeBg) {
    const data = ctx.getImageData(0, 0, c.width, c.height)
    ctx.putImageData(removeBackground(data, tolerance), 0, 0)
  }
  return c
}

/**
 * Output size for a crop. The mark is exported square, 128–512 px; the wide
 * logo 128–256 px tall. Both are always at least 128 px on the shortest side,
 * which is what the server requires.
 */
export function exportSize(crop: Crop, kind: 'mark' | 'logo'): { w: number; h: number; upscaled: boolean } {
  if (kind === 'mark') {
    const side = Math.round(Math.min(512, Math.max(MIN_SIDE, crop.w)))
    return { w: side, h: side, upscaled: crop.w < MIN_SIDE }
  }
  const aspect = crop.w / crop.h
  const h = Math.round(Math.min(256, Math.max(MIN_SIDE, crop.h)))
  let w = Math.round(h * aspect)
  if (w < MIN_SIDE) w = MIN_SIDE
  return { w, h, upscaled: crop.h < MIN_SIDE }
}

/** Draw the crop of `from` at the export size and encode it as PNG. */
export function exportPng(from: HTMLCanvasElement, crop: Crop, kind: 'mark' | 'logo'): Promise<Blob> {
  const { w, h } = exportSize(crop, kind)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(from, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) { reject(new ImageCheckError('The image could not be exported.')); return }
      if (b.size > MAX_BYTES) { reject(new ImageCheckError('The edited image is larger than 2 MB. Crop it smaller and try again.')); return }
      resolve(b)
    }, 'image/png')
  })
}

/** A data URL of the crop, for previews. */
export function cropPreviewUrl(from: HTMLCanvasElement, crop: Crop, maxH = 96): string {
  const scale = Math.min(1, maxH / crop.h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(crop.w * scale * 2))
  c.height = Math.max(1, Math.round(crop.h * scale * 2))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(from, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}
