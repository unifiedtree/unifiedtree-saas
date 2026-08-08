/**
 * Segmented control that flips the /talk-to-us page between the Demo form
 * and the Sales form. Kept dead-simple (two <button>s in a pill) so the
 * page can be re-titled reactively based on `value` without a route change.
 */
export type TalkIntent = 'demo' | 'sales'

export function TalkToUsToggle({
  value,
  onChange,
}: {
  value: TalkIntent
  onChange: (v: TalkIntent) => void
}) {
  const base = 'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors'
  const active = 'bg-[#059669] text-white'
  const idle = 'text-text-secondary hover:text-text-primary'
  return (
    <div
      role="tablist"
      aria-label="Contact type"
      className="mx-auto flex max-w-sm rounded-xl border border-border bg-white p-1 shadow-sm"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'demo'}
        className={`${base} ${value === 'demo' ? active : idle}`}
        onClick={() => onChange('demo')}
      >
        Request a demo
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'sales'}
        className={`${base} ${value === 'sales' ? active : idle}`}
        onClick={() => onChange('sales')}
      >
        Contact sales
      </button>
    </div>
  )
}
