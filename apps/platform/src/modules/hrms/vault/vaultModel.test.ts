import { describe, expect, it } from 'vitest'
import type { EmployeeDocumentV2 } from '../api/useDocument'
import type { MyAssetCare } from '../onboarding/myAssetsApi'
import { assetCard, assetsBanner, day, daysUntil, documentCard, documentsBanner, expiryState, reviewPill } from './vaultModel'

const TODAY = '2026-10-02'
const doc = (p: Partial<EmployeeDocumentV2>): EmployeeDocumentV2 => ({
  id: 'd1', employeeId: 'e', companyId: 'c', title: 'Passport', category: 'ID_PROOF', fileUrl: 'https://x/y', createdAt: '2026-09-20T06:00:00Z', ...p,
})
const asset = (p: Partial<MyAssetCare>): MyAssetCare => ({
  assetId: 'a1', assetTag: 'UT-MON-0187', assetType: 'Monitor', assetName: 'Dell 27" monitor', withMe: true, assignedAt: '2026-09-21', ...p,
})

describe('vault: dates and expiry', () => {
  it('formats days and counts to a date', () => {
    expect(day('2022-03-14')).toBe('14 Mar 2022')
    expect(day(null)).toBe('—')
    expect(daysUntil('2026-10-12', TODAY)).toBe(10)
    expect(daysUntil('2026-09-30', TODAY)).toBe(-2)
  })
  it('expired, expiring within 30 days, or nothing', () => {
    expect(expiryState('2026-09-30', TODAY)).toMatchObject({ label: 'Expired', expired: true })
    expect(expiryState(TODAY, TODAY)?.label).toBe('Expires today')
    expect(expiryState('2026-10-03', TODAY)?.label).toBe('Expires in 1 day')
    expect(expiryState('2026-11-01', TODAY)?.label).toBe('Expires in 30 days')
    expect(expiryState('2026-11-02', TODAY)).toBeNull()
    expect(expiryState(null, TODAY)).toBeNull()
  })
  it('the review pill says Expired for an expired document HR accepted', () => {
    expect(reviewPill(doc({ verificationStatus: 'VERIFIED', expiryDate: '2026-08-02' }), TODAY)).toEqual({ tone: 'danger', label: 'Expired' })
    expect(reviewPill(doc({ verificationStatus: 'PENDING' }), TODAY)?.label).toBe('Waiting for review')
    expect(reviewPill(doc({ verificationStatus: 'REJECTED', expiryDate: '2026-08-02' }), TODAY)?.label).toBe('Rejected')
    expect(reviewPill(doc({}), TODAY)).toBeNull()
  })
})

describe('My documents cards', () => {
  it('a rejected document asks for a new copy, with HR’s reason', () => {
    expect(documentCard(doc({ verificationStatus: 'REJECTED', rejectionReason: 'HR asked for a clearer photo', verifiedAt: '2026-09-23T06:00:00Z' }), TODAY))
      .toMatchObject({ tone: 'action', state: 'Upload again', redo: true, sub: 'HR asked for a clearer photo · 23 Sep 2026' })
  })
  it('waiting, verified, added by HR and expired', () => {
    expect(documentCard(doc({ verificationStatus: 'PENDING' }), TODAY)).toMatchObject({ tone: 'neutral', state: 'Waiting for HR' })
    expect(documentCard(doc({ verificationStatus: 'VERIFIED', verifiedAt: '2022-03-14' }), TODAY)).toMatchObject({ tone: 'done', state: 'Verified', sub: 'Verified · 14 Mar 2022' })
    expect(documentCard(doc({ verificationStatus: null, issuedDate: '2021-02-14' }), TODAY)).toMatchObject({ state: 'On file', sub: 'Added by HR · 14 Feb 2021' })
    expect(documentCard(doc({ verificationStatus: 'VERIFIED', expiryDate: '2026-08-02' }), TODAY)).toMatchObject({ tone: 'danger', state: 'Expired', redo: true })
    expect(documentCard(doc({ verificationStatus: 'VERIFIED', verifiedAt: '2022-03-14', expiryDate: '2026-10-12' }), TODAY).sub).toBe('Verified · 14 Mar 2022 · expires in 10 days')
  })
  it('the gold line: a rejected document first, else what HR still needs', () => {
    expect(documentsBanner([doc({ verificationStatus: 'REJECTED', documentTypeName: 'Address proof', rejectionReason: 'too blurry' })], []))
      .toBe('HR couldn’t accept your address proof: too blurry. Upload a new copy.')
    expect(documentsBanner([], [{ displayName: 'PAN card' }])).toBe('HR still needs your PAN card. Upload it below.')
    expect(documentsBanner([], [{ displayName: 'PAN card' }, { displayName: 'Photo' }])).toMatch(/^HR still needs 2 documents/)
    expect(documentsBanner([doc({ verificationStatus: 'VERIFIED' })], [])).toBeNull()
  })
})

describe('My assets cards', () => {
  it('asks to confirm a new hand-over, shows an open problem, else With you', () => {
    expect(assetCard(asset({ canConfirm: true }))).toMatchObject({ tone: 'action', state: 'Confirm you got it', confirm: true, sub: 'UT-MON-0187 · handed over 21 Sep 2026' })
    expect(assetCard(asset({ openIssue: { id: 'i', kind: 'DAMAGED', reportedAt: '2026-09-30T00:00:00Z' } }))).toMatchObject({ tone: 'neutral', state: 'Reported damaged' })
    expect(assetCard(asset({}))).toMatchObject({ tone: 'done', state: 'With you', confirm: false })
  })
  it('the gold line names the first item to confirm', () => {
    expect(assetsBanner([asset({ canConfirm: true })])).toBe('Did you get the Dell 27" monitor? Confirm it so it’s recorded against you.')
    expect(assetsBanner([asset({})])).toBeNull()
    expect(assetsBanner([asset({ canConfirm: true }), asset({ assetId: 'a2', canConfirm: true })])).toMatch(/^2 items are waiting/)
  })
})
