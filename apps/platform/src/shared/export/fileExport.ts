// Client-side file exports used by the report pages and Workforce Analytics:
// CSV, a real .xlsx workbook (a small store-only ZIP writer, no dependency) and
// PNG from an SVG chart, all built from data the page already has. PDFs come
// from the server. Every download is recorded in the workspace's export log
// (hrms.report_exports): the server logs the files it builds, and files built
// here are recorded with POST /v1/reports/exports, so the Reports Center's
// "Recent downloads" is shared and auditable.
import { apiJson } from '@/core/api/client'

export type Cell = string | number | null | undefined

/** A CSV cell. Leading = + - @ tab/CR get a quote so spreadsheets don't run them as formulas. */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** CSV with a UTF-8 BOM (so Excel reads ₹ and names correctly) and CRLF lines. */
export function csvBlob(rows: Cell[][]) {
  return new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

// ── .xlsx ────────────────────────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** A ZIP archive with every file stored (no compression): what .xlsx needs, and tiny. */
function zip(files: { name: string; data: string }[]): Blob {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true)
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true)
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// XML 1.0 can't carry most control characters, so they're dropped rather than breaking the workbook.
// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const colName = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }

/** `bold`: extra rows (0-based) drawn bold, e.g. the headings of tables further down a summary sheet. */
export interface Sheet { name: string; rows: Cell[][]; widths?: number[]; bold?: number[] }

/** An Excel workbook, one sheet per entry; the first row of each sheet is bold (its header), plus any `bold` rows. */
export function xlsxBlob(sheets: Sheet[]): Blob {
  const safe = sheets.map((s, i) => ({ ...s, name: (s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`) }))
  const sheetXml = (s: Sheet) => {
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`, st = ri === 0 || s.bold?.includes(ri) ? ' s="1"' : ''
      if (v == null || v === '') return ''
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`
    }).join('')}</row>`).join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`
  }
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ])
}

// ── charts ───────────────────────────────────────────────────────────────────
/** Rasterises a standalone SVG string (it must carry width/height) to a PNG at 2x. */
export function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = width * 2; c.height = height * 2
      const g = c.getContext('2d')
      if (!g) return reject(new Error('Canvas unavailable'))
      g.scale(2, 2); g.fillStyle = '#fff'; g.fillRect(0, 0, width, height); g.drawImage(img, 0, 0, width, height)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the chart'))), 'image/png')
    }
    img.onerror = () => reject(new Error('Could not draw the chart'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── the export log ───────────────────────────────────────────────────────────
/** Report keys the export log knows (ReportKind on the server). */
export type ExportReportKey =
  | 'headcount' | 'attrition' | 'attendance-summary' | 'leave-balance' | 'late-marks' | 'diversity'
  | 'workforce-analytics' | 'audit-log' | 'employee-directory'
export type ExportFilters = Record<string, string | number | boolean | null | undefined>
export interface ExportMeta { report: ExportReportKey; fmt: 'XLSX' | 'CSV' | 'PNG'; companyId?: string; filters?: ExportFilters; rows?: number }

/** Tells an open Reports Center to reload its "Recent downloads". */
const changed = () => { try { window.dispatchEvent(new Event('ut-downloads')) } catch { /* no window */ } }

/** A file the server built (and already logged): just save it. */
export function saveServerFile(file: string, blob: Blob) {
  downloadBlob(file, blob)
  changed()
}

/**
 * Saves a file built in this browser and records it in the workspace's export
 * log. The download never waits for (or fails because of) the log entry.
 */
export function saveAndRecord(file: string, blob: Blob, meta: ExportMeta) {
  downloadBlob(file, blob)
  const filters = Object.fromEntries(Object.entries(meta.filters ?? {}).filter(([, v]) => v !== undefined && v !== ''))
  apiJson('/v1/reports/exports', {
    method: 'POST',
    body: JSON.stringify({ report: meta.report, format: meta.fmt, fileName: file, companyId: meta.companyId || null, filters, rowCount: meta.rows ?? null, sizeBytes: blob.size }),
  }).then(changed, () => { /* the file is saved; the log entry is best-effort */ })
}

export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
