// hand-owned: edited by hand; scripts/design-build.mjs skips this view.
// Rebuilt by hand on the redesign kit (F2d).
//
// The design's inline view pills (kit FilterPills look: 36px outlined pills, the
// chosen one solid brand green), with this bar's own semantics kept exactly:
// role="group" + aria-label and aria-pressed buttons, a count after the label
// (a gold badge when it's urgent), and the data-tip tooltip.
import { arr, txt } from './dc-runtime'
import '@/design/kit/display.css'
import './SubTabs.view.css'

export function SubTabsView({ v }: { v: any }) {
  return (
    <div role="group" aria-label={v.label} className="uk-fpills dcsub">
      {arr(v.items).map((it: any, i: number) => (
        <button
          key={it?.key ?? i}
          type="button"
          aria-pressed={it?.active ? 'true' : 'false'}
          onClick={it?.onClick}
          data-tip={it?.tip || undefined}
          className={it?.active ? 'uk-fpill is-on' : 'uk-fpill'}
        >
          <span>{txt(it?.label)}</span>
          {it?.hasCount ? (
            <span className={it?.urgentCount && !it?.active ? 'uk-fpill__n dcsub-n is-urgent' : 'uk-fpill__n dcsub-n'}>{txt(it?.count)}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
