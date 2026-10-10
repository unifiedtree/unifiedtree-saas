// The rotation pattern builder (design §1.6 step 3; also the patterns drawer): a row of day chips (Day 1…N), each a
// small select of the shifts' codes and WO; add a day, remove one, move one left or right; "Repeat cycle"; and a strip
// showing two cycles. "2+2+2+1" is just one pattern the planner can build (A A B B C C WO).
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { Toggle } from '@/design/kit/overlays'
import { WO_TOKEN, type PatternDay, type WeeklyOffMode } from '../../api/rosterTypes'
import { MAX_PATTERN_DAYS, patternDay, patternNote, patternStrip, patternToken, tokenCode, type ShiftLite } from './plannerModel'

export function PatternBuilder({ days, repeats, shifts, onChange, weeklyOffMode, readOnly, label = 'Rotation pattern' }: {
  days: readonly PatternDay[]
  repeats: boolean
  /** The shifts a day can be (the ticked ones; a shift the pattern already uses is always offered). */
  shifts: readonly ShiftLite[]
  onChange: (days: PatternDay[], repeats: boolean) => void
  /** With Fixed or Custom weekly offs the builder says what happens to the pattern's WO days. */
  weeklyOffMode?: WeeklyOffMode
  readOnly?: boolean
  label?: string
}) {
  const map = new Map(shifts.map((s) => [s.id, s]))
  const set = (i: number, token: string) => onChange(days.map((d, j) => (j === i ? patternDay(token) : d)), repeats)
  const remove = (i: number) => onChange(days.filter((_, j) => j !== i), repeats)
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= days.length) return
    const next = [...days]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next, repeats)
  }
  const add = () => {
    if (days.length >= MAX_PATTERN_DAYS) return
    // A new day repeats the last one; the first is the first shift (or WO when there is none).
    const last = days[days.length - 1]
    onChange([...days, last ? { ...last } : patternDay(shifts[0]?.id ?? WO_TOKEN)], repeats)
  }
  const note = weeklyOffMode ? patternNote(days, weeklyOffMode) : null
  const strip = patternStrip(days, repeats)

  return (
    <div className="spl-pattern" role="group" aria-label={label}>
      <ol className="spl-pattern__days">
        {days.map((d, i) => {
          const token = patternToken(d)
          const sh = token && token !== WO_TOKEN ? map.get(token) : undefined
          const options = [...shifts]
          if (token && token !== WO_TOKEN && !sh) options.push({ id: token, code: '?', name: 'A shift that is no longer active', tone: '1' } as ShiftLite)
          return (
            <li key={i} className="spl-pattern__day">
              <span className="spl-pattern__no">Day {i + 1}</span>
              <span className="spl-pattern__chip" data-tone={token === WO_TOKEN ? 'wo' : sh?.tone ?? '1'}>
                <select aria-label={`Day ${i + 1}`} value={token ?? WO_TOKEN} disabled={readOnly} onChange={(e) => set(i, e.target.value)}>
                  {options.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` · ${s.name}` : ''}</option>)}
                  <option value={WO_TOKEN}>WO · Weekly off</option>
                </select>
              </span>
              {!readOnly && (
                <span className="spl-pattern__tools">
                  <button type="button" aria-label={`Move day ${i + 1} left`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronLeft size={13} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Remove day ${i + 1}`} disabled={days.length <= 1} onClick={() => remove(i)}><X size={13} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Move day ${i + 1} right`} disabled={i === days.length - 1} onClick={() => move(i, 1)}><ChevronRight size={13} aria-hidden="true" /></button>
                </span>
              )}
            </li>
          )
        })}
        {!readOnly && (
          <li>
            <button type="button" className="spl-pattern__add" onClick={add} disabled={days.length >= MAX_PATTERN_DAYS}>
              <Plus size={14} aria-hidden="true" /> Add day
            </button>
          </li>
        )}
      </ol>
      <Toggle size="md" checked={repeats} disabled={readOnly} onChange={(on) => onChange([...days], on)} label="Repeat cycle"
        description={repeats ? `After day ${days.length || 1} it starts again from day 1.` : `Days after day ${days.length || 1} are left empty.`} />
      {days.length > 0 && (
        <div className="spl-pattern__strip" aria-label="Pattern preview">
          {strip.map((d, i) => {
            const t = patternToken(d)
            return <span key={i} className="spl-code" data-tone={t === WO_TOKEN ? 'wo' : map.get(t ?? '')?.tone ?? '1'} data-cycle={i >= days.length ? '2' : '1'}>{tokenCode(t, map) ?? '?'}</span>
          })}
          {repeats && <span className="spl-pattern__more" aria-hidden="true">…</span>}
        </div>
      )}
      {note && <p className="spl-note" data-tone="amber">{note}</p>}
    </div>
  )
}
