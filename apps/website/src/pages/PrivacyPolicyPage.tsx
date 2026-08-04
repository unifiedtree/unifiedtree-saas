import { LegalPageLayout } from '../components/layout/LegalPageLayout'

export function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated="August 2026"
      intro="How UnifiedTree collects, uses, and protects the personal information you share when you use our platform."
    >
      <p>
        Our Unique (&quot;we&quot;, &quot;us&quot;, &quot;UnifiedTree&quot;) operates the UnifiedTree ERP platform at
        <a href="https://www.unifiedtree.com"> unifiedtree.com</a>. This policy explains what data we collect,
        why we collect it, and the choices you have.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Account information</h3>
      <p>When you create a workspace we collect your name, email, phone, company name, subdomain, country and timezone.</p>
      <h3>Business data</h3>
      <p>The information you enter into UnifiedTree — employees, attendance, payroll, leave records, and any other module data — is stored on our servers under your tenant.</p>
      <h3>Usage data</h3>
      <p>We record which pages you visit, which features you use, browser and device details, IP address, and error diagnostics. This helps us keep the platform fast and reliable.</p>
      <h3>Payment data</h3>
      <p>Payments are processed by Razorpay. We store the Razorpay order and payment identifiers so we can reconcile your subscription. We do NOT store your card number, CVV, or bank credentials.</p>

      <h2>2. How we use your information</h2>
      <ul>
        <li>To provide and operate the UnifiedTree service you signed up for.</li>
        <li>To authenticate you and secure your workspace.</li>
        <li>To send transactional email and in-app notifications (leave approvals, shift changes, payment receipts, trial reminders).</li>
        <li>To respond to your support requests.</li>
        <li>To improve product quality and diagnose bugs.</li>
        <li>To comply with legal obligations.</li>
      </ul>

      <h2>3. Who we share information with</h2>
      <p>We share the minimum data required with:</p>
      <ul>
        <li><strong>Cloud infrastructure:</strong> Google Cloud (Cloud SQL, Cloud Run) hosts our servers and database.</li>
        <li><strong>Payments:</strong> Razorpay processes subscription payments.</li>
        <li><strong>Notifications:</strong> Firebase Cloud Messaging delivers push notifications to your mobile app.</li>
        <li><strong>Email:</strong> Our transactional email provider delivers system emails.</li>
      </ul>
      <p>We do NOT sell your data. We do NOT share your business data with third parties for advertising.</p>

      <h2>4. Data retention</h2>
      <p>We keep your workspace data for as long as your subscription is active. If you cancel, we retain the data for 30 days so you can reactivate, then permanently delete it.</p>

      <h2>5. Security</h2>
      <p>Passwords are hashed with bcrypt. Data is encrypted in transit (HTTPS/TLS) and at rest on Google Cloud. See our <a href="/security">Security page</a> for the full picture.</p>

      <h2>6. Your rights</h2>
      <p>You can view, export, correct, or delete your personal data at any time by contacting us at <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a>. We respond within 7 business days.</p>

      <h2>7. Contact</h2>
      <p>Questions about this policy? Email <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a>.</p>
    </LegalPageLayout>
  )
}
