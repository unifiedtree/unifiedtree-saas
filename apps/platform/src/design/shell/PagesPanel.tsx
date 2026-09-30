// The Pages panel (HrmsPlatform.dc.html, 248px right of the rail): the open module's pages, the lit one
// marked, each with how many tabs it has. It replaces the old "<Module> sections" row. On a phone it
// opens over the page from the top bar's Pages button.
import { useRef, type MouseEvent } from 'react'
import { useEscape, useFocusTrap, useLayer } from '@/design/kit/overlayCore'
import { ShellIcon } from './shellIcons'

export interface PagesPanelPage {
  label: string
  href: string
  active: boolean
  /** How many tabs the page has for this person (0 = none shown). */
  tabs: number
}

export interface PagesPanelProps {
  module: { label: string; icon: string }
  pages: PagesPanelPage[]
  onSelect: (href: string) => void
  onHide: () => void
  onIntent?: (href: string) => void
  /** A phone: the panel opens over the page (backdrop, focus kept inside, Escape closes). */
  overlay?: boolean
}

function inApp(e: MouseEvent, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go()
}

function PanelBody({ module, pages, onSelect, onHide, onIntent }: PagesPanelProps) {
  const count = pages.length
  return (
    <>
      <div className="ut-pages__head">
        <span className="ut-pages__icon" aria-hidden="true"><ShellIcon name={module.icon} size={18} /></span>
        <div className="ut-pages__title">
          <div className="ut-pages__name">{module.label}</div>
          <div className="ut-pages__count">{count} {count === 1 ? 'page' : 'pages'}</div>
        </div>
        <button type="button" className="ut-pages__hide" onClick={onHide} aria-label="Hide pages" title="Hide pages">
          <ShellIcon name="panelClose" size={17} />
        </button>
      </div>
      <nav aria-label={`${module.label} pages`} className="ut-pages__list">
        {pages.map((p) => (
          <a key={p.href} href={p.href} className="ut-pages__row" data-active={p.active ? '' : undefined} aria-current={p.active ? 'page' : undefined}
            onClick={(e) => inApp(e, () => onSelect(p.href))}
            onMouseEnter={onIntent ? () => onIntent(p.href) : undefined} onFocus={onIntent ? () => onIntent(p.href) : undefined}>
            {p.active && <span className="ut-pages__bar" aria-hidden="true" />}
            <span className="ut-pages__label">{p.label}</span>
            {p.tabs > 0 && <span className="ut-pages__tabs" aria-hidden="true" title={`${p.tabs} ${p.tabs === 1 ? 'tab' : 'tabs'}`}>{p.tabs}</span>}
          </a>
        ))}
      </nav>
    </>
  )
}

function OverlayPanel(props: PagesPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isTop = useLayer(true)
  useEscape(true, isTop, props.onHide)
  useFocusTrap(ref, true, isTop, 'first')
  return (
    <div className="ut-pages-layer">
      <div className="ut-backdrop ut-backdrop--left" aria-hidden="true" onClick={props.onHide} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={`${props.module.label} pages`} tabIndex={-1} className="ut-pages ut-pages--overlay">
        <PanelBody {...props} />
      </div>
    </div>
  )
}

export function PagesPanel(props: PagesPanelProps) {
  if (props.overlay) return <OverlayPanel {...props} />
  return <div className="ut-pages"><PanelBody {...props} /></div>
}
