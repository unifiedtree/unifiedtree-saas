/**
 * The name a greeting shows ("Good morning, <name>").
 *
 * The person's full name: the first and last name from their profile (the
 * client's rule of 1 Oct 2026, "the full name, everywhere"). Spaces around
 * either part are trimmed and a missing part is left out, so someone with only
 * a first name, or only a last name, is greeted by that.
 *
 * Returns undefined when there is no name at all, so each greeting keeps its
 * own fallback ("there").
 */
export function greetingName(firstName?: string | null, lastName?: string | null): string | undefined {
  const full = [(firstName ?? '').trim(), (lastName ?? '').trim()].filter(Boolean).join(' ')
  return full || undefined
}
