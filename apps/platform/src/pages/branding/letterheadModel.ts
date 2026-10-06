// The letterhead banner's rules (Settings → Branding → Letterhead, audit H-55), the same as the
// server's (BrandingImage, V143_100): PNG or JPEG after conversion, at least 128 px tall, at least
// twice as wide as it is tall, at most 4096 px. Saved no wider than an A4 page at 300 dpi.

export const LETTERHEAD_MIN_SIDE = 128
export const LETTERHEAD_MAX_SIDE = 4096
/** A4's width at 300 dpi: wider than that only adds bytes. */
export const LETTERHEAD_SAVE_WIDTH = 2480

/** Why this picture can't be a letterhead, or null when it can. */
export function letterheadProblem(w: number, h: number): string | null {
  if (!w || !h) return 'This image has no size. Export it again as PNG and retry.'
  if (Math.min(w, h) < LETTERHEAD_MIN_SIDE) return `The image is ${w} × ${h} px. It must be at least ${LETTERHEAD_MIN_SIDE} px tall so it prints sharply.`
  if (w < 2 * h) return `The image is ${w} × ${h} px. A letterhead runs across the top of the page: make it at least twice as wide as it is tall.`
  return null
}

/** The size it is saved at: as picked, or scaled down to A4's width (never below the minimum height). */
export function letterheadSaveSize(w: number, h: number): { w: number; h: number } {
  if (w <= LETTERHEAD_SAVE_WIDTH) return { w, h }
  const s = LETTERHEAD_SAVE_WIDTH / w
  const nh = Math.round(h * s)
  if (nh < LETTERHEAD_MIN_SIDE) return { w: Math.round(w * (LETTERHEAD_MIN_SIDE / h)), h: LETTERHEAD_MIN_SIDE }
  return { w: LETTERHEAD_SAVE_WIDTH, h: nh }
}

/** "1600 × 200 px · about 8 : 1". */
export function letterheadSizeText(w?: number | null, h?: number | null): string {
  if (!w || !h) return ''
  return `${w} × ${h} px · about ${Math.round((w / h) * 10) / 10} : 1`
}
