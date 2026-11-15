/**
 * Crash reporting pauses as soon as a new choice arrives, before its file is
 * written. Only the latest write may resume it, using the preference actually
 * kept (also after a failed write). Each change invalidates unfinished reports.
 */
export const crashConsent = (read: () => boolean) => {
  let generation = 0
  let request = 0
  let paused = false
  return {
    allowed: () => !paused && read(),
    generation: () => generation,
    changing: () => {
      const own = ++request
      generation += 1
      paused = true
      let finished = false
      return () => {
        if (finished) return
        finished = true
        if (own !== request) return
        generation += 1
        paused = false
      }
    },
  }
}
