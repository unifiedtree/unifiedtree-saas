import { describe, expect, it } from 'vitest'
import type { GeneratedLetterDto } from './api/useLetters'
import {
  dayText, distributionStatus, issuedDay, letterName, letterStatus, localDay, myLetterCard, needsMySignature,
  nextDay, recipientsText, scheduleStatus, shortDay, signatureBanner, signatureNote,
} from './lettersModel'

const letter = (p: Partial<GeneratedLetterDto>): GeneratedLetterDto => ({
  id: 'l1', tenantId: 't', companyId: 'c', templateId: 'tp', employeeId: 'e', type: 'OFFER', subject: 'Offer of employment',
  status: 'SENT', hasPdf: true, generatedBy: 'u', createdAt: '2026-03-01T05:00:00Z', updatedAt: '2026-03-01T05:00:00Z', ...p,
})

describe('letters: dates', () => {
  it('reads a calendar day as it is and an instant in the local calendar', () => {
    expect(localDay('2026-03-09')).toBe('2026-03-09')
    expect(localDay(null)).toBeNull()
    expect(localDay('not a date')).toBeNull()
    expect(dayText('2026-03-09')).toBe('9 Mar 2026')
    expect(dayText(null)).toBe('—')
  })
  it('shows the weekday for this year and the year otherwise', () => {
    expect(shortDay('2026-09-14', '2026-10-02')).toBe('Mon, 14 Sep')
    expect(shortDay('2025-09-14', '2026-10-02')).toBe('14 Sep 2025')
  })
  it('issued = the issue date HR chose, else sent, else generated', () => {
    expect(issuedDay(letter({ issueDate: '2026-02-20', sentAt: '2026-03-02T06:00:00Z' }))).toBe('2026-02-20')
    expect(issuedDay(letter({ sentAt: '2026-03-02T06:00:00Z' }))).toBe(localDay('2026-03-02T06:00:00Z'))
    expect(issuedDay(letter({ sentAt: undefined }))).toBe(localDay('2026-03-01T05:00:00Z'))
  })
  it('the first date a send can be scheduled for is tomorrow', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(nextDay('2026-02-28')).toBe('2026-03-01')
  })
})

describe('letters: names and pills', () => {
  it('names a letter by its template, else its subject', () => {
    expect(letterName(letter({ templateName: 'Appointment letter' }))).toBe('Appointment letter')
    expect(letterName(letter({ templateName: '  ' }))).toBe('Offer of employment')
  })
  it('a generated letter is a draft until it is sent', () => {
    expect(letterStatus('GENERATED')).toEqual({ label: 'Draft', tone: 'warning' })
    expect(letterStatus('SENT').label).toBe('Sent')
    expect(letterStatus('VOID')).toEqual({ label: 'Void', tone: 'neutral' })
  })
  it('the signature line shows only when one was asked or given', () => {
    expect(signatureNote(letter({}))).toBeNull()
    expect(signatureNote(letter({ signatureRequested: true }))?.label).toBe('Signature asked')
    expect(signatureNote(letter({ signatureRequested: true, status: 'VOID' }))).toBeNull()
    expect(signatureNote(letter({ status: 'SIGNED', signedAt: '2026-03-05' }))?.label).toBe('Signed 5 Mar 2026')
    expect(signatureNote(letter({ status: 'SIGNED' }))?.label).toBe('Signed')
  })
  it('distributions say sent and failed, never delivered', () => {
    const j = { sentCount: 246, failedCount: 3, totalRecipients: 249 }
    expect(distributionStatus({ ...j, status: 'COMPLETED' }).label).toBe('Sent to 246')
    expect(distributionStatus({ ...j, status: 'PARTIAL_FAILURE' })).toEqual({ label: '246 sent · 3 failed', tone: 'warning' })
    expect(distributionStatus({ ...j, status: 'PROCESSING' }).label).toBe('Sending · 246 of 249')
    expect(distributionStatus({ ...j, status: 'FAILED' }).tone).toBe('danger')
  })
  it('a scheduled send names its day and hour', () => {
    expect(scheduleStatus({ status: 'SCHEDULED', sendOn: '2026-10-12' }).label).toMatch(/^Sends .*12 Oct.*, 9:00$/)
    expect(scheduleStatus({ status: 'FAILED', sendOn: '2026-10-12' }).tone).toBe('danger')
  })
  it('recipients in words', () => {
    expect(recipientsText('ALL_EMPLOYEES', [])).toBe('Everyone')
    expect(recipientsText('CUSTOM_LIST', ['a', 'b'])).toBe('2 people')
    expect(recipientsText('BY_BRANCH', ['Bengaluru HQ'])).toBe('Bengaluru HQ')
    expect(recipientsText('BY_DEPARTMENT', ['Sales', 'Design'])).toBe('Sales and Design')
    expect(recipientsText('BY_DEPARTMENT', ['A', 'B', 'C', 'D'])).toBe('A, B and 2 more')
  })
})

describe('My letters cards', () => {
  it('asks for a signature only on a sent letter that wants one', () => {
    expect(needsMySignature(letter({ signatureRequested: true, status: 'SENT' }))).toBe(true)
    expect(needsMySignature(letter({ signatureRequested: true, status: 'VIEWED' }))).toBe(true)
    expect(needsMySignature(letter({ signatureRequested: true, status: 'SIGNED', signedAt: '2026-03-05' }))).toBe(false)
    expect(needsMySignature(letter({ signatureRequested: true, status: 'VOID' }))).toBe(false)
    expect(needsMySignature(letter({ signatureRequested: false }))).toBe(false)
  })
  it('says Signed only for signed letters, Issued for the rest, Withdrawn for voided ones', () => {
    const sign = myLetterCard(letter({ signatureRequested: true, generatedByName: 'Meera Joshi', sentAt: '2026-09-22T06:00:00Z' }))
    expect(sign).toMatchObject({ tone: 'action', state: 'Needs your signature', sign: true })
    expect(sign.sub).toMatch(/^Sent by Meera Joshi · /)
    expect(myLetterCard(letter({ status: 'SIGNED', signedAt: '2026-04-02' }))).toMatchObject({ tone: 'done', state: 'Signed', sub: 'Signed 2 Apr 2026' })
    expect(myLetterCard(letter({ issueDate: '2022-09-12' }))).toMatchObject({ tone: 'done', state: 'Issued', sub: 'Issued 12 Sep 2022' })
    expect(myLetterCard(letter({ status: 'VOID', voidedAt: undefined }))).toMatchObject({ tone: 'neutral', state: 'Withdrawn', sub: 'Withdrawn by HR' })
  })
  it('the gold line names the first letter to sign', () => {
    expect(signatureBanner([letter({})])).toBeNull()
    expect(signatureBanner([letter({ signatureRequested: true, templateName: 'Appraisal letter 2026' })]))
      .toBe('Your appraisal letter 2026 needs your e-signature. It takes about a minute.')
    expect(signatureBanner([letter({ signatureRequested: true, templateName: 'Appraisal letter' }), letter({ id: 'l2', signatureRequested: true })]))
      .toMatch(/^2 letters need your e-signature/)
  })
})
