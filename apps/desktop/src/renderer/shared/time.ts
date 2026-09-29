/*
 * Times as the thread says them: "just now", "4m ago", "2h ago", then the
 * date. The kit's components take them already written.
 */

export const ago = (iso: string, now: Date = new Date()): string => {
  const then = new Date(iso)
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** How long something took, from two instants: "12s", "3m 5s", "1h 4m". */
export const took = (from: string, to: string): string => {
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
