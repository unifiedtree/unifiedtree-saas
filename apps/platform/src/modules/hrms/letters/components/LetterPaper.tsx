// A letter on its page, as the PDF prints it (P-DOCS; the client's "preview
// before saving"). The server sends the letterhead and the body, already
// cleaned for display, and the page it prints on (A4, 26.8 mm margins). This
// draws that page at real size inside a sandboxed frame (no scripts run in it)
// and scales it down to the space there is. Page ends are marked with a thin
// line. The paper stays white in dark mode: it is the document itself.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LetterPage } from '../api/useLetters'
import './letters.css'

const MM = 96 / 25.4 // CSS px per mm

/** The letter as a full HTML document laid out like the PDF (Arial 12pt, 1.6 line height, the page's margins). */
export function paperDocument(html: string, page: LetterPage): string {
  const w = page.widthMm, h = page.heightMm, m = page.marginMm
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff}
body{box-sizing:border-box;width:${w}mm;min-height:${h}mm;padding:${m}mm;font-family:Arial,Helvetica,sans-serif;font-size:12pt;line-height:1.6;color:#1a1a1a;overflow:hidden;
background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(${h}mm - 1px),#c9d2ce calc(${h}mm - 1px),#c9d2ce ${h}mm)}
h1{font-size:18pt}h2{font-size:15pt}h3{font-size:13pt}p{margin:0 0 8pt 0}img{max-width:100%}
table{border-collapse:collapse}
</style></head><body>${html}</body></html>`
}

/** How many pages a letter of this height takes. */
export function pageCount(contentPx: number, page: LetterPage): number {
  const pagePx = page.heightMm * MM
  return Math.max(1, Math.ceil((contentPx - 2) / pagePx))
}

export function LetterPaper({ html, page, title, busy }: {
  html: string
  page: LetterPage
  /** The frame's accessible name ("Letter preview"). */
  title: string
  /** Show that a newer preview is on its way. */
  busy?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(0)
  const pageW = page.widthMm * MM
  const pageH = page.heightMm * MM
  const [contentH, setContentH] = useState(pageH)
  const doc = useMemo(() => paperDocument(html, page), [html, page])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  useEffect(() => { setContentH(pageH) }, [doc, pageH])
  const onLoad = () => {
    const body = frame.current?.contentDocument?.body
    if (body) setContentH(Math.max(pageH, body.scrollHeight))
  }

  const scale = width ? Math.min(1, width / pageW) : 0
  const pages = pageCount(contentH, page)
  return (
    <figure className="lt-paper" aria-busy={busy || undefined}>
      <div ref={wrap} className="lt-paper__wrap" style={{ height: scale ? contentH * scale : undefined }}>
        {scale > 0 && (
          <iframe ref={frame} title={title} srcDoc={doc} sandbox="allow-same-origin" onLoad={onLoad}
            className="lt-paper__frame" style={{ width: pageW, height: contentH, transform: `scale(${scale})` }} />
        )}
      </div>
      <figcaption className="lt-paper__cap">
        <span>{`${page.size} · ${page.widthMm} × ${page.heightMm} mm`}</span>
        <span>{`${pages} ${pages === 1 ? 'page' : 'pages'}`}</span>
      </figcaption>
    </figure>
  )
}
