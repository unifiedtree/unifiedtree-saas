import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'

/**
 * Resolve the signed-in user's display identity with a strict fallback chain:
 *
 *   displayName  >  firstName + lastName  >  firstName  >  email.split('@')[0]
 *
 * The historic bug was every consumer inlining its own resolver — half of them
 * fell straight through to the email local-part on cold hydrates, so
 * "Chakri Chikkala" flashed as "shurya.kumar063" for a beat before the sidebar
 * settled. Centralising the chain here means the greeting, the sidebar chip
 * and the profile menu can never disagree.
 *
 * Returned tuple:
 *   greetingName  the SHORT personal name for greetings + the sidebar chip.
 *                 Almost always firstName; falls back progressively.
 *   fullName      the FORMAL name for tooltips, profile menus, page titles.
 *                 firstName + lastName joined, or greetingName if lastName is
 *                 missing.
 *   initial       one uppercase glyph for avatar circles — first letter of
 *                 whatever name we ended up with.
 *   initials      up to two glyphs (first name + last name initial) for
 *                 larger avatar tiles.
 */
export interface DisplayName {
  greetingName: string
  fullName: string
  initial: string
  initials: string
}

/** Reads the SDK user (canonical since 2026-07-31) with a secondary read of the
 *  local zustand user in case the SDK hasn't hydrated yet on first paint. */
export function useDisplayName(): DisplayName {
  const sdkUser = useSdkStore(s => s.user)
  const localUser = useLocalAuthStore(s => s.user)

  // Prefer the SDK user (kept fresh by the refresh flow) and fall back to the
  // local store so a login page that hasn't finished writing through to the
  // SDK yet still shows a real name instead of "there".
  const first = (sdkUser?.firstName ?? localUser?.firstName ?? '').trim()
  const last = (sdkUser?.lastName ?? localUser?.lastName ?? '').trim()
  const email = (sdkUser?.email ?? localUser?.email ?? '').trim()
  // `displayName` isn't in the SDK's User type yet but the API is starting to
  // return one — read it defensively so we're ready when it lands without
  // needing another follow-up PR.
  const displayName = ((sdkUser as { displayName?: string } | null)?.displayName
    ?? (localUser as { displayName?: string } | null)?.displayName
    ?? '').trim()

  const emailLocal = email.includes('@') ? email.split('@')[0] : email

  // Greeting name = SHORT, one word ideally. Prefer displayName only if it
  // reads as a single first word — otherwise it's usually "Firstname Lastname"
  // and we still want "Firstname" for the greeting.
  const greetingName = (() => {
    if (first) return first
    if (displayName) return displayName.split(/\s+/)[0]
    if (last) return last
    if (emailLocal) return emailLocal
    return 'there'
  })()

  // Full name = FORMAL. Prefer explicit displayName (user picked it); else
  // stitch first + last; else fall back to the greeting name.
  const fullName = (() => {
    if (displayName) return displayName
    const joined = [first, last].filter(Boolean).join(' ')
    if (joined) return joined
    if (emailLocal) return emailLocal
    return 'Account'
  })()

  const initial = (greetingName[0] ?? '?').toUpperCase()
  const initials = (() => {
    if (first && last) return (first[0] + last[0]).toUpperCase()
    if (displayName) {
      const parts = displayName.split(/\s+/).filter(Boolean)
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
      return parts[0]?.[0]?.toUpperCase() ?? initial
    }
    return initial
  })()

  return { greetingName, fullName, initial, initials }
}
