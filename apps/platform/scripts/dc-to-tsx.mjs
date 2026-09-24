// Converts a Claude Design "dc" component template (the markup between
// <x-dc> and </x-dc>) into a TSX view that renders the same DOM with the same
// inline styles, so an implemented screen matches its design exactly.
//
//   node scripts/dc-to-tsx.mjs <Name> <template.html> <outDir>
//
// Output: <outDir>/<Name>.view.tsx and, when the template uses style-hover /
// style-focus / style-<pseudo>, <outDir>/<Name>.view.css.
//
// Semantics mirror the dc runtime:
//   {{ path }}            → value lookup on the view model `v` (loop vars first)
//   <sc-if value>          → rendered when truthy
//   <sc-for list as>       → map over the list; `as` item and `$index` in scope
//   <x-import component-from-global-scope="UnifiedTree.X"> → <X/> from the app
//   <dc-import name="Y">   → <Y/> (another converted design component)
//   style-hover="css"      → generated class with `:hover` and !important decls
//   whitespace-only text   → dropped unless it contains a space (kept as " ")
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [name, file, outDir] = process.argv.slice(2)
if (!name || !file || !outDir) {
  console.error('usage: dc-to-tsx.mjs <Name> <template.html> <outDir>')
  process.exit(2)
}

const src = readFileSync(file, 'utf8')
const a = src.indexOf('<x-dc>')
const b = src.lastIndexOf('</x-dc>')
if (a < 0 || b < 0) throw new Error('no <x-dc> block in ' + file)
const tpl = src.slice(a + '<x-dc>'.length, b).replace(/<helmet>[\s\S]*?<\/helmet>/g, '')

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
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→', larr: '←', hellip: '…', mdash: '—', ndash: '–', times: '×', check: '✓', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', deg: '°', rupee: '₹', minus: '−', uarr: '↑', darr: '↓' }
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
const NUMERIC = new Set(['tabIndex', 'rows', 'cols', 'maxLength', 'minLength', 'colSpan', 'rowSpan', 'span', 'size', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-level', 'aria-setsize', 'aria-posinset', 'aria-rowcount', 'aria-colcount', 'aria-rowindex', 'aria-colindex'])
const DS_SOURCES = {
  HrButton: 'hr', HrStatusPill: 'hr', HrAvatar: 'hr', HrPageHeader: 'hr', HrDrawer: 'hr', HrSelect: 'hr', HrTabs: 'hr', TableCard: 'hr', HrStatCard: 'hr', FilterBar: 'hr', HrTabPanel: 'hr',
  DataTable: 'DataTable', EmptyState: 'EmptyState', SkeletonBlock: 'SkeletonCard', HrPagination: 'HrPagination',
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
const styleLiteral = (css) => '{' + cssToObj(css).map(([k, v]) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsStr(k)) + ': ' + jsStr(v)).join(', ') + '}'

// pseudo-class rules → generated CSS
const pseudo = new Map()
let pseudoN = 0
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
const used = new Set()
const usedDc = new Set()
let usesCss = false
let usesArr = false
let usesText = false
let usesHost = false

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
        const kept = cssToObj(hostStyle).filter(([k]) => HOST.has(k))
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
  const open = `${pad}<${tag}${props.length ? ' ' + props.join(' ') : ''}`
  if (VOID.has(tag.toLowerCase()) || (!inner && !['textarea', 'select'].includes(tag))) return `${open} />`
  return `${open}>\n${inner}\n${pad}</${tag}>`
}

const tree = parse(tpl)
const body = emitChildren(tree.children, [], 3)

const imports = usesArr ? ["import { Fragment } from 'react'"] : []
const byMod = {}
for (const c of used) (byMod[DS_SOURCES[c] || 'unknown'] ||= []).push(c)
if (byMod.hr) imports.push(`import { ${byMod.hr.sort().join(', ')} } from '@/shared/components/hr'`)
if (byMod.DataTable) imports.push("import { DataTable } from '@/shared/components/DataTable'")
if (byMod.EmptyState) imports.push("import { EmptyState } from '@/shared/components/EmptyState'")
if (byMod.SkeletonCard) imports.push("import { SkeletonBlock } from '@/shared/components/SkeletonCard'")
if (byMod.HrPagination) imports.push("import { HrPagination } from '@/shared/components/HrPagination'")
if (byMod['ui-kit']) imports.push(`import { ${byMod['ui-kit'].sort().join(', ')} } from '@unifiedtree/ui-kit'`)
const rt = ['arr', 'css', 'txt', 'hostPos'].filter((f) => (f === 'arr' ? usesArr : f === 'css' ? usesCss : f === 'txt' ? usesText : usesHost))
if (byMod.runtime) rt.push('UTPortal')
if (rt.length) imports.push(`import { ${rt.join(', ')} } from './dc-runtime'`)
if (byMod.unknown) console.warn(`[${name}] unknown x-import components:`, byMod.unknown)
for (const d of [...usedDc].sort()) imports.push(`import { ${d} } from './${d}'`)
if (pseudo.size) imports.push(`import './${name}.view.css'`)

const out = `// GENERATED by scripts/dc-to-tsx.mjs from the Claude Design component ${name}.dc.html.
// Do not edit by hand — change the design (or the view model) and regenerate.
${imports.join('\n')}

export function ${name}View({ v }: { v: any }) {
  return (
    <>
${body}
    </>
  )
}
`
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, `${name}.view.tsx`), out)
if (pseudo.size) writeFileSync(join(outDir, `${name}.view.css`), [...pseudo.values()].map((p) => p.rule).join('\n') + '\n')
console.log(`${name}: ${out.split('\n').length} lines, ${used.size} DS components, ${usedDc.size} sub-components, ${pseudo.size} pseudo rules`)
