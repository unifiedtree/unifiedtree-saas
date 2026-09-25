// Which Letters hub views a person gets, and which one a URL opens.
export type LetterView = 'templates' | 'generated' | 'distributions' | 'my'
export interface LetterAccess {
  /** hrms.letters.template.read */
  templates: boolean
  /** hrms.letters.read: every letter in the workspace */
  readAll: boolean
  /** hrms.letters.read.self: your own letters */
  readSelf: boolean
  /** hrms.letters.distribute */
  distribute: boolean
}

/** The views this person may open, in the hub's order. */
export function letterViews(a: LetterAccess): LetterView[] {
  const out: LetterView[] = []
  if (a.templates) out.push('templates')
  if (a.readAll) out.push('generated')
  // The distributions list answers to distribute OR read (LetterDistributionController).
  if (a.distribute || a.readAll) out.push('distributions')
  if (a.readSelf) out.push('my')
  return out
}

/**
 * The view to show for the path segment after /hrms/letters. An old
 * /hrms/letters/generated link opens My letters for someone who can only read
 * their own (that page showed "My letters" to them before the hub). Anything
 * unknown or not allowed opens the first allowed view; null when none is.
 */
export function resolveLetterView(requested: string | undefined, a: LetterAccess): { views: LetterView[]; active: LetterView | null } {
  const views = letterViews(a)
  const wanted = requested === 'generated' && !a.readAll && a.readSelf ? 'my' : requested
  const active = (views as string[]).includes(wanted ?? '') ? (wanted as LetterView) : views[0] ?? null
  return { views, active }
}
