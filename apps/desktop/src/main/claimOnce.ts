/*
 * A note said once for the whole profile, whichever window asks first: the
 * first ask claims it at once, in the main process, before it is kept on
 * disk, so two windows asking together, or one dialog after another while
 * the write is under way, never both get it. Kept after, so a later launch
 * knows too. Pure, so it is tested without Electron.
 */

/** Claims it: true for the first ask in the profile's life where it wasn't said before, false for every other. */
export const claimOnce = (said: () => Promise<boolean>, keep: () => Promise<unknown>): (() => Promise<boolean>) => {
  let first: Promise<boolean> | undefined
  return () => {
    if (first !== undefined) return first.then(() => false)
    first = said().then(
      (already) => {
        if (already) return false
        // Not kept: said again next launch, which is no harm.
        keep().catch(() => undefined)
        return true
      },
      () => false,
    )
    return first
  }
}
