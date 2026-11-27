import { useEffect, useState } from 'react'
import { Notice } from '@althar/ui'

import type { Host } from '../../data/services'

/*
 * Homes are still experimental: said at the head of Connect a home and of
 * Manage homes the first time either opens, and kept while that dialog is
 * open. Whether it was said is the app's own preference, in the profile's
 * desktop.json, so it is said once for the computer: a home's window keeps
 * its storage apart from this computer's, and reads the same preference.
 * Read afresh as the dialog opens, so another window's saying it counts.
 */

/** Where it is kept: the app's preferences, through the main process. */
export type ExperimentalStore = Pick<Host, 'preferences' | 'setPreference'>

export const experimentalText = {
  title: 'Homes are still experimental',
  body: 'Expect some rough edges. Report a problem tells us what you run into.',
}

/** The notice, the first time a home is connected or managed in any window; null after, and while that is read. */
export function useExperimental(store: ExperimentalStore | undefined, className?: string) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (store === undefined) return
    let live = true
    store.preferences().then(
      (preferences) => {
        if (!live || preferences.homesExperimentalSaid) return
        setShown(true)
        // Not kept: said again next time, which is no harm.
        store.setPreference('homesExperimentalSaid', true).catch(() => undefined)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [store])
  return shown ? (
    <Notice icon="flask" title={experimentalText.title} {...(className === undefined ? {} : { className })}>
      {experimentalText.body}
    </Notice>
  ) : null
}
