/**
 * The HRMS Settings index (owner, Q-06, 9 Oct 2026; master context §11 "one settings entry per module").
 *
 * One page of cards, one per HR setting. Each card opens the page where that setting ALREADY lives —
 * nothing is moved, copied or re-routed (the client, 26 Sep: "master rules and all should be there
 * only"; the hub that moved settings was undone the same day). A card is the page registry entry it
 * names, so it shows only when that page would open for the person (the same rule as the menu, the
 * ⌘K search and the launcher's Business settings), and a page that isn't live yet never shows.
 *
 * Business-level settings (branding, users, roles, billing, audit) are not here: they are on the
 * launcher (layouts/businessSettings.ts).
 *
 * No imports from pageRegistry.ts: the registry reads HRMS_SETTING_IDS for the index's own rule.
 */
export interface HrmsSettingCard {
  /** The page registry id it opens (a tab is "<page>:<tab>"). */
  id: string
  label: string
  /** One line: what is set there. */
  desc: string
  /** Icon name from the design's icon set (design/dc/icons). */
  icon: string
  /**
   * For a page everyone may READ (holidays, policies, shift schedules): at least one of these codes,
   * the right to CHANGE the setting, so the card isn't offered to people who can only look.
   */
  needs?: string[]
}

export interface HrmsSettingGroup { key: string; title: string; icon: string; cards: HrmsSettingCard[] }

export const HRMS_SETTINGS_INDEX: HrmsSettingGroup[] = [
  {
    key: 'organisation', title: 'People & organisation', icon: 'building',
    cards: [
      { id: 'hr-config', label: 'HR configuration', desc: 'Employee IDs, probation, notice, the work week, late arrival and punch-in alerts.', icon: 'settings' },
      { id: 'companies', label: 'Companies & branches', desc: 'Your companies, their branches and where people may punch in.', icon: 'building' },
      { id: 'm-departments', label: 'Departments', desc: 'The departments people belong to.', icon: 'grid' },
      { id: 'm-designations', label: 'Designations', desc: 'Job titles and who each one reports to.', icon: 'briefcase' },
      { id: 'm-grades', label: 'Grades', desc: 'Bands and levels.', icon: 'award' },
      { id: 'm-classifications', label: 'Employee classifications', desc: 'Permanent, contract, intern and your own types.', icon: 'users' },
    ],
  },
  {
    key: 'time', title: 'Time & leave', icon: 'calendarClock',
    cards: [
      { id: 'm-shift-rules', label: 'Shift rules', desc: 'Timings, grace and overtime for each shift.', icon: 'calendarClock' },
      { id: 'att-shifts:schedules', label: 'Shift schedules', desc: 'The shifts people work.', icon: 'clock', needs: ['attendance.workforce.admin'] },
      { id: 'm-leave-rules', label: 'Leave rules', desc: 'Leave types, yearly entitlements, carry forward and encashment.', icon: 'calendarCheck' },
      { id: 'leave:holidays', label: 'Holidays', desc: 'The holiday list for each year and company.', icon: 'calendar', needs: ['settings.holidays.write'] },
    ],
  },
  {
    key: 'pay', title: 'Pay & expenses', icon: 'rupee',
    cards: [
      { id: 'pay-settings', label: 'Payroll settings', desc: 'PF, ESI, professional tax, LWF and the payroll cycle.', icon: 'creditCard' },
      { id: 'components', label: 'Salary components', desc: 'The earnings and deductions payroll works out.', icon: 'rupee' },
      { id: 'm-statutory', label: 'Statutory settings', desc: 'How PF, ESI, PT and LWF apply to salary components.', icon: 'shield' },
      { id: 'expenses:policies', label: 'Expense policies', desc: 'Claim limits and rules.', icon: 'receipt' },
    ],
  },
  {
    key: 'communication', title: 'Messages, documents & tools', icon: 'bell',
    cards: [
      { id: 'notif-templates', label: 'Notification templates', desc: 'The wording of the emails, SMS, push and in-app messages HRMS sends.', icon: 'bell' },
      { id: 'letter-templates', label: 'Letter templates', desc: 'Offer, appointment and experience letters with merge fields.', icon: 'filePen' },
      { id: 'onboarding:templates', label: 'Onboarding checklists', desc: 'The tasks a new joiner goes through.', icon: 'clipboard' },
      { id: 'policies', label: 'Policies', desc: 'Handbooks and policies people read and acknowledge.', icon: 'fileText', needs: ['hrms.policy.write'] },
      { id: 'hr-integrations', label: 'HR integrations', desc: 'Biometric devices and other connected tools.', icon: 'workflow' },
    ],
  },
]

/** Every card the index can show. */
export const HRMS_SETTING_CARDS: readonly HrmsSettingCard[] = HRMS_SETTINGS_INDEX.flatMap((g) => g.cards)
/** Every registry id the index links to. */
export const HRMS_SETTING_IDS: readonly string[] = HRMS_SETTING_CARDS.map((c) => c.id)

/** Whether the person may change this card's setting, beyond opening its page (see {@link HrmsSettingCard.needs}). */
export const mayChange = (c: HrmsSettingCard, has: (code: string) => boolean) => !c.needs || c.needs.some(has)

/** The index's own path (the "Settings" item of the HRMS rail opens it). */
export const HRMS_SETTINGS_PATH = '/hrms/settings-index'

/**
 * The groups and cards this person can open, with each card's path from the registry. `openPaths`
 * maps a registry id to its path for the entries that are OPEN for this person (locked or hidden =
 * absent); `has` is the person's permission check. Empty groups are left out.
 */
export function hrmsSettingsFor(openPaths: ReadonlyMap<string, string>, has: (code: string) => boolean): (Omit<HrmsSettingGroup, 'cards'> & { cards: (HrmsSettingCard & { path: string })[] })[] {
  return HRMS_SETTINGS_INDEX
    .map((g) => ({ ...g, cards: g.cards.flatMap((c) => { const path = openPaths.get(c.id); return path && mayChange(c, has) ? [{ ...c, path }] : [] }) }))
    .filter((g) => g.cards.length > 0)
}
