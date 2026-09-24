// Standalone SVG charts in the Workforce Analytics design's look, for PNG
// downloads and print snapshots. They're drawn from the same numbers the page
// shows, so a downloaded chart always matches the screen.
import { esc } from './fileExport'

const FONT = "'Plus Jakarta Sans',Inter,Segoe UI,Arial,sans-serif"
const niceStep = (raw: number) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].find((x) => x >= raw) || Math.ceil(raw / 10000) * 10000
const text = (x: number, y: number, s: string, o: { size?: number; weight?: number; fill?: string; anchor?: string } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size ?? 12}" font-weight="${o.weight ?? 600}" fill="${o.fill ?? '#334155'}" text-anchor="${o.anchor ?? 'start'}">${esc(s)}</text>`
const header = (w: number, title: string, sub?: string) => text(24, 34, title, { size: 17, weight: 800, fill: '#0f172a' }) + (sub ? text(24, 54, sub, { size: 12, weight: 500, fill: '#64748b' }) : '')
const legend = (w: number, items: [string, string][], y = 34) => {
  let x = w - 24, out = ''
  for (const [label, color] of [...items].reverse()) {
    const lw = label.length * 6.6 + 18
    x -= lw
    out += `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="3" fill="${color}"/>` + text(x + 15, y, label, { size: 11.5 })
    x -= 12
  }
  return out
}

/** Stacked bars (one per category), with value labels and a legend. */
export function stackedBarsSvg(o: { title: string; subtitle?: string; bars: { label: string; parts: number[] }[]; series: [string, string][]; width?: number; height?: number }) {
  const W = o.width ?? 880, H = o.height ?? 380, left = 58, right = 24, top = 84, bottom = 56, ch = H - top - bottom, cw = W - left - right
  const max = Math.max(1, ...o.bars.map((b) => b.parts.reduce((a, v) => a + v, 0))), step = niceStep((max * 1.1) / 4), topV = step * 4
  let g = ''
  for (let i = 0; i <= 4; i++) {
    const y = top + ch - (ch * i) / 4
    g += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="#e2e8f0" ${i ? 'stroke-dasharray="4 4"' : ''}/>` + text(left - 10, y + 4, (step * i).toLocaleString('en-IN'), { size: 11, fill: '#94a3b8', anchor: 'end' })
  }
  const slot = cw / Math.max(1, o.bars.length), bw = Math.min(44, slot * 0.6)
  o.bars.forEach((b, i) => {
    const cx = left + slot * i + slot / 2
    let y = top + ch
    b.parts.forEach((v, j) => { if (!v) return; const hgt = (v / topV) * ch; y -= hgt; g += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${hgt}" rx="${j === 0 ? 3 : 2}" fill="${o.series[j][1]}"/>` })
    const total = b.parts.reduce((a, v) => a + v, 0)
    g += text(cx, y - 6, total.toLocaleString('en-IN'), { size: 11.5, weight: 700, anchor: 'middle' })
    const lbl = b.label.length > 16 ? b.label.slice(0, 15) + '…' : b.label
    g += text(cx, top + ch + 20, lbl, { size: 11.5, anchor: 'middle' })
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${header(W, o.title, o.subtitle)}${legend(W, o.series)}${g}</svg>`
  return { svg, width: W, height: H }
}

/** A donut with a legend of counts and shares. */
export function donutSvg(o: { title: string; subtitle?: string; parts: { label: string; value: number; color: string }[]; centerLabel?: string; width?: number; height?: number }) {
  const W = o.width ?? 520, H = o.height ?? 300, cx = 130, cy = 170, r = 70, C = 2 * Math.PI * r
  const tot = o.parts.reduce((a, p) => a + p.value, 0)
  let acc = 0, rings = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="22"/>`
  for (const p of o.parts) {
    const len = tot ? (p.value / tot) * C : 0
    rings += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
    acc += len
  }
  let rows = ''
  o.parts.forEach((p, i) => {
    const y = 132 + i * 30
    rows += `<rect x="250" y="${y - 10}" width="10" height="10" rx="3" fill="${p.color}"/>` + text(268, y, p.label, { size: 13 }) + text(W - 80, y, p.value.toLocaleString('en-IN'), { size: 13, weight: 800, fill: '#0f172a', anchor: 'end' }) + text(W - 24, y, `${tot ? Math.round((p.value / tot) * 100) : 0}%`, { size: 13, fill: '#64748b', anchor: 'end' })
  })
  const center = text(cx, cy + 4, tot.toLocaleString('en-IN'), { size: 24, weight: 800, fill: '#0f172a', anchor: 'middle' }) + text(cx, cy + 22, (o.centerLabel || 'PEOPLE').toUpperCase(), { size: 10, weight: 700, fill: '#64748b', anchor: 'middle' })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${header(W, o.title, o.subtitle)}${rings}${center}${rows}</svg>`
  return { svg, width: W, height: H }
}

/** A line with a soft area under it; values are percentages. */
export function lineSvg(o: { title: string; subtitle?: string; points: { label: string; value: number }[]; unit?: string; series?: string; width?: number; height?: number }) {
  const W = o.width ?? 880, H = o.height ?? 340, left = 58, right = 24, top = 84, bottom = 48, ch = H - top - bottom, cw = W - left - right
  const unit = o.unit ?? '%', peak = Math.max(0, ...o.points.map((p) => p.value)), step = Math.max(1, Math.ceil((peak * 1.15) / 3)), topV = step * 3
  let g = ''
  for (let i = 0; i <= 3; i++) {
    const y = top + ch - (ch * i) / 3
    g += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="#e2e8f0" ${i ? 'stroke-dasharray="4 4"' : ''}/>` + text(left - 10, y + 4, `${step * i}${unit}`, { size: 11, fill: '#94a3b8', anchor: 'end' })
  }
  const slot = cw / Math.max(1, o.points.length)
  const pts = o.points.map((p, i) => [left + slot * i + slot / 2, top + ch - (p.value / topV) * ch])
  if (pts.length) {
    const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
    g += `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399" stop-opacity=".35"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></linearGradient></defs>`
    g += `<path d="${d} L${pts[pts.length - 1][0]},${top + ch} L${pts[0][0]},${top + ch} Z" fill="url(#a)"/><path d="${d}" fill="none" stroke="#0f6e56" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    pts.forEach((pt, i) => { g += `<circle cx="${pt[0]}" cy="${pt[1]}" r="4.5" fill="#fff" stroke="#0f6e56" stroke-width="2.5"/>` + text(pt[0], top + ch + 20, o.points[i].label, { size: 11, fill: '#64748b', anchor: 'middle' }) })
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${header(W, o.title, o.subtitle)}${legend(W, [[o.series || 'Attrition %', '#0f6e56']])}${g}</svg>`
  return { svg, width: W, height: H }
}
