import { useEffect, useState } from 'react'
import { Notice } from '@althar/ui'

/*
 * Homes are still experimental: said at the head of Connect a home and of
 * Manage homes the first time either opens, and kept while that dialog is
 * open. Remembered for the computer, so every window knows it was said.
 */

const STORED = 'althar.homes.experimental-said'

const said = () => {
  try {
    return window.localStorage.getItem(STORED) === '1'
  } catch {
    return true
  }
}

export const experimentalText = {
  title: 'Homes are still experimental',
  body: 'Expect some rough edges. Report a problem tells us what you run into.',
}

/** The notice, the first time a home is connected or managed; null after. */
export function useExperimental(className?: string) {
  const [shown] = useState(() => !said())
  useEffect(() => {
    if (!shown) return
    try {
      window.localStorage.setItem(STORED, '1')
    } catch {
      // Not kept: said again next time.
    }
  }, [shown])
  return shown ? (
    <Notice icon="flask" title={experimentalText.title} {...(className === undefined ? {} : { className })}>
      {experimentalText.body}
    </Notice>
  ) : null
}
