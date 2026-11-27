import { useEffect, useState } from 'react'
import { Notice } from '@althar/ui'

import type { Host } from '../../data/services'

/*
 * Homes are still experimental: said at the head of Connect a home or of
 * Manage homes, whichever opens first in any window, once for the computer,
 * and kept while that dialog is open. The main process claims it for the
 * whole profile (claimOnce.ts), at once and before it is kept in
 * desktop.json, so two windows opening a home's dialog together, or Manage
 * homes then Connect a home while the write is under way, never both say it.
 */

/** Where it is claimed: the main process, for every window. */
export type ExperimentalStore = Pick<Host, 'claimHomesExperimental'>

export const experimentalText = {
  title: 'Homes are still experimental',
  body: 'Expect some rough edges. Report a problem tells us what you run into.',
}

/** The notice, for the one dialog that claimed it; null for every other, and while it is asked. */
export function useExperimental(store: ExperimentalStore | undefined, className?: string) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const claim = store?.claimHomesExperimental
    if (claim === undefined) return
    // Its answer is the dialog's even where the effect ran again since, as StrictMode runs it: the claim is spent either way.
    claim().then(
      (claimed) => {
        if (claimed) setShown(true)
      },
      () => undefined,
    )
  }, [store])
  return shown ? (
    <Notice icon="flask" title={experimentalText.title} {...(className === undefined ? {} : { className })}>
      {experimentalText.body}
    </Notice>
  ) : null
}
