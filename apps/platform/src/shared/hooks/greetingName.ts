/**
 * The name a greeting shows ("Good morning, <name>").
 *
 * The first name, unless it has fewer than two letters: an initial on its own
 * ("S." or "S") reads like a typo, so the full name ("S. Kumar") is shown
 * instead. Only letters are counted, so dots and spaces don't make a name long
 * enough.
 *
 * Returns undefined when there is no name at all, so each greeting keeps its
 * own fallback ("there").
 */
export function greetingName(firstName?: string | null, lastName?: string | null): string | undefined {
  const first = (firstName ?? '').trim()
  if (letterCount(first) >= 2) return first
  const full = [first, (lastName ?? '').trim()].filter(Boolean).join(' ')
  return full || undefined
}

/** Letters in any script; dots, spaces, digits and marks are not counted. */
function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length
}
