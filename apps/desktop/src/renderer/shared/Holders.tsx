import type { Holder } from '@althar/contracts'

import s from './Holders.module.css'

/*
 * Who holds the places a waiting task waits for (ADR-037): the tasks at
 * work, each from its first step until its work comes back.
 */

export const text = {
  heldBy: (holders: ReadonlyArray<Pick<Holder, 'title'>>) => `Held by ${holders.map((holder) => holder.title).join(', ')}`,
}

export function Holders({ holders }: { readonly holders: ReadonlyArray<Holder> | undefined }) {
  if (holders === undefined || holders.length === 0) return null
  return <p className={s.held}>{text.heldBy(holders)}</p>
}
