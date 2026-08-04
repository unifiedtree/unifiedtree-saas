import { LegalPageLayout } from '../components/layout/LegalPageLayout'

export function CookiePolicyPage() {
  return (
    <LegalPageLayout
      title="Cookie Policy"
      lastUpdated="August 2026"
      intro="What cookies and browser storage UnifiedTree uses, and how you can control them."
    >
      <p>This policy sits alongside our <a href="/privacy">Privacy Policy</a>. It covers cookies and similar technologies (localStorage, sessionStorage) used by unifiedtree.com and workspace subdomains.</p>

      <h2>What we use</h2>
      <h3>Strictly necessary</h3>
      <p>These are required for the site and your workspace to function. You can&apos;t opt out without breaking the product.</p>
      <ul>
        <li><strong>account_token, tenant_token</strong> (localStorage) — keep you signed in.</li>
        <li><strong>ut.theme</strong> (localStorage) — remembers your light/dark mode choice.</li>
        <li><strong>Zustand persistence</strong> — remembers your selected modules and seat count on the pricing page.</li>
      </ul>

      <h3>Third-party</h3>
      <ul>
        <li><strong>Google Fonts</strong> — loads the Inter and JetBrains Mono webfonts.</li>
        <li><strong>Razorpay</strong> — sets its own cookies during checkout to prevent fraud.</li>
        <li><strong>Firebase</strong> — the mobile app uses Firebase Cloud Messaging for push notifications; no cookies on the web.</li>
      </ul>

      <h2>What we don&apos;t use</h2>
      <ul>
        <li>No advertising cookies.</li>
        <li>No cross-site tracking pixels.</li>
        <li>No analytics that identify you personally.</li>
      </ul>

      <h2>Managing cookies</h2>
      <p>You can clear localStorage and cookies from your browser settings any time. Signing out from the workspace clears the auth tokens.</p>

      <h2>Contact</h2>
      <p>Questions? Email <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a>.</p>
    </LegalPageLayout>
  )
}
