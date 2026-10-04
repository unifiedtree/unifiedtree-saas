import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NewPermissionsNotice, withTicked } from './NewPermissionsReview'

describe('new permissions on a business-made role (V143.69)', () => {
  it('saves what the role holds plus the ticked ones, never fewer', () => {
    expect(withTicked(['hrms.employee.read', 'leave.request.approve'], new Set(['hrms.team.message'])))
      .toEqual(['hrms.employee.read', 'leave.request.approve', 'hrms.team.message'])
    expect(withTicked(['hrms.team.message'], ['hrms.team.message'])).toEqual(['hrms.team.message'])
    expect(withTicked([], [])).toEqual([])
  })

  it('says how many are new and offers a review', () => {
    const one = renderToStaticMarkup(<NewPermissionsNotice count={1} roleName="Senior manager" onReview={() => {}} />)
    expect(one).toContain('1 new permission available')
    expect(one).toContain('Review')
    expect(one).toContain('aria-label="Review new permissions for Senior manager"')
    expect(renderToStaticMarkup(<NewPermissionsNotice count={3} roleName="Senior manager" onReview={() => {}} />))
      .toContain('3 new permissions available')
  })
})
