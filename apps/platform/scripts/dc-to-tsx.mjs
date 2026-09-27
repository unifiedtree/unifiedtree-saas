// Converts a Claude Design "dc" component template (the markup between
// <x-dc> and </x-dc>) into a TSX view that renders the same DOM with the same
// inline styles, so an implemented screen matches its design exactly.
//
//   node scripts/dc-to-tsx.mjs <Name> <template.html> <outDir>
//
// Output: <outDir>/<Name>.view.tsx and, when the template uses style-hover /
// style-focus / style-<pseudo>, <outDir>/<Name>.view.css.
//
// Folder mode, for the redesign handoff (a folder of raw .dc.html files):
//
//   node scripts/dc-to-tsx.mjs --folder <prototypeDir> <outDir> <Name> [Name ...]
//        [--runtime <import path>] [--keep-helmet-css]
//
// converts <prototypeDir>/<Name>.dc.html and every component it dc-imports into
// <X>.view.tsx (+ <X>.view.css) and a stand-in <X>.tsx that renders the view
// with its props as the view model, so the output compiles with tsc. It is a
// one-time scaffold to read exact markup from: pages are built on the kit
// (src/design/kit) and real hooks; the prototype's logic and sample data are
// never ported. The handoff writes HTML attribute case, so folder mode turns
// HTML names into React props (tabindex → tabIndex, stroke-width → strokeWidth),
// casts style literals that set CSS custom properties, keeps the last of a
// repeated style property, and renders custom elements such as <image-slot> by
// tag name; the per-file mode above keeps today's output for the old exports.
// Runtime helpers come from @/design/dc/dc-runtime unless --runtime says
// otherwise. The design pages' <helmet> styles (body, a, ::selection) are left
// out unless --keep-helmet-css. It refuses to overwrite a file it did not generate.
//
// A file whose first line starts with `// hand-owned` (`/* hand-owned` in CSS)
// is maintained by hand: it is never overwritten, and neither is the other file
// of its view pair (<Name>.view.tsx and <Name>.view.css share generated class
// names, so they are written together or not at all).
//
// Semantics mirror the dc runtime:
//   {{ path }}            → value lookup on the view model `v` (loop vars first)
//   <sc-if value>          → rendered when truthy
//   <sc-for list as>       → map over the list; `as` item and `$index` in scope
//   <x-import component-from-global-scope="UnifiedTree.X"> → <X/> from the app
//   <dc-import name="Y">   → <Y/> (another converted design component)
//   style-hover="css"      → generated class with `:hover` and !important decls
//   whitespace-only text   → dropped unless it contains a space (kept as " ")
/* global process, console */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ── hand-owned guard ────────────────────────────────────────────────────────
const HAND_OWNED = /^\s*(?:\/\/|\/\*)\s*hand-owned\b/
const firstLine = (file) => readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
const handOwned = (file) => existsSync(file) && HAND_OWNED.test(firstLine(file))

// ── tokenizer ───────────────────────────────────────────────────────────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
function parse(html) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  let i = 0
  const top = () => stack[stack.length - 1]
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const e = html.indexOf('-->', i)
      i = e < 0 ? html.length : e + 3
      continue
    }
    if (html[i] === '<' && html[i + 1] === '/') {
      const e = html.indexOf('>', i)
      const tag = html.slice(i + 2, e).trim()
      // pop to the matching open tag
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) { stack.length = k; break }
      }
      i = e + 1
      continue
    }
    if (html[i] === '<' && /[A-Za-z]/.test(html[i + 1] || '')) {
      let j = i + 1
      while (j < html.length && /[\w:-]/.test(html[j])) j++
      const tag = html.slice(i + 1, j)
      const attrs = []
      let selfClose = false
      while (j < html.length) {
        while (/\s/.test(html[j])) j++
        if (html[j] === '>') { j++; break }
        if (html[j] === '/' && html[j + 1] === '>') { selfClose = true; j += 2; break }
        let k = j
        while (k < html.length && !/[\s=>]/.test(html[k]) && !(html[k] === '/' && html[k + 1] === '>')) k++
        const an = html.slice(j, k)
        j = k
        while (/\s/.test(html[j])) j++
        let val = null
        if (html[j] === '=') {
          j++
          while (/\s/.test(html[j])) j++
          const q = html[j]
          if (q === '"' || q === "'") {
            const e = html.indexOf(q, j + 1)
            val = html.slice(j + 1, e)
            j = e + 1
          } else {
            let e = j
            while (e < html.length && !/[\s>]/.test(html[e])) e++
            val = html.slice(j, e)
            j = e
          }
        }
        if (an) attrs.push([an, val])
      }
      const node = { type: 'el', tag, attrs, children: [] }
      top().children.push(node)
      if (!selfClose && !VOID.has(tag.toLowerCase())) {
        if (tag === 'style' || tag === 'script') {
          const e = html.indexOf('</' + tag, j)
          node.children.push({ type: 'raw', text: html.slice(j, e) })
          i = html.indexOf('>', e) + 1
          continue
        }
        stack.push(node)
      }
      i = j
      continue
    }
    const e = html.indexOf('<', i + 1)
    const text = html.slice(i, e < 0 ? html.length : e)
    top().children.push({ type: 'text', text })
    i = e < 0 ? html.length : e
  }
  return root
}

// ── helpers ─────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→', larr: '←', hellip: '…', mdash: '—', ndash: '–', times: '×', check: '✓', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', deg: '°', rupee: '₹', minus: '−', uarr: '↑', darr: '↓' }
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    const r = ENT[e.toLowerCase()]
    if (r == null) { console.warn('unknown entity', m); return m }
    return r
  })
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const WHOLE = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/
const EVENT_MAP = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onkeypress: 'onKeyPress', onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave', onfocus: 'onFocus', onblur: 'onBlur', ondoubleclick: 'onDoubleClick', onmousemove: 'onMouseMove', onmouseover: 'onMouseOver', onmouseout: 'onMouseOut', onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointerenter: 'onPointerEnter', onpointerleave: 'onPointerLeave', onscroll: 'onScroll', onwheel: 'onWheel' }
// HTML attribute names whose React prop differs by more than hyphens (the new handoff writes HTML case).
const HTML2REACT = { tabindex: 'tabIndex', crossorigin: 'crossOrigin', readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength', autocomplete: 'autoComplete', autofocus: 'autoFocus', colspan: 'colSpan', rowspan: 'rowSpan', spellcheck: 'spellCheck', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint', contenteditable: 'contentEditable', datetime: 'dateTime', novalidate: 'noValidate', srcset: 'srcSet', accesskey: 'accessKey', autoplay: 'autoPlay', playsinline: 'playsInline', enctype: 'encType', formaction: 'formAction', usemap: 'useMap', referrerpolicy: 'referrerPolicy' }
const NUMERIC = new Set(['tabIndex', 'rows', 'cols', 'maxLength', 'minLength', 'colSpan', 'rowSpan', 'span', 'size', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-level', 'aria-setsize', 'aria-posinset', 'aria-rowcount', 'aria-colcount', 'aria-rowindex', 'aria-colindex'])
const DS_SOURCES = {
  HrButton: 'hr', HrStatusPill: 'hr', HrAvatar: 'hr', HrPageHeader: 'hr', HrDrawer: 'hr', HrSelect: 'hr', HrTabs: 'hr', TableCard: 'hr', HrStatCard: 'hr', FilterBar: 'hr', HrTabPanel: 'hr',
  DataTable: 'DataTable', EmptyState: 'EmptyState', SkeletonBlock: 'SkeletonCard', SkeletonCardGrid: 'SkeletonCard', SkeletonRow: 'SkeletonCard', HrPagination: 'HrPagination',
  Modal: 'ui-kit', Label: 'ui-kit', Badge: 'ui-kit', Button: 'ui-kit', Input: 'ui-kit', Field: 'ui-kit',
  UTPortal: 'runtime',
}

function cssToObj(css) {
  const o = []
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    const val = decode(decl.slice(i + 1).trim())
    if (!prop) continue
    o.push([prop.startsWith('--') ? prop : camel(prop), val])
  }
  return o
}
const jsStr = (s) => JSON.stringify(s)
// CSS lets a later declaration override an earlier one (`color:inherit;color:var(--u-ink2)`); an object
// literal can't repeat a key, so with the HTML fixes on the last one is kept, at its own position.
function lastWins(o) {
  const m = new Map()
  for (const [k, v] of o) { m.delete(k); m.set(k, v) }
  return [...m]
}
// With the HTML fixes on, a literal that sets CSS custom properties (the design's --k accents) is cast so it type-checks.
function styleLiteral(css) {
  const o = htmlFixes ? lastWins(cssToObj(css)) : cssToObj(css)
  const lit = '{' + o.map(([k, v]) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsStr(k)) + ': ' + jsStr(v)).join(', ') + '}'
  if (!htmlFixes || !o.some(([k]) => k.startsWith('--'))) return lit
  usesCssProps = true
  return '(' + lit + ' as CSSProperties)'
}

// ── per-conversion state (reset by convert) ─────────────────────────────────
let name = ''
let htmlFixes = false
let pseudo = new Map()
let pseudoN = 0
let used = new Set()
let usedDc = new Set()
let customTags = new Map()
let usesCss = false
let usesArr = false
let usesText = false
let usesHost = false
let usesCssProps = false

// pseudo-class rules → generated CSS
function pseudoClass(kind, css) {
  const key = kind + '|' + css
  if (pseudo.has(key)) return pseudo.get(key).cls
  const cls = `dc-${name.replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase())}-${(pseudoN++).toString(36)}`
  const isEl = kind === 'before' || kind === 'after'
  const body = cssToObj(css).map(([k, v]) => `${k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v}${isEl ? '' : ' !important'}`).join(';')
  pseudo.set(key, { cls, rule: `.${cls}${isEl ? '::' : ':'}${kind}{${body}}` })
  return cls
}

// ── expression resolution ──────────────────────────────────────────────────
function expr(path, scope) {
  const p = path.trim()
  if (p === 'true' || p === 'false' || p === 'null') return p
  if (/^-?\d+(\.\d+)?$/.test(p)) return p
  const [head, ...rest] = p.split('.')
  const base = scope.includes(head) ? safeId(head) : `v.${head}`
  return rest.length ? base + rest.map((r) => (/^\d+$/.test(r) ? `?.[${r}]` : `?.${r}`)).join('') : base
}
const safeId = (s) => (s === '$index' ? '$index' : /^(default|class|new|delete|in|for|if|do|var|let|const|function|return)$/.test(s) ? '_' + s : s)

// ── emit ────────────────────────────────────────────────────────────────────
function attrsFor(node, kind, scope) {
  const out = []
  const classes = []
  let hostStyle = null
  for (let [an, val] of node.attrs) {
    if (an.startsWith('hint-') || an === 'data-screen-label' || an === 'data-dc-tpl' || an === 'component-from-global-scope' || (kind === 'dc' && an === 'name')) continue
    if (an.startsWith('sc-camel-')) an = camel(an.slice('sc-camel-'.length))
    if (an.startsWith('style-')) {
      if (val && WHOLE.test(val)) { console.warn(`[${name}] dynamic ${an} not supported:`, val); continue }
      classes.push(pseudoClass(an.slice(6), val || ''))
      continue
    }
    let key = an
    if (kind === 'dom') {
      if (key === 'class') key = 'className'
      else if (key === 'for') key = 'htmlFor'
      else if (/^on[a-z]/.test(key)) key = EVENT_MAP[key.toLowerCase()] || 'on' + key[2].toUpperCase() + key.slice(3)
      else if (htmlFixes && HTML2REACT[key]) key = HTML2REACT[key]
      // stroke-width → strokeWidth; custom elements keep their attribute names.
      else if (htmlFixes && key.includes('-') && !key.startsWith('data-') && !key.startsWith('aria-') && !node.tag.includes('-')) key = camel(key)
    } else if (key.includes('-') && !(key.startsWith('aria-') || key.startsWith('data-'))) {
      key = camel(key)
    }
    if (key === 'dcProps') {
      const m = val && WHOLE.exec(val)
      if (m) out.push(`{...(${expr(m[1], scope)} || {})}`)
      continue
    }
    if (key === 'style' && kind !== 'dom') { hostStyle = val; continue }
    if (val == null) { out.push(key); continue }
    const m = WHOLE.exec(val)
    if (m) {
      const e = expr(m[1], scope)
      if (key === 'style') { usesCss = true; out.push(`style={css(${e})}`) } else out.push(`${key}={${e}}`)
      continue
    }
    if (val.includes('{{')) { console.warn(`[${name}] mixed interpolation in ${key}:`, val); }
    if (key === 'style') { out.push(`style={${styleLiteral(val)}}`); continue }
    if (key === 'className') { classes.unshift(val); continue }
    if (NUMERIC.has(key) && /^-?\d+$/.test(val)) { out.push(`${key}={${val}}`); continue }
    out.push(`${key}=${jsStr(decode(val))}`)
  }
  if (classes.length) out.push(`className=${jsStr(classes.join(' '))}`)
  return { props: out, hostStyle }
}

function hostWrap(hostStyle, inner, pad) {
  if (hostStyle == null) return inner
  const HOST = new Set(['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'zIndex', 'transform'])
  const kept = cssToObj(hostStyle).filter(([k]) => HOST.has(k))
  const st = kept.length ? '{' + kept.map(([k, v]) => `${k}: ${jsStr(v)}`).join(', ') + '}' : "{display: 'contents'}"
  return `${pad}<div className="sc-host-x" style={${st}}>\n${inner}\n${pad}</div>`
}

function emitChildren(children, scope, depth) {
  return children.map((c) => emit(c, scope, depth)).filter((s) => s != null && s !== '').join('\n')
}

function emit(node, scope, depth) {
  const pad = '  '.repeat(depth)
  if (node.type === 'text') {
    const raw = node.text
    if (!raw.includes('{{')) {
      if (!raw.trim()) return raw.includes(' ') ? `${pad}{" "}` : null
      const t = decode(raw).replace(/\s+/g, ' ')
      return `${pad}{${jsStr(t)}}`
    }
    const parts = raw.split(/\{\{([\s\S]+?)\}\}/g)
    const bits = []
    parts.forEach((p, i) => {
      if (i & 1) { usesText = true; bits.push(`{txt(${expr(p, scope)})}`) } else if (p) {
        const t = decode(p).replace(/\s+/g, ' ')
        if (t.trim() || t.includes(' ')) bits.push(`{${jsStr(t)}}`)
      }
    })
    return bits.length ? pad + bits.join('') : null
  }
  if (node.type === 'raw') return null
  const tag = node.tag
  if (tag === 'sc-if') {
    const val = (node.attrs.find(([k]) => k === 'value') || [])[1] || ''
    const m = WHOLE.exec(val)
    const cond = m ? expr(m[1], scope) : jsStr(val)
    const inner = emitChildren(node.children, scope, depth + 2)
    if (!inner) return null
    return `${pad}{${cond} ? (\n${pad}  <>\n${inner}\n${pad}  </>\n${pad}) : null}`
  }
  if (tag === 'sc-else') {
    console.warn(`[${name}] sc-else encountered — review output`)
  }
  if (tag === 'sc-for') {
    const listRaw = (node.attrs.find(([k]) => k === 'list') || [])[1] || ''
    const as = (node.attrs.find(([k]) => k === 'as') || [])[1] || 'item'
    const m = WHOLE.exec(listRaw)
    const list = m ? expr(m[1], scope) : '[]'
    usesArr = true
    const inner = emitChildren(node.children, [...scope, as, '$index'], depth + 2)
    return `${pad}{arr(${list}).map((${safeId(as)}: any, $index: number) => (\n${pad}  <Fragment key={$index}>\n${inner}\n${pad}  </Fragment>\n${pad}))}`
  }
  if (tag === 'x-import') {
    const g = (node.attrs.find(([k]) => k === 'component-from-global-scope') || [])[1] || ''
    const comp = g.split('.').pop()
    used.add(comp)
    const { props, hostStyle } = attrsFor(node, 'x', scope)
    const inner = emitChildren(node.children, scope, depth + 1)
    const open = `${pad}<${comp}${props.length ? ' ' + props.join(' ') : ''}`
    const el = inner ? `${open}>\n${inner}\n${pad}</${comp}>` : `${open} />`
    return hostWrap(hostStyle, el, pad)
  }
  if (tag === 'dc-import') {
    const comp = (node.attrs.find(([k]) => k === 'name') || [])[1]
    usedDc.add(comp)
    const { props, hostStyle } = attrsFor(node, 'dc', scope)
    // The runtime applies a dc-import's `style` (position props only) to the
    // child's own `div.sc-host`, not to an extra wrapper.
    if (hostStyle != null) {
      const HOST = new Set(['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'zIndex', 'transform'])
      const m = WHOLE.exec(hostStyle)
      if (m) { usesHost = true; props.push(`__hostStyle={hostPos(${expr(m[1], scope)})}`) } else {
        const kept = (htmlFixes ? lastWins(cssToObj(hostStyle)) : cssToObj(hostStyle)).filter(([k]) => HOST.has(k))
        if (kept.length) props.push(`__hostStyle={{${kept.map(([k, v]) => `${k}: ${jsStr(v)}`).join(', ')}}}`)
      }
    }
    const inner = emitChildren(node.children, scope, depth + 1)
    const open = `${pad}<${comp}${props.length ? ' ' + props.join(' ') : ''}`
    return inner ? `${open}>\n${inner}\n${pad}</${comp}>` : `${open} />`
  }
  if (tag === 'style' || tag === 'script' || tag === 'helmet' || tag === 'link') {
    if (tag === 'style') {
      const raw = (node.children[0] && node.children[0].text) || ''
      return `${pad}<style>{${jsStr(raw)}}</style>`
    }
    return null
  }
  const { props } = attrsFor(node, 'dom', scope)
  const inner = emitChildren(node.children, scope, depth + 1)
  // A custom element (<image-slot>) isn't a JSX intrinsic; it renders through a const holding its tag name.
  let el = tag
  if (htmlFixes && tag.includes('-')) {
    if (!customTags.has(tag)) customTags.set(tag, tag.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase()) + 'Element')
    el = customTags.get(tag)
  }
  const open = `${pad}<${el}${props.length ? ' ' + props.join(' ') : ''}`
  if (VOID.has(tag.toLowerCase()) || (!inner && !['textarea', 'select'].includes(tag))) return `${open} />`
  return `${open}>\n${inner}\n${pad}</${el}>`
}

/**
 * Converts one .dc.html file. Returns the view's TSX, its CSS (or null) and the
 * names of the design components it dc-imports.
 *   opts.htmlFixes   the source writes HTML attribute case (the redesign handoff): tabindex → tabIndex,
 *                    stroke-width → strokeWidth, custom-property style literals cast to CSSProperties,
 *                    the last of a repeated style property kept, custom elements rendered by tag name.
 *                    Off for the old exports, whose generated views must come out byte-identical.
 *   opts.helmetCss   keep <helmet> <style> blocks (default true: the old exports' keyframes live there)
 *   opts.runtime     import path of the runtime helpers (default './dc-runtime')
 *   opts.header      the two comment lines at the top of the view
 */
function convert(componentName, file, opts = {}) {
  name = componentName
  htmlFixes = !!opts.htmlFixes
  pseudo = new Map()
  pseudoN = 0
  used = new Set()
  usedDc = new Set()
  customTags = new Map()
  usesCss = usesArr = usesText = usesHost = usesCssProps = false

  const src = readFileSync(file, 'utf8')
  const a = src.indexOf('<x-dc>')
  const b = src.lastIndexOf('</x-dc>')
  if (a < 0 || b < 0) throw new Error('no <x-dc> block in ' + file)
  const xdc = src.slice(a + '<x-dc>'.length, b)
  // <helmet> only loads prototype scripts, except its <style> blocks (keyframes a
  // component animates with), which go into the component's .view.css.
  const helmetStyles = [...xdc.matchAll(/<helmet>([\s\S]*?)<\/helmet>/g)]
    .flatMap((m) => [...m[1].matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1].trim())).filter(Boolean)
  const helmetCss = opts.helmetCss === false ? [] : helmetStyles
  if (helmetStyles.length && !helmetCss.length) {
    console.warn(`[${name}] left out the page's <helmet> styles (${helmetStyles.map((s) => s.slice(0, 60)).join(' | ')}); --keep-helmet-css keeps them`)
  }
  const tpl = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/g, '')

  const tree = parse(tpl)
  const body = emitChildren(tree.children, [], 3)

  const imports = []
  if (usesArr && usesCssProps) imports.push("import { Fragment, type CSSProperties } from 'react'")
  else if (usesArr) imports.push("import { Fragment } from 'react'")
  else if (usesCssProps) imports.push("import type { CSSProperties } from 'react'")
  const byMod = {}
  for (const c of used) (byMod[DS_SOURCES[c] || 'unknown'] ||= []).push(c)
  if (byMod.hr) imports.push(`import { ${byMod.hr.sort().join(', ')} } from '@/shared/components/hr'`)
  if (byMod.DataTable) imports.push("import { DataTable } from '@/shared/components/DataTable'")
  if (byMod.EmptyState) imports.push("import { EmptyState } from '@/shared/components/EmptyState'")
  if (byMod.SkeletonCard) imports.push(`import { ${[...byMod.SkeletonCard].sort().join(', ')} } from '@/shared/components/SkeletonCard'`)
  if (byMod.HrPagination) imports.push("import { HrPagination } from '@/shared/components/HrPagination'")
  if (byMod['ui-kit']) imports.push(`import { ${byMod['ui-kit'].sort().join(', ')} } from '@unifiedtree/ui-kit'`)
  const rt = ['arr', 'css', 'txt', 'hostPos'].filter((f) => (f === 'arr' ? usesArr : f === 'css' ? usesCss : f === 'txt' ? usesText : usesHost))
  if (byMod.runtime) rt.push('UTPortal')
  if (rt.length) imports.push(`import { ${rt.join(', ')} } from '${opts.runtime || './dc-runtime'}'`)
  if (byMod.unknown) console.warn(`[${name}] unknown x-import components:`, byMod.unknown)
  for (const d of [...usedDc].sort()) imports.push(`import { ${d} } from './${d}'`)
  const css = pseudo.size || helmetCss.length ? [...helmetCss, ...[...pseudo.values()].map((p) => p.rule)].join('\n') + '\n' : null
  if (css) imports.push(`import './${name}.view.css'`)
  const elements = [...customTags].map(([tag, id]) => `const ${id}: any = '${tag}'\n`).join('')

  const header = opts.header || `// GENERATED by scripts/dc-to-tsx.mjs from the Claude Design component ${name}.dc.html.
// Do not edit by hand — change the design (or the view model) and regenerate.`
  const tsx = `${header}
${imports.join('\n')}
${elements ? '\n' + elements : ''}
export function ${name}View({ v }: { v: any }) {
  return (
    <>
${body}
    </>
  )
}
`
  const summary = `${name}: ${tsx.split('\n').length} lines, ${used.size} DS components, ${usedDc.size} sub-components, ${pseudo.size} pseudo rules`
  return { tsx, css, deps: [...usedDc], summary }
}

// ── folder mode ─────────────────────────────────────────────────────────────
const SCAFFOLD = 'SCAFFOLD generated by scripts/dc-to-tsx.mjs --folder'
function folderMode(args) {
  const flags = { runtime: '@/design/dc/dc-runtime', keepHelmet: false }
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runtime') flags.runtime = args[++i]
    else if (args[i] === '--keep-helmet-css') flags.keepHelmet = true
    else rest.push(args[i])
  }
  const [dir, outDir, ...names] = rest
  if (!dir || !outDir || !names.length || !flags.runtime) {
    console.error('usage: dc-to-tsx.mjs --folder <prototypeDir> <outDir> <Name> [Name ...] [--runtime <import path>] [--keep-helmet-css]')
    process.exit(2)
  }
  // Convert the named components and everything they dc-import, each once.
  const done = new Map()
  const queue = names.map((n) => n.replace(/\.dc\.html$/, ''))
  while (queue.length) {
    const n = queue.shift()
    if (done.has(n)) continue
    const file = join(dir, `${n}.dc.html`)
    if (!existsSync(file)) throw new Error(`${n}.dc.html is not in ${dir}` + (done.size ? ' (it is dc-imported by a converted component)' : ''))
    const r = convert(n, file, {
      htmlFixes: true,
      helmetCss: flags.keepHelmet,
      runtime: flags.runtime,
      header: `// ${SCAFFOLD} from the design handoff's ${n}.dc.html.\n// A one-time starting point to read exact markup from; build the page on the kit and real hooks.`,
    })
    done.set(n, r)
    queue.push(...r.deps)
  }
  // Every file to write, checked before anything is written.
  const plan = []
  for (const [n, r] of done) {
    const files = [[`${n}.view.tsx`, r.tsx], [`${n}.tsx`, standIn(n)]]
    if (r.css) files.push([`${n}.view.css`, `/* ${SCAFFOLD} from ${n}.dc.html. */\n` + r.css])
    plan.push({ n, r, files })
  }
  const refused = []
  const skipped = []
  for (const p of plan) {
    const paths = [`${p.n}.view.tsx`, `${p.n}.view.css`, `${p.n}.tsx`].map((f) => join(outDir, f))
    if (paths.some(handOwned)) { p.skip = true; skipped.push(p.n); continue }
    for (const [f] of p.files) {
      const target = join(outDir, f)
      if (existsSync(target) && !firstLine(target).includes(SCAFFOLD)) refused.push(target)
    }
  }
  if (refused.length) {
    console.error(`dc-to-tsx --folder: these files exist and were not generated by it; nothing was written:\n  ${refused.join('\n  ')}\nPick an empty folder.`)
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  for (const p of plan) {
    if (p.skip) continue
    for (const [f, text] of p.files) writeFileSync(join(outDir, f), text)
    console.log(p.r.summary)
  }
  for (const n of skipped) console.warn(`[${n}] skipped: a file of it in ${outDir} is marked hand-owned`)
  console.log(`${plan.length - skipped.length} component(s) written to ${outDir}${skipped.length ? `, ${skipped.length} skipped` : ''}`)
}

/** Stand-in for a converted design component: renders its view with the props as the view model. */
function standIn(n) {
  return `// ${SCAFFOLD} from the design handoff's ${n}.dc.html.
// Stand-in for the design component: renders ${n}.view.tsx with its props as the view model (no prototype logic).
import type { CSSProperties } from 'react'
import { ${n}View } from './${n}.view'

export function ${n}({ __hostStyle, ...v }: { __hostStyle?: CSSProperties; [prop: string]: unknown }) {
  return (
    <div className="sc-host" data-sc-name="${n}" style={__hostStyle}>
      <${n}View v={v} />
    </div>
  )
}
`
}

// ── cli ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
if (argv[0] === '--folder') {
  folderMode(argv.slice(1))
} else {
  const [componentName, file, outDir] = argv
  if (!componentName || !file || !outDir) {
    console.error('usage: dc-to-tsx.mjs <Name> <template.html> <outDir>\n       dc-to-tsx.mjs --folder <prototypeDir> <outDir> <Name> [Name ...] [--runtime <import path>] [--keep-helmet-css]')
    process.exit(2)
  }
  const viewFile = join(outDir, `${componentName}.view.tsx`)
  const cssFile = join(outDir, `${componentName}.view.css`)
  const marked = [viewFile, cssFile].filter(handOwned)
  if (marked.length) {
    console.warn(`[${componentName}] skipped: ${marked.join(', ')} ${marked.length > 1 ? 'are' : 'is'} marked hand-owned, so ${componentName}.view.tsx and .view.css are left as they are`)
  } else {
    const r = convert(componentName, file)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(viewFile, r.tsx)
    if (r.css) writeFileSync(cssFile, r.css)
    console.log(r.summary)
  }
}
