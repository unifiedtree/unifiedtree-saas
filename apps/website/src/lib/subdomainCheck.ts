import { useEffect, useState } from 'react';
import { API_BASE_URL } from './api';

export interface SubdomainCheck {
  /** Idle before any check has run for the current value. */
  state: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';
  reason?: string;
}

/**
 * Debounced live availability check for a workspace subdomain. Hits
 * {@code GET /v1/public/subdomains/check?slug=X} 400ms after the input
 * stops changing (so we don't spam the API on every keystroke) and
 * returns a small state machine the form can render inline.
 *
 * The check is best-effort — a network hiccup returns {@code error} and
 * the form still lets the user submit; the server does the definitive
 * check on signup and will 409 if it turns out to be taken.
 */
export function useSubdomainAvailability(value: string | undefined | null): SubdomainCheck {
  const [result, setResult] = useState<SubdomainCheck>({ state: 'idle' });

  useEffect(() => {
    const v = (value ?? '').trim().toLowerCase();
    if (!v) { setResult({ state: 'idle' }); return; }
    if (v.length < 3) { setResult({ state: 'invalid', reason: 'At least 3 characters' }); return; }
    if (!/^[a-z0-9-]+$/.test(v)) { setResult({ state: 'invalid', reason: 'Lowercase letters, numbers, hyphens only' }); return; }

    setResult({ state: 'checking' });
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/v1/public/subdomains/check?slug=${encodeURIComponent(v)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { subdomain: string; available: boolean; reason?: string };
        setResult({
          state: data.available ? 'available' : 'taken',
          reason: data.reason,
        });
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setResult({ state: 'error', reason: 'Could not check availability' });
      }
    }, 400);

    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [value]);

  return result;
}
