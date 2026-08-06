import { useMemo, useRef, useState, useEffect } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { DIAL_CODES, DEFAULT_DIAL_CODE, findDialByCode, type DialCode } from '../../data/dialCodes'

interface Props {
  /** Full E.164 value, e.g. "+919876543210". Emits the same shape on change. */
  value: string
  onChange: (fullValue: string) => void
  error?: string
  /** Called with just the ISO code when the user picks a new country — lets
   *  the parent form update its `country` field to stay in sync. Optional. */
  onCountryChange?: (isoCode: string) => void
  className?: string
}

/**
 * Country dial-code dropdown + local-digits input.
 *
 * Emits the full E.164 string ("+" + dial + local digits) via onChange so the
 * parent can register a single string field. The dropdown starts on India by
 * default; if the incoming `value` begins with a recognisable "+<dial>" we
 * pick that country instead. Local input strips anything that isn't a digit
 * on the fly, keeping the value clean before it reaches zod / the server.
 */
export function PhoneField({ value, onChange, error, onCountryChange, className }: Props) {
  const initial = useMemo(() => parseE164(value), [])
  const [selected, setSelected] = useState<DialCode>(initial.dial ?? DEFAULT_DIAL_CODE)
  const [local, setLocal] = useState<string>(initial.local)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Bubble the composite value up on every edit.
  useEffect(() => {
    const digits = local.replace(/\D/g, '')
    const composed = digits ? `+${selected.dial}${digits}` : ''
    if (composed !== value) onChange(composed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, local])

  // Close the country dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return DIAL_CODES
    const q = query.trim().toLowerCase()
    return DIAL_CODES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase() === q
    )
  }, [query])

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <div
        className={`flex items-stretch rounded-xl border bg-white overflow-hidden transition-all ${
          error ? 'border-danger ring-2 ring-danger/10' : 'border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-3 border-r border-border bg-bg text-sm font-body font-medium text-text-primary hover:bg-primary-light/50 transition-colors"
          aria-label="Country calling code"
        >
          <span className="text-lg leading-none">{selected.flag}</span>
          <span className="tabular-nums text-text-secondary">+{selected.dial}</span>
          <ChevronDown size={14} className={`text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={local}
          onChange={(e) => setLocal(e.target.value.replace(/\D/g, ''))}
          placeholder="9876543210"
          className="flex-1 min-w-0 py-3 px-3 text-sm font-body text-text-primary placeholder:text-text-tertiary bg-transparent outline-none"
        />
      </div>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full min-w-[280px] max-h-72 overflow-hidden rounded-xl border border-border bg-white shadow-xl flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={14} className="text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code"
              className="flex-1 text-sm font-body outline-none bg-transparent"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-text-secondary">No matches</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    setSelected(c)
                    setOpen(false)
                    setQuery('')
                    onCountryChange?.(c.code)
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-primary-light/50 ${
                    c.code === selected.code ? 'bg-primary-light/30 font-semibold' : ''
                  }`}
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className="flex-1 text-text-primary truncate">{c.name}</span>
                  <span className="tabular-nums text-text-tertiary">+{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// -- helpers ---------------------------------------------------------------

function parseE164(v: string | undefined | null): { dial: DialCode | null; local: string } {
  if (!v) return { dial: null, local: '' }
  const m = v.match(/^\+?(\d+)$/)
  if (!m) return { dial: null, local: v.replace(/\D/g, '') }
  const digits = m[1]
  // Try longest-prefix match on our dial-code table (e.g. '971' should win over '9').
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const prefix = digits.slice(0, len)
    const hit = DIAL_CODES.find((c) => c.dial === prefix)
    if (hit) return { dial: hit, local: digits.slice(len) }
  }
  return { dial: null, local: digits }
}

// Re-export for consumers that need to introspect the value before sending it up.
export { findDialByCode }
