// hand-owned: edited by hand; scripts/design-build.mjs skips this view.
// Rebuilt by hand on the redesign tokens (F2d).
//
// The TimePicker's view: the design's 42px field trigger and a popover (12px
// corners, hairline, the popover shadow) with hour, minute and AM/PM lists,
// quick times and Done. Same markup semantics as before: the trigger keeps focus
// (aria-haspopup="dialog"), the popover is role="dialog" named by the field, the
// lists are role="listbox" with role="option" buttons. Tokens only (TimePicker.view.css).
import { Fragment } from 'react'
import { arr, txt, UTPortal } from './dc-runtime'
import './TimePicker.view.css'

export function TimePickerView({ v }: { v: any }) {
  return (
    <div ref={v.rootRef} className="dctp">
      <button ref={v.triggerRef} type="button" onClick={v.toggle} onKeyDown={v.triggerKey} aria-haspopup="dialog" aria-expanded={v.open} aria-label={v.triggerAria}
        className="dctp-trigger" data-open={v.open ? '' : undefined}>
        <span aria-hidden="true" className="dctp-clock">{txt(v.icClock)}</span>
        {v.hasValue ? <span className="dctp-value">{txt(v.display)}</span> : null}
        {v.noValue ? <span className="dctp-value dctp-ph">{txt(v.placeholder)}</span> : null}
        <span aria-hidden="true" className="dctp-chev">{txt(v.icChev)}</span>
      </button>
      {v.open ? (
        <UTPortal>
          <div ref={v.setPop} role="dialog" aria-label={v.heading} onMouseDown={v.keepFocus} className="dctp-pop">
            <div className="dctp-head">
              <span className="dctp-eyebrow">{txt(v.heading)}</span>
              <strong className="dctp-big">{txt(v.big)}</strong>
            </div>
            <div className="dctp-cols">
              <div ref={v.hRef} role="listbox" aria-label="Hour" className="dctp-list">
                {arr(v.hours).map((o: any, $index: number) => (
                  <Fragment key={$index}>
                    <button type="button" tabIndex={-1} role="option" aria-selected={o?.sel ? 'true' : 'false'} data-sel={o?.sel ? '1' : undefined} onClick={o?.onClick} className="dctp-opt">
                      {txt(o?.label)}
                    </button>
                  </Fragment>
                ))}
              </div>
              <div ref={v.mRef} role="listbox" aria-label="Minute" className="dctp-list">
                {arr(v.minutes).map((o: any, $index: number) => (
                  <Fragment key={$index}>
                    <button type="button" tabIndex={-1} role="option" aria-selected={o?.sel ? 'true' : 'false'} data-sel={o?.sel ? '1' : undefined} onClick={o?.onClick} className="dctp-opt">
                      {txt(o?.label)}
                    </button>
                  </Fragment>
                ))}
              </div>
              <div role="listbox" aria-label="AM or PM" className="dctp-ampm">
                {arr(v.periods).map((o: any, $index: number) => (
                  <Fragment key={$index}>
                    <button type="button" tabIndex={-1} role="option" aria-selected={o?.sel ? 'true' : 'false'} onClick={o?.onClick} className="dctp-period">
                      {txt(o?.label)}
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
            <div className="dctp-foot">
              {arr(v.presets).map((pr: any, $index: number) => (
                <Fragment key={$index}>
                  <button type="button" tabIndex={-1} onClick={pr?.onClick} className="dctp-preset" data-on={pr?.active ? '' : undefined}>
                    {txt(pr?.label)}
                  </button>
                </Fragment>
              ))}
              <button type="button" tabIndex={-1} onClick={v.done} className="dctp-done">
                {'Done'}
              </button>
            </div>
          </div>
        </UTPortal>
      ) : null}
    </div>
  )
}
