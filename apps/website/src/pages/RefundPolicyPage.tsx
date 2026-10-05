import { LegalPageLayout } from '../components/layout/LegalPageLayout'

// Refund rules are the ones already in the Terms (section 4); the trial and
// billing-cycle rules are the owner's of 6 Oct 2026. Keep the two pages in step.
export function RefundPolicyPage() {
  return (
    <LegalPageLayout
      title="Refund & Cancellation Policy"
      lastUpdated="October 2026"
      intro="How the free trial, cancellations and refunds work for UnifiedTree subscriptions."
    >
      <h2>1. Free trial</h2>
      <p>Every new subscription starts with a 7-day free trial. You set up autopay through Razorpay to start it, and nothing is charged during the 7 days. If you cancel before the trial ends, you are not charged at all.</p>

      <h2>2. When billing starts</h2>
      <p>Billing starts on day 8. After that each cycle runs from date to date (for example, 6 October to 6 November for a monthly plan) and is charged in advance through autopay, in Indian Rupees. Each company in your business has its own subscription and invoice.</p>

      <h2>3. Cancelling</h2>
      <p>You can cancel any time from your business settings. Your subscription keeps working until the end of the cycle you have already paid for, and you will not be charged again.</p>

      <h2>4. Refunds</h2>
      <ul>
        <li><strong>Monthly plans</strong> are non-refundable once a cycle has started.</li>
        <li><strong>Annual plans</strong> cancelled within the first 30 days get a pro-rata refund for the unused months.</li>
      </ul>
      <p>Approved refunds are paid back through Razorpay to the card, UPI or bank account the payment came from.</p>

      <h2>5. Questions</h2>
      <p>Write to <a href="mailto:support@unifiedtree.com">support@unifiedtree.com</a> with your business name and the invoice in question. See also our <a href="/terms">Terms of Service</a>.</p>
    </LegalPageLayout>
  )
}
