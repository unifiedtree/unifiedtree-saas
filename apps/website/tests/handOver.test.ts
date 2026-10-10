// Where the website's "Enter" (and its sign-in's own hand-over) sends someone (src/lib/handOver.ts).
// The website has no test runner of its own (and is not type-checked from here: tsconfig includes src only);
// it runs with the platform's:  cd apps/platform && npx vitest run --dir ../website/tests
import { describe, expect, it } from 'vitest'
import { businessBase, businessSignInUrl, handOverUrl, needsTwoFactorSignIn } from '../src/lib/handOver'

const acme = { subdomain: 'acme', workspaceUrl: 'https://acme.unifiedtree.com' }

describe('the business address', () => {
  it('its own workspaceUrl, else <sub>.unifiedtree.com', () => {
    expect(businessBase(acme, 'www.unifiedtree.com')).toBe('https://acme.unifiedtree.com')
    expect(businessBase({ subdomain: 'acme', workspaceUrl: null }, 'unifiedtree.com')).toBe('https://acme.unifiedtree.com')
  })

  it('local dev (this site on localhost or 127.0.0.1): the business app on <sub>.localhost:3001', () => {
    expect(businessBase(acme, 'localhost')).toBe('http://acme.localhost:3001')
    expect(businessBase(acme, '127.0.0.1')).toBe('http://acme.localhost:3001')
  })
})

describe('signed in: the Apps page', () => {
  it('on unifiedtree.com without a token in the address (the cookie signs the business in)', () => {
    expect(handOverUrl('https://acme.unifiedtree.com', 'tok')).toBe('https://acme.unifiedtree.com/modules')
  })

  it('local dev keeps ?token= (the cookie cannot reach *.localhost)', () => {
    expect(handOverUrl('http://acme.localhost:3001', 'a b')).toBe('http://acme.localhost:3001/?token=a%20b')
  })
})

describe('a login that needs a two-factor code: the business’s own sign-in page', () => {
  it('only 403 USE_PASSWORD_FOR_TWO_FACTOR', () => {
    expect(needsTwoFactorSignIn(403, { errorCode: 'USE_PASSWORD_FOR_TWO_FACTOR', message: 'Your login uses two-factor sign-in.' })).toBe(true)
    // Every other refusal keeps today's handling (the message for a click, the list after the sign-in's own hand-over).
    expect(needsTwoFactorSignIn(403, { message: 'You do not have access to this workspace' })).toBe(false)
    expect(needsTwoFactorSignIn(403, { errorCode: 'ACCOUNT_INACTIVE' })).toBe(false)
    expect(needsTwoFactorSignIn(422, { errorCode: 'USE_PASSWORD_FOR_TWO_FACTOR' })).toBe(false)
    expect(needsTwoFactorSignIn(403, null)).toBe(false)
    expect(needsTwoFactorSignIn(403, 'USE_PASSWORD_FOR_TWO_FACTOR')).toBe(false)
  })

  it('its /login with the two-factor message (?error=, which also stops its own silent try), no token, here and in local dev', () => {
    expect(businessSignInUrl(businessBase(acme, 'www.unifiedtree.com'))).toBe('https://acme.unifiedtree.com/login?error=USE_PASSWORD_FOR_TWO_FACTOR')
    expect(businessSignInUrl('https://acme.unifiedtree.com/')).toBe('https://acme.unifiedtree.com/login?error=USE_PASSWORD_FOR_TWO_FACTOR')
    expect(businessSignInUrl(businessBase(acme, 'localhost'))).toBe('http://acme.localhost:3001/login?error=USE_PASSWORD_FOR_TWO_FACTOR')
    expect(new URL(businessSignInUrl(businessBase(acme, 'www.unifiedtree.com'))).searchParams.has('token')).toBe(false)
  })
})
