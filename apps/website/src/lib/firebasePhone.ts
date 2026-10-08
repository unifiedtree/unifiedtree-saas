// SMS sign-in for a business's web login (owner, 6 Oct 2026): Firebase phone auth, the same Firebase
// project the mobile app uses (unifiedtree-445cd, app "UnifiedTree Web").
//
// Firebase only runs phone sign-in on its authorized domains, and a business's own address
// (<business>.unifiedtree.com) can't be one of them (no wildcards), so the SMS step lives here on the
// website and hands the session back to the business afterwards (pages/MobileSignInPage.tsx).
//
// The SDK is loaded from Google's CDN only when someone opens that page: nothing in the site's bundle
// and no new package. The values below are Firebase's public web identifiers (they ship to every
// browser), not secrets; the key is meant to be restricted to the authorized domains in Google Cloud.

const SDK_VERSION = '10.14.1'
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`

const env = import.meta.env as Record<string, string | undefined>
const CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyACm19L88C3uKmjTPjso3DqaXp48kINKmI',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'unifiedtree-445cd.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'unifiedtree-445cd',
  appId: env.VITE_FIREBASE_APP_ID || '1:347264324366:web:f7d867e8bd06d117e67d5f',
}

/** The few parts of the Firebase Auth SDK this page uses. */
type Auth = { languageCode: string | null; settings: { appVerificationDisabledForTesting: boolean } }
type Verifier = { clear(): void }
type Confirmation = { confirm(code: string): Promise<{ user: { getIdToken(): Promise<string> } }> }
type AuthSdk = {
  getAuth(app: unknown): Auth
  RecaptchaVerifier: new (auth: Auth, container: HTMLElement, params: { size: 'invisible' }) => Verifier
  signInWithPhoneNumber(auth: Auth, phone: string, verifier: Verifier): Promise<Confirmation>
  signOut(auth: Auth): Promise<void>
}

let loaded: Promise<{ auth: Auth; sdk: AuthSdk }> | null = null

function load(testing: boolean) {
  loaded ??= (async () => {
    const appSdk = await import(/* @vite-ignore */ `${SDK}/firebase-app.js`)
    const sdk = (await import(/* @vite-ignore */ `${SDK}/firebase-auth.js`)) as AuthSdk
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(CONFIG)
    const auth = sdk.getAuth(app)
    auth.languageCode = 'en'
    // Firebase's test numbers only (Console → Authentication → Phone): skips the reCAPTCHA so a
    // browser test can sign in. Never on a production build.
    if (testing) auth.settings.appVerificationDisabledForTesting = true
    return { auth, sdk }
  })().catch((e) => { loaded = null; throw e })
  return loaded
}

/** A sent code, waiting for the person to type it. */
export type SentCode = { confirm(code: string): Promise<string> }

/**
 * Sends the SMS code to an Indian mobile number (10 digits). The invisible reCAPTCHA renders into
 * {@code container}. Resolves when Firebase has sent the code; {@link SentCode.confirm} then turns the
 * typed code into a Firebase ID token for /v1/auth/firebase-verify.
 */
export async function sendCode(mobile10: string, container: HTMLElement, testing = false): Promise<SentCode> {
  const { auth, sdk } = await load(testing)
  container.replaceChildren()
  const slot = document.createElement('div')
  container.appendChild(slot)
  const verifier = new sdk.RecaptchaVerifier(auth, slot, { size: 'invisible' })
  let confirmation: Confirmation
  try {
    confirmation = await sdk.signInWithPhoneNumber(auth, `+91${mobile10}`, verifier)
  } catch (e) {
    verifier.clear()
    throw e
  }
  return {
    async confirm(code: string) {
      const cred = await confirmation.confirm(code)
      const idToken = await cred.user.getIdToken()
      // Our own session takes over from here; nothing stays signed in to Firebase in this browser.
      await sdk.signOut(auth).catch(() => {})
      verifier.clear()
      return idToken
    },
  }
}

/** Firebase's error code (e.g. "auth/invalid-verification-code"), or ''. */
export function firebaseCode(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
}
