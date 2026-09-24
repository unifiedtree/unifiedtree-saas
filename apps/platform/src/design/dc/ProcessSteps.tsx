// Four-step tracker (Draft · Processed · Locked · Paid) — ported from the design
// component ProcessSteps.dc.html.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { ProcessStepsView } from './ProcessSteps.view'
import { dashIcon } from './icons'

export interface ProcessStep { key?: string; label: string; meta?: string }

export class ProcessSteps extends DCLogic<{ steps: ProcessStep[]; current?: number; complete?: boolean; busy?: boolean; label?: string }> {
  renderVals() {
    const p = this.props, steps = p.steps || []
    const n = steps.length, cur = Math.max(0, Math.min(n - 1, Number(p.current ?? 1))), complete = !!p.complete, busy = !!p.busy && !complete
    const ON = '#0f6e56', OFF = '#e2e8f0'
    const items = steps.map((s, i) => {
      const done = complete ? i < n - 1 : i < cur, isFinal = complete && i === n - 1, isCur = !complete && i === cur
      const reached = done || isFinal || isCur
      return {
        key: s.key || String(i), label: s.label, meta: s.meta || '', hasMeta: !!s.meta, num: i + 1,
        isDone: done, isFinal, isCur: isCur && !busy, isBusy: isCur && busy, isTodo: !reached,
        labelStrong: isCur || isFinal, labelDone: done, labelTodo: !reached,
        ariaCurrent: isCur || isFinal ? 'step' : undefined,
        lineL: i === 0 ? 'transparent' : reached ? ON : OFF,
        lineR: i === n - 1 ? 'transparent' : done ? ON : OFF,
      }
    })
    const spin = createElement('span', { 'aria-label': 'In progress', style: { width: 14, height: 14, boxSizing: 'border-box', borderRadius: '50%', border: '2px solid #a7f3d0', borderTopColor: '#0f6e56', display: 'inline-block', animation: 'ut-spin .8s linear infinite' } })
    return { items, label: p.label || 'Progress', icCheck: dashIcon('check', 16), spin }
  }
  render() { return dc(this, ProcessStepsView, 'ProcessSteps') }
}
