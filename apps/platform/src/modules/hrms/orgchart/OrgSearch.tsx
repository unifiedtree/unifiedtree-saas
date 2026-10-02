// "Search employee" (Keka): type a name, designation or department and pick a
// person; the chart opens the people above them and moves to their card.
// A combobox: arrows move through the matches, Enter picks, Escape closes.
import { useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { Avatar } from '@/design/kit/display'
import { Popover } from '@/design/kit/overlays'
import { searchPeople, type OrgTree } from './orgTree'
import type { OrgPerson } from './useOrgChart'

interface OrgSearchProps {
  tree: OrgTree
  onPick: (person: OrgPerson) => void
}

export function OrgSearch({ tree, onPick }: OrgSearchProps) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const matches = useMemo(() => searchPeople(tree, q, 8), [tree, q])
  const shown = open && q.trim().length > 0

  const pick = (p: OrgPerson | undefined) => {
    if (!p) return
    setOpen(false)
    setQ(p.name)
    onPick(p)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(matches.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { if (shown) { e.preventDefault(); pick(matches[active] ?? matches[0]) } }
    else if (e.key === 'Escape') { if (shown) { e.preventDefault(); e.stopPropagation(); setOpen(false) } }
  }

  const optionId = (i: number) => `${listId}-o${i}`
  return (
    <div ref={boxRef} className="uoc-search" data-no-pan="">
      <span className="uoc-search__ic" aria-hidden="true"><Search size={16} strokeWidth={2} /></span>
      <input
        ref={inputRef}
        className="uoc-search__in"
        type="text"
        enterKeyHint="search"
        role="combobox"
        aria-label="Search employee"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && matches.length ? optionId(Math.min(active, matches.length - 1)) : undefined}
        placeholder="Search employee"
        autoComplete="off"
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => { if (q.trim()) setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      {q && (
        <button type="button" className="uoc-search__clear" aria-label="Clear search"
          onClick={() => { setQ(''); setOpen(false); inputRef.current?.focus() }}>
          <X size={14} strokeWidth={2.2} />
        </button>
      )}
      <Popover open={shown} onClose={() => setOpen(false)} anchorRef={boxRef} placement="bottom-start" width="anchor" maxHeight={380}
        role="listbox" aria-label="People found" id={listId} initialFocus="none" returnFocus={false}>
        {matches.length === 0
          ? <div className="uoc-noresult" role="option" aria-selected={false} aria-disabled="true">Nobody on this chart matches “{q.trim()}”.</div>
          : (
            <div className="uoc-results">
              {matches.map((p, i) => (
                <div key={p.id} id={optionId(i)} role="option" aria-selected={i === active}
                  className={`uoc-result${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}>
                  <Avatar name={p.name} src={p.photoUrl} size={32} tone={p.id === tree.you ? 'solid' : 'soft'} />
                  <span className="uoc-result__txt">
                    <span className="uoc-result__name">{p.name}{p.id === tree.you ? ' (you)' : ''}</span>
                    {(p.designation || p.department) && <span className="uoc-result__sub">{[p.designation, p.department].filter(Boolean).join(' · ')}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
      </Popover>
    </div>
  )
}
