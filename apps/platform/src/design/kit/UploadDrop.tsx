// Drop a file here, or click to choose one. Three looks from the design:
//
//   variant "bar"   a dashed full-width bar: icon and one line (EmpDocs "Add another document")
//   variant "box"   a dashed box: icon, the line, a hint under it (EmpClaims "Add a receipt")
//   variant "zone"  the large import zone: a raised icon tile, the line and a hint (Import employees)
//
// UploadFile shows a picked or uploaded file: its type, name, size, the upload's progress, an
// error, Remove (EmpClaims' receipt chip).
//
// The drop area is a real button: Tab reaches it, Enter or Space opens the file chooser, and
// screen readers hear the hint (type and size limits) and any error with it. Files are checked
// against `accept` and `maxSize` before they reach the page: a wrong type or a file that is too
// big shows a plain message here (role="alert") and goes to onReject; onFiles only ever gets
// good files. While `progress` is set the area shows how far the upload is and takes no new
// files. Dropping a file never makes the browser leave the page, even while the area is busy.
import { useId, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { useHoverFx } from '@/design/theme/motion'
import { ProgressBar } from './ProgressBar'
import { cx, renderIcon, type KitIcon } from './displayUtil'
import './display.css'
import './data.css'

// ── File checks (pure) ─────────────────────────────────────────────────────

/** The extension, lower case, without the dot ("Receipt.JPG" → "jpg"); '' when there is none. */
export function fileExtension(name: string | null | undefined): string {
  const n = String(name ?? '')
  const i = n.lastIndexOf('.')
  return i > 0 && i < n.length - 1 ? n.slice(i + 1).toLowerCase() : ''
}

/** A size as people read it: "900 bytes", "820 KB", "1.2 MB", "5 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  const b = Math.max(0, Number(bytes) || 0)
  if (b < 1024) return `${Math.round(b)} ${Math.round(b) === 1 ? 'byte' : 'bytes'}`
  const units = ['KB', 'MB', 'GB']
  let v = b / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  const shown = u === 0 ? Math.round(v) : Math.round(v * 10) / 10
  return `${shown % 1 === 0 ? shown.toFixed(0) : shown.toFixed(1)} ${units[u]}`
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'text/csv': 'csv', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt',
}
const ALIAS: Record<string, string> = { jpeg: 'jpg', jpe: 'jpg' }
const canon = (ext: string) => ALIAS[ext] ?? ext

/** The accept list as tokens (".pdf", "image/*", "application/pdf"), lower case. */
function acceptTokens(accept: string | undefined): string[] {
  return String(accept ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
}

/** Whether a file fits an `accept` list the way the file chooser reads it (extensions, types, "image/*"); jpg and jpeg are the same. */
export function acceptsFile(file: { name: string; type?: string }, accept?: string): boolean {
  const tokens = acceptTokens(accept)
  if (!tokens.length) return true
  const ext = canon(fileExtension(file.name))
  const type = String(file.type ?? '').toLowerCase()
  return tokens.some((t) => {
    if (t.startsWith('.')) return canon(t.slice(1)) === ext
    if (t.endsWith('/*')) return type ? type.startsWith(t.slice(0, -1)) : false
    if (type) return type === t || (!!MIME_EXT[t] && MIME_EXT[t] === MIME_EXT[type])
    // Some browsers leave the type empty: fall back to the extension the type stands for.
    return !!MIME_EXT[t] && canon(MIME_EXT[t]) === ext
  })
}

/** The accepted types in words: ".pdf,.jpg,.jpeg,.png" → "PDF, JPG or PNG"; "image/*" → "image". */
export function describeAccept(accept?: string): string {
  const names: string[] = []
  for (const t of acceptTokens(accept)) {
    let n: string
    if (t.startsWith('.')) n = canon(t.slice(1)).toUpperCase()
    else if (t.endsWith('/*')) n = t.slice(0, -2)
    else n = (MIME_EXT[t] ? canon(MIME_EXT[t]) : t.split('/').pop() || t).toUpperCase()
    if (n && !names.includes(n)) names.push(n)
  }
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

export type FileProblem = 'type' | 'size'

export interface FileRejection {
  file: File
  reason: FileProblem
  message: string
}

/** Checks one file; null when it's fine, else the reason and a plain sentence to show. */
export function checkFile(file: { name: string; size: number; type?: string }, rules: { accept?: string; maxSize?: number | null }): { reason: FileProblem; message: string } | null {
  if (!acceptsFile(file, rules.accept)) {
    const what = describeAccept(rules.accept)
    return { reason: 'type', message: what ? `${file.name} isn’t a ${what} file.` : `${file.name} can’t be added here.` }
  }
  const max = Number(rules.maxSize)
  if (Number.isFinite(max) && max > 0 && file.size > max) {
    return { reason: 'size', message: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(max)}.` }
  }
  return null
}

// ── Drop area ───────────────────────────────────────────────────────────────

export type UploadDropVariant = 'bar' | 'box' | 'zone'

export interface UploadDropProps {
  /** The files that passed the checks. */
  onFiles: (files: File[]) => void
  /** The files that didn't, with the reason (the message is also shown under the area). */
  onReject?: (rejections: FileRejection[]) => void
  /** What the chooser offers and the drop accepts: ".pdf,.jpg,.png", "image/*"… */
  accept?: string
  /** Largest file in bytes. */
  maxSize?: number
  /** Several files at once (default one: a drop of several takes the first). */
  multiple?: boolean
  variant?: UploadDropVariant
  /** The line on the area ("Add a receipt", "Add another document"). */
  title?: ReactNode
  /** The limits under it. Default: the types and size in words ("PDF, JPG or PNG · up to 5 MB"); false for none. */
  hint?: ReactNode | false
  /** Icon name or element (default the upload arrow). */
  icon?: KitIcon
  /** 0–100 while an upload runs: shows its progress and takes no new files. */
  progress?: number | null
  /** The words next to the progress (default "Uploading… 42%"). */
  busyLabel?: ReactNode
  /** The page's own error (the upload failed); shown under the area. */
  error?: ReactNode
  disabled?: boolean
  /** Accessible name when the title isn't plain text. */
  ariaLabel?: string
  /** Form name of the file input. */
  name?: string
  id?: string
  className?: string
  style?: CSSProperties
}

const TITLE: Record<UploadDropVariant, string> = {
  zone: 'Drag & drop your file here, or click to browse',
  box: 'Add a file',
  bar: 'Add a file',
}

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

export function UploadDrop({
  onFiles, onReject, accept, maxSize, multiple, variant = 'box', title, hint, icon = 'upload', progress, busyLabel, error, disabled,
  ariaLabel, name, id, className, style,
}: UploadDropProps) {
  const uid = useId()
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const fx = useHoverFx<HTMLButtonElement>('spot')
  const busy = progress != null && Number.isFinite(Number(progress))
  const off = !!disabled || busy
  const pct = busy ? Math.max(0, Math.min(100, Math.round(Number(progress)))) : 0

  const autoHint = [describeAccept(accept), maxSize ? `up to ${formatBytes(maxSize)}${multiple ? ' each' : ''}` : ''].filter(Boolean).join(' · ')
  const hintNode = hint === false ? null : hint ?? (autoHint || null)
  const pageError = error != null && error !== '' && error !== false
  const shownError: ReactNode = pageError ? error : problem
  const hasError = pageError || !!problem
  const titleId = `${uid}-title`, hintId = `${uid}-hint`, errId = `${uid}-err`
  const line = title ?? (variant === 'zone' && multiple ? 'Drag & drop your files here, or click to browse' : TITLE[variant])

  const take = (list: FileList | readonly File[] | null | undefined) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    const picked = multiple ? files : files.slice(0, 1)
    const good: File[] = []
    const bad: FileRejection[] = []
    for (const f of picked) {
      const p = checkFile(f, { accept, maxSize })
      if (p) bad.push({ file: f, ...p })
      else good.push(f)
    }
    setProblem(bad.length ? bad.map((b) => b.message).join(' ') : null)
    if (bad.length) onReject?.(bad)
    if (good.length) onFiles(good)
  }

  // Drag events sit on the wrapper, so a busy or disabled area still stops the browser from opening a dropped file.
  const drag = {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (off) return
      depth.current += 1
      setDragging(true)
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = off ? 'none' : 'copy'
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      if (!off) take(e.dataTransfer.files)
    },
  }

  const describedBy = cx(hintNode != null && hintId, hasError && errId) || undefined
  const iconNode = renderIcon(icon, variant === 'zone' ? 24 : variant === 'bar' ? 20 : 22)
  return (
    <div className={cx('uk-drop-wrap', className)} style={style} {...drag}>
      <button
        id={id}
        type="button"
        className={cx('uk-drop', `uk-drop--${variant}`, dragging && 'is-drag', busy && 'is-busy', variant === 'zone' && 'ufx-spot')}
        disabled={disabled}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-describedby={describedBy}
        onClick={() => { if (!off) input.current?.click() }}
        {...(variant === 'zone' ? fx : {})}
      >
        {variant === 'zone' && <span aria-hidden="true" className="uk-fx-spot" />}
        {variant === 'zone'
          ? <span className="uk-drop__tile" aria-hidden="true">{iconNode}</span>
          : <span className="uk-drop__icon" aria-hidden="true">{iconNode}</span>}
        {/* Named by this line; the limits and any error are its description (not read twice). */}
        <span id={titleId} className="uk-drop__title">{line}</span>
        {hintNode != null && <span id={hintId} className="uk-drop__hint">{hintNode}</span>}
      </button>
      <input ref={input} type="file" className="uk-drop__input" tabIndex={-1} aria-hidden="true" accept={accept} multiple={multiple}
        name={name} disabled={off} onChange={(e) => { take(e.target.files); e.target.value = '' }} />
      {busy && (
        <div className="uk-drop__busy">
          <ProgressBar value={pct} height={4} animate={false} label="Upload progress" valueText={`${pct}%`} />
          <span className="uk-drop__busytext" aria-hidden="true">{busyLabel ?? `Uploading… ${pct}%`}</span>
        </div>
      )}
      {hasError && (
        <div id={errId} className="uk-drop__error" role="alert">
          <span className="uk-drop__erricon" aria-hidden="true">{renderIcon('alert', 14)}</span>
          <span>{shownError}</span>
        </div>
      )}
    </div>
  )
}

// ── A picked or uploaded file ───────────────────────────────────────────────

export interface UploadFileProps {
  name: string
  /** Bytes. */
  size?: number | null
  /** Words after the size, facts only ("Uploaded 21 Sep"). */
  note?: ReactNode
  /** 0–100 while it uploads. */
  progress?: number | null
  /** Why the upload failed (replaces the size line). */
  error?: ReactNode
  onRemove?: () => void
  /** The Remove button's word (default "Remove"). */
  removeLabel?: string
  /** Shows "Try again" next to an error. */
  onRetry?: () => void
  /** Opens the file (a real link, new tab). */
  href?: string
  className?: string
  style?: CSSProperties
}

export function UploadFile({ name, size, note, progress, error, onRemove, removeLabel = 'Remove', onRetry, href, className, style }: UploadFileProps) {
  const ext = fileExtension(name)
  const busy = progress != null && Number.isFinite(Number(progress))
  const pct = busy ? Math.max(0, Math.min(100, Math.round(Number(progress)))) : 0
  const hasError = error != null && error !== '' && error !== false
  const meta = [size != null && Number.isFinite(Number(size)) ? formatBytes(size) : null, note].filter((x) => x != null && x !== '')
  return (
    <div className={cx('uk-file', hasError && 'is-error', className)} style={style}>
      <span className="uk-file__badge" aria-hidden="true">{(ext || 'file').slice(0, 4)}</span>
      <span className="uk-file__text">
        {href
          ? <a className="uk-file__name" href={href} target="_blank" rel="noopener noreferrer">{name}</a>
          : <span className="uk-file__name">{name}</span>}
        {hasError
          ? <span className="uk-file__error" role="alert">{error}</span>
          : busy
            ? <span className="uk-file__meta">Uploading… {pct}%</span>
            : meta.length > 0 && <span className="uk-file__meta">{meta.map((m, i) => <span key={i}>{i > 0 && ' · '}{m}</span>)}</span>}
        {busy && !hasError && <ProgressBar className="uk-file__bar" value={pct} height={4} animate={false} label={`Uploading ${name}`} valueText={`${pct}%`} />}
      </span>
      {hasError && onRetry && <button type="button" className="uk-file__act uk-file__act--plain" onClick={onRetry}>Try again</button>}
      {onRemove && (
        <button type="button" className="uk-file__act" aria-label={`${removeLabel} ${name}`} onClick={onRemove}>{removeLabel}</button>
      )}
    </div>
  )
}
