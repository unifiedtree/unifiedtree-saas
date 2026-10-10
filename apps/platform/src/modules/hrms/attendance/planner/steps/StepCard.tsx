// One step of the planner's left column: an accordion card (one open at a time; a closed step shows a one-line
// summary of what was chosen).
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function StepCard({ index, title, summary, open, onOpen, done, children }: {
  index: number
  title: string
  summary?: ReactNode
  open: boolean
  onOpen: () => void
  /** Something is chosen in this step (the number turns into a tick). */
  done?: boolean
  children: ReactNode
}) {
  const id = `spl-step-${index}`
  return (
    <section className="spl-step" data-open={open ? '' : undefined} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="spl-step__h">
        <button type="button" className="spl-step__head" aria-expanded={open} aria-controls={id} onClick={onOpen}>
          <span className="spl-step__no" data-done={done ? '' : undefined}>{index}</span>
          <span className="spl-step__text">
            <span className="spl-step__title">{title}</span>
            {!open && summary != null && summary !== '' && <span className="spl-step__sum">{summary}</span>}
          </span>
          <ChevronDown className="spl-step__chev" size={16} aria-hidden="true" />
        </button>
      </h3>
      <div id={id} className="spl-step__body" hidden={!open}>{open ? children : null}</div>
    </section>
  )
}
