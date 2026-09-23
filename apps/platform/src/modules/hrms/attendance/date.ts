/** Attendance business date: shared with the backend's Asia/Kolkata clock. */
export function attendanceDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const field = (name: string) => parts.find(part => part.type === name)!.value
  return `${field('year')}-${field('month')}-${field('day')}`
}
