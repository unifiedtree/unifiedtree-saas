import { describe, expect, it } from 'vitest'
import { ANGLE, CONSENT_TEXT, DONE_TEXT, ENROL_TIPS, PRIVACY_TEXT, RESET_NOTE, enrolIntro, sampleRejectText } from './faceEnroll'

// The phone app's enrollment says these same sentences (utils/faceEnrolCopy.ts
// in the attendance app repo, pinned by its own test). Change one here only
// together with the app's copy and its test.
describe('face enrollment copy (same as the phone app)', () => {
  it('asks for the same three photos in the same words, with no blink', () => {
    expect([ANGLE.FRONT, ANGLE.LEFT_30, ANGLE.RIGHT_30].map(({ label, prompt, help }) => ({ label, prompt, help }))).toEqual([
      { label: 'Straight', prompt: 'Look straight at the camera', help: 'Keep the whole face inside the oval.' },
      { label: 'Left', prompt: 'Turn your head a little to the left', help: 'A small turn is enough. Keep the face inside the oval.' },
      { label: 'Right', prompt: 'Turn your head a little to the right', help: 'A small turn is enough. Keep the face inside the oval.' },
    ])
    for (const a of Object.values(ANGLE)) expect(`${a.prompt} ${a.help}`).not.toMatch(/blink/i)
  })

  it('introduces the photos for the server’s sequence', () => {
    const standard = 'We’ll take 3 photos of your face: looking straight at the camera, then turning a little to the left and to the right. It takes about a minute.'
    expect(enrolIntro([])).toBe(standard)
    expect(enrolIntro(['FRONT', 'LEFT_30', 'RIGHT_30'])).toBe(standard)
    expect(enrolIntro(['FRONT', 'UP_15'])).toBe('We’ll take 2 photos of your face from slightly different angles. It takes about a minute.')
  })

  it('gives the same tips, reset note, consent and finish', () => {
    expect(ENROL_TIPS).toEqual(['Good, even light on your face. Face a window or a lamp.', 'Only you in the frame.', 'No sunglasses, cap or mask.'])
    expect(RESET_NOTE).toBe('Your face was reset, so face punch-in is off until you take new photos.')
    expect(CONSENT_TEXT).toBe('I agree to my face being used to mark my attendance.')
    expect(PRIVACY_TEXT).toBe('The photos aren’t stored. Only an encrypted face pattern made from them is kept, and it’s used only to check it’s you at face punch-in.')
    expect(DONE_TEXT).toBe('You can now punch in with your face.')
  })

  it('says why a photo was refused, the same way', () => {
    const why = (rejectionCode: string | null) => sampleRejectText({ rejectionCode, rejectionReason: 'server sentence' })
    expect(why('FAIL_NO_FACE')).toBe('No face found in this photo. Keep the face inside the oval and take it again.')
    expect(why('FAIL_MULTIPLE_FACES')).toBe('More than one face is in this photo. Make sure only one person is in the frame.')
    expect(why('FAIL_LOW_QUALITY')).toBe('This photo is too dark or blurry. Move a little closer, face a light, hold still and take it again.')
    expect(why('FAIL_LIVENESS')).toBe('We couldn’t confirm a live face. Look straight at the camera and take it again. A printed photo or a screen won’t pass.')
    expect(why('FAIL_OTHER')).toBe('This photo couldn’t be checked. Take it again.')
    expect(why('DUPLICATE_ANGLE')).toBe('This photo is already saved. Carry on with the next one.')
    expect(why('SOMETHING_NEW')).toBe('This photo wasn’t accepted. Take it again.')
    expect(why(null)).toBe('This photo wasn’t accepted. Take it again.')
  })
})
