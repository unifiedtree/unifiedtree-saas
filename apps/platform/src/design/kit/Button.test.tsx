import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { Button, type ButtonSize } from './display'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1

describe('Button', () => {
  it('defaults: a type="button" secondary at 38px with its label', () => {
    const s = html(<Button>Import</Button>)
    expect(s).toMatch(/^<button type="button" class="uk-btn uk-btn--secondary uk-btn--s38">/)
    expect(s).toContain('<span class="uk-btn__label">Import</span>')
    expect(s).not.toContain('aria-busy')
    expect(s).not.toContain('uk-btn__spin')
  })

  it('header primary (46): icon + label, spotlight layer, 17px icon', () => {
    const s = html(<Button variant="primary" size={46} icon="plus">Add employee</Button>)
    expect(s).toContain('class="uk-btn uk-btn--primary uk-btn--s46 has-icon ufx-spot"')
    expect(s).toContain('<span aria-hidden="true" class="uk-fx-spot"></span>')
    expect(s).toContain('<span class="uk-btn__icon" aria-hidden="true"><svg')
    expect(s).toContain('width="17"')
    expect(s).toContain('<span class="uk-btn__label">Add employee</span>')
  })

  it('only the 46px primary gets the spotlight', () => {
    expect(html(<Button variant="secondary" size={46} icon="download">Export</Button>)).not.toContain('uk-fx-spot')
    expect(html(<Button variant="primary" size={40}>Add company</Button>)).not.toContain('uk-fx-spot')
  })

  it('every size and variant maps to its class', () => {
    const sizes: ButtonSize[] = [30, 32, 36, 38, 40, 44, 46]
    for (const z of sizes) expect(html(<Button size={z}>x</Button>)).toContain(`uk-btn--s${z}`)
    for (const v of ['primary', 'secondary', 'neutral', 'ghost', 'soft', 'plain', 'danger', 'danger-outline'] as const) {
      expect(html(<Button variant={v}>x</Button>)).toContain(`uk-btn--${v} `)
    }
  })

  it('icon-only: square, named by aria-label, no label element', () => {
    const s = html(<Button icon="x" aria-label="Clear selection" size={30} variant="plain" />)
    expect(s).toContain('aria-label="Clear selection"')
    expect(s).toContain('uk-btn--icon')
    expect(s).not.toContain('has-icon')
    expect(s).not.toContain('uk-btn__label')
    expect(count(s, '<svg')).toBe(1)
    // @ts-expect-error an icon-only button must have an aria-label
    expect(html(<Button icon="x" />)).toContain('uk-btn--icon')
  })

  it('loading: spinner, aria-busy, content kept (so the width stays)', () => {
    const s = html(<Button variant="primary" loading>Save</Button>)
    expect(s).toContain('aria-busy="true"')
    expect(s).toContain('aria-disabled="true"')
    expect(s).toContain('is-loading')
    expect(s).toContain('<span class="uk-btn__spin" aria-hidden="true"></span>')
    expect(s).toContain('<span class="uk-btn__label">Save</span>')
    expect(s).not.toContain('disabled=""')
  })

  it('disabled and type pass through', () => {
    expect(html(<Button disabled>Approve</Button>)).toContain('disabled=""')
    expect(html(<Button type="submit" variant="primary">Save</Button>)).toContain('type="submit"')
  })

  it('href renders a real link; new tabs get noopener', () => {
    const s = html(<Button href="/employees/new" variant="primary" size={46} icon="plus">Add employee</Button>)
    expect(s).toMatch(/^<a href="\/employees\/new" class="uk-btn uk-btn--primary uk-btn--s46 has-icon ufx-spot">/)
    expect(s).not.toContain('type=')
    expect(html(<Button href="https://x.test" target="_blank">Docs</Button>)).toContain('rel="noopener noreferrer"')
    expect(html(<Button href="/x" rel="external">Docs</Button>)).toContain('rel="external"')
  })

  it('a disabled or loading link renders as a button that does nothing', () => {
    const d = html(<Button href="/x" disabled>Open</Button>)
    expect(d).toMatch(/^<button type="button"/)
    expect(d).toContain('disabled=""')
    expect(d).not.toContain('href=')
    expect(html(<Button href="/x" loading>Open</Button>)).toMatch(/^<button type="button"[^>]*aria-busy="true"/)
  })

  it('trailing icon, round and pill shapes, full width', () => {
    const s = html(<Button trailingIcon="chevronRight">Manage</Button>)
    expect(count(s, 'class="uk-btn__icon"')).toBe(1)
    expect(s.indexOf('uk-btn__label')).toBeLessThan(s.indexOf('uk-btn__icon'))
    expect(html(<Button icon="check" aria-label="Approve" shape="round" size={36} variant="soft" />)).toContain('uk-btn--round')
    expect(html(<Button shape="pill">Filter</Button>)).toContain('uk-btn--pill')
    expect(html(<Button block>Continue</Button>)).toContain('uk-btn--block')
  })

  it('extra attributes and classes reach the element', () => {
    const s = html(<Button className="x-1" title="Export as CSV" aria-describedby="h1" data-testid="exp">Export</Button>)
    expect(s).toContain('class="uk-btn uk-btn--secondary uk-btn--s38 x-1"')
    expect(s).toContain('title="Export as CSV"')
    expect(s).toContain('aria-describedby="h1"')
    expect(s).toContain('data-testid="exp"')
  })
})
