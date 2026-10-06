// Photos and logos the server stores itself come as API paths (/v1/public/images/…, V143.102);
// the kit's Avatar and ApprovalRow load them from the API (w43). Rendered as markup.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { mediaSrc } from './displayUtil'
import { Avatar } from './Avatar'
import { ApprovalRow } from './ApprovalRow'

describe('mediaSrc', () => {
  it('puts the API base before a server path and leaves other addresses alone', () => {
    expect(mediaSrc('/v1/public/images/t/x')).toBe('/api/v1/public/images/t/x')
    expect(mediaSrc('https://cdn.example/x.png')).toBe('https://cdn.example/x.png')
    expect(mediaSrc('blob:abc')).toBe('blob:abc')
    expect(mediaSrc('')).toBeNull()
    expect(mediaSrc(null)).toBeNull()
  })
})

describe('Avatar and ApprovalRow photos', () => {
  it('Avatar loads a server path from the API, initials without one', () => {
    expect(renderToStaticMarkup(<Avatar name="Asha Rao" src="/v1/public/images/t/x" />)).toContain('src="/api/v1/public/images/t/x"')
    expect(renderToStaticMarkup(<Avatar name="Asha Rao" />)).toContain('AR')
  })
  it('ApprovalRow shows the person’s photo, initials without one', () => {
    const withPhoto = renderToStaticMarkup(<ApprovalRow name="Deepa Nair" title="Casual leave" status="pending" photo="/v1/public/images/t/d" variant="card" />)
    expect(withPhoto).toContain('<img class="uko-appr-img" src="/api/v1/public/images/t/d"')
    const without = renderToStaticMarkup(<ApprovalRow name="Deepa Nair" title="Casual leave" status="pending" variant="card" />)
    expect(without).not.toContain('<img')
    expect(without).toContain('DN')
  })
})
