/** Local calendar day for an ISO timestamp. Missing or odd stamps fall on today. */
export function dayOf(stamp: string | undefined, now: Date = new Date()): string {
  const date = stamp ? new Date(stamp) : now
  const safe = Number.isNaN(date.getTime()) ? now : date
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${safe.getFullYear()}-${pad(safe.getMonth() + 1)}-${pad(safe.getDate())}`
}

/** The last `count` days ending today, oldest first. */
export function lastDays(now: Date, count: number, endOffset = 0): string[] {
  const out: string[] = []
  for (let back = count - 1 + endOffset; back >= endOffset; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    out.push(dayOf(date.toISOString(), now))
  }
  return out
}

/** "YYYY-MM" moved by `by` months. */
export function shiftMonth(yearMonth: string, by: number): string {
  const [year, month] = yearMonth.split('-').map(Number)
  const date = new Date(year, month - 1 + by, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** How many days the month of `now` has. */
export function daysInMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
}
