// Runtime for views generated from Claude Design "dc" components
// (scripts/dc-to-tsx.mjs). It reproduces the prototype runtime's rendering
// rules so an implemented screen lays out exactly like its design:
//   • every design component renders inside a `div.sc-host`
//   • interpolated text renders inside `span.sc-interp`
//   • `{{ list }}` loops tolerate non-arrays; `style="{{ x }}"` accepts a css string
import { Component, isValidElement, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const arr = (x: unknown): any[] => (Array.isArray(x) ? x : [])

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
export function css(x: unknown): CSSProperties | undefined {
  if (x == null || x === false) return undefined
  if (typeof x === 'object') return x as CSSProperties
  const o: Record<string, string> = {}
  for (const decl of String(x).split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    if (prop) o[prop.startsWith('--') ? prop : camel(prop)] = decl.slice(i + 1).trim()
  }
  return o as CSSProperties
}

const HOST_PROPS = new Set(['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'zIndex', 'transform'])
/** Position-only subset of a style, applied to a child design component's host div. */
export function hostPos(x: unknown): CSSProperties | undefined {
  const all = css(x) as Record<string, unknown> | undefined
  if (!all) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(all)) if (HOST_PROPS.has(k)) out[k] = v
  return Object.keys(out).length ? (out as CSSProperties) : undefined
}

export function txt(x: unknown): ReactNode {
  if (x == null || typeof x === 'boolean') return null
  if (isValidElement(x) || Array.isArray(x)) return x as ReactNode
  return <span className="sc-interp">{String(x)}</span>
}

export function UTPortal({ children }: { children?: ReactNode }) {
  if (typeof document === 'undefined' || !document.body) return <>{children}</>
  return createPortal(children, document.body)
}

/**
 * Base class for ported design logic. Subclasses keep the prototype's
 * `state`, lifecycle methods and `renderVals()` and render their generated
 * view through `dc()`. The view sees `{ ...props, ...renderVals() }`, exactly
 * like the prototype runtime.
 */
export abstract class DCLogic<P = any, S = any> extends Component<P & { __hostStyle?: CSSProperties }, S> {
  abstract renderVals(): Record<string, any>
}

export function dc(self: DCLogic<any, any>, View: ComponentType<{ v: any }>, name: string) {
  const { __hostStyle, ...props } = self.props as any
  const v = { ...props, ...(self.renderVals() || {}) }
  return (
    <div className="sc-host" data-sc-name={name} style={__hostStyle}>
      <View v={v} />
    </div>
  )
}
