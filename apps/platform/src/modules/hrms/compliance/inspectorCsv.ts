type InspectionRecord = { title: string; date: string; category?: string; status: string }
function cell(value: string | undefined) {
  const text = value || ''
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe = /^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text
  return '"' + safe.replace(/"/g, '""') + '"'
}
export function inspectorCsv(records: InspectionRecord[]) {
  return (
    [
      'Obligation / filing,Due date,Category,Status',
      ...records.map((record) =>
        [record.title, record.date, record.category, record.status].map(cell).join(',')
      ),
    ].join('\r\n') + '\r\n'
  )
}
