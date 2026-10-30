import { Button, LinkButton } from '@althar/ui'
import { useState } from 'react'

import type { ErrorMore } from './useTask'
import s from './Task.module.css'

/*
 * What went wrong with an action on Outputs, said in its card: its sentence,
 * the way out where one press puts it right, and, for a push that failed or
 * git's own failure, all git said behind a quiet Details, never in the
 * sentence itself. It sits in the card's error line, so all of it is
 * phrasing content, and long refs and hashes break rather than run off.
 */

export const failureText = {
  connect: (host: string) => `Connect ${host}`,
  retry: 'Try again',
  details: 'Details',
  hideDetails: 'Hide details',
}

export function Failure({
  message,
  more,
  host,
  onConnect,
  onRetry,
}: {
  message: string
  more: ErrorMore | null
  /** The project's code host, and whether Althar is connected to it: connecting is the way out of a sign-in git's own push couldn't give. */
  host: { readonly name: string; readonly connected: boolean } | null
  onConnect: () => void
  /** Does again what failed, where trying again may be all it takes: a host that couldn't be reached, or didn't answer. */
  onRetry?: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const why = more?.why ?? null
  const connect = (why === 'denied' || why === 'unanswered') && host !== null && !host.connected
  const retry = (why === 'unreachable' || why === 'unanswered') && onRetry !== undefined
  const detail = more?.detail ?? null
  return (
    <>
      {message}
      {connect && (
        <>
          {' '}
          <Button size="small" onClick={onConnect}>
            {failureText.connect(host.name)}
          </Button>
        </>
      )}
      {retry && (
        <>
          {' '}
          <Button size="small" onClick={onRetry}>
            {failureText.retry}
          </Button>
        </>
      )}
      {detail !== null && (
        <>
          {' '}
          <LinkButton className={s.failureMore} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {open ? failureText.hideDetails : failureText.details}
          </LinkButton>
          {open && <code className={s.failureDetail}>{detail}</code>}
        </>
      )}
    </>
  )
}
