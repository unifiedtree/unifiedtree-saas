import { LegalPageLayout } from '../components/layout/LegalPageLayout'

export function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      lastUpdated="August 2026"
      intro="The agreement between you and Our Unique when you use the UnifiedTree ERP platform."
    >
      <p>By creating a workspace or using unifiedtree.com you agree to these terms. If you don&apos;t agree, please don&apos;t use the service.</p>

      <h2>1. Your account</h2>
      <p>You&apos;re responsible for the security of your account credentials and everything that happens under your workspace. Notify us immediately at <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a> if you suspect unauthorised access.</p>

      <h2>2. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the service for anything illegal or that violates a third party&apos;s rights.</li>
        <li>Reverse-engineer, scrape, or interfere with the platform&apos;s operation.</li>
        <li>Send spam or malicious content through UnifiedTree.</li>
        <li>Share your login with people outside your organisation to bypass seat pricing.</li>
      </ul>

      <h2>3. Subscription &amp; billing</h2>
      <p>Paid plans are billed monthly or annually, in advance, in Indian Rupees via Razorpay. Trial workspaces are free for 14 days. Prices and modules are shown on <a href="/pricing">the pricing page</a> and may change with 30 days&apos; notice.</p>
      <p>Your subscription auto-renews at the end of each cycle unless you cancel. Cancel any time from your workspace settings.</p>

      <h2>4. Refunds</h2>
      <p>We offer a pro-rata refund for annual plans cancelled within the first 30 days. Monthly plans are non-refundable once the cycle starts, but you can cancel before the next billing date and won&apos;t be charged again.</p>

      <h2>5. Data ownership</h2>
      <p>You own your data. We store and process it only to provide the service. You can export your data at any time and we delete it 30 days after cancellation. See our <a href="/privacy">Privacy Policy</a> for details.</p>

      <h2>6. Uptime &amp; support</h2>
      <p>We target 99.5% monthly uptime. When outages happen we work to restore service quickly and communicate over email + status updates. Support is available at <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a> with a response within one business day.</p>

      <h2>7. Warranty &amp; liability</h2>
      <p>UnifiedTree is provided &quot;as is&quot;. To the maximum extent permitted by law, our liability is capped at the amount you paid us in the 12 months preceding the claim.</p>

      <h2>8. Termination</h2>
      <p>We may suspend or terminate a workspace that materially breaches these terms, with a good-faith attempt to notify you first. You can terminate any time from workspace settings.</p>

      <h2>9. Changes</h2>
      <p>We&apos;ll email you at least 30 days before any material change. Continuing to use the service after a change means you accept the updated terms.</p>

      <h2>10. Governing law</h2>
      <p>These terms are governed by the laws of India. Disputes will be resolved in the courts of Hyderabad, Telangana.</p>

      <h2>11. Contact</h2>
      <p>Email <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a>.</p>
    </LegalPageLayout>
  )
}
