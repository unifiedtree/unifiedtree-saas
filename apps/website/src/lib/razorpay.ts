import { API_BASE_URL } from './api';

/**
 * Razorpay Checkout integration for paid workspace signup.
 *
 * Flow:
 *   1. createOrder(planKeys, seats, ...) -> backend computes the amount from the
 *      DB (server-authoritative) and returns a Razorpay order id + our key id.
 *   2. openCheckout(...) loads checkout.js and opens the Razorpay modal.
 *   3. On success Razorpay hands back { razorpay_order_id, razorpay_payment_id,
 *      razorpay_signature } which the caller submits to /v1/public/signup-request
 *      so the backend can verify it before creating the workspace.
 *
 * The key secret NEVER touches the browser — only the public key id does.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

let scriptPromise: Promise<boolean> | null = null;

export function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<boolean>((resolve) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
  return scriptPromise;
}

export interface CreateOrderResult {
  orderId: string;
  amountInr: number;
  seats: number;
  billingCycle: string;   // MONTHLY | ANNUAL (echoed back by the server)
  periodMonths: number;   // 1 monthly, 12 annual
  currency: string;
  keyId: string;
}

export async function createPaymentOrder(input: {
  planKeys: string[];
  seats: number;
  billingCycle?: 'monthly' | 'annual';
  subdomain?: string;
  email?: string;
}): Promise<CreateOrderResult> {
  const res = await fetch(`${API_BASE_URL}/v1/public/payment/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Could not start payment (${res.status})`);
  }
  return data as CreateOrderResult;
}

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export async function openCheckout(opts: {
  order: CreateOrderResult;
  name: string;         // company / product name shown in the modal
  description: string;
  prefill: { name?: string; email?: string; contact?: string };
  onSuccess: (r: RazorpaySuccess) => void;
  onDismiss?: () => void;
}): Promise<void> {
  const ok = await loadRazorpay();
  if (!ok || !window.Razorpay) {
    throw new Error('Could not load the payment gateway. Check your connection and retry.');
  }
  const rzp = new window.Razorpay({
    key: opts.order.keyId,
    order_id: opts.order.orderId,
    amount: Math.round(opts.order.amountInr * 100), // paise (display only; order is authoritative)
    currency: opts.order.currency || 'INR',
    name: 'UnifiedTree',
    // Real brand logo shown in the checkout header. Without this, Razorpay
    // draws a placeholder "U" tile from the first letter of `name`. Must be a
    // public HTTPS URL (Razorpay fetches it server-side). This is the app
    // icon (1024x1024) copied into public/checkout-logo.png.
    image: 'https://www.unifiedtree.com/checkout-logo.png',
    description: opts.description,
    prefill: opts.prefill,
    theme: { color: '#0F6E56' },
    handler: (response: RazorpaySuccess) => opts.onSuccess(response),
    modal: { ondismiss: () => opts.onDismiss?.() },
  });
  rzp.on('payment.failed', () => {
    // Surface a friendly failure via the dismiss path; the caller decides copy.
    opts.onDismiss?.();
  });
  rzp.open();
}
