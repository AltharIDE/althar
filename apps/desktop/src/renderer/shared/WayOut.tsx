import { LinkButton } from '@althar/ui'

import s from './ThreadBlocks.module.css'

/*
 * The way out of an agent's turn that failed, under what went wrong, the
 * same in a task's thread and the coordinator's: what puts it right first,
 * as signing a signed-out agent in again in Settings, or compacting a full
 * context, then Try again, which
 * gives the turn what the person said in it again. Try again alone where
 * trying again can work; nothing where neither is offered.
 */

export const wayOutText = {
  signIn: 'Sign in again',
  compact: 'Compact',
  tryAgain: 'Try again',
}

export interface WayOutProps {
  /** Why the turn failed, as the runtime classes it: `auth_required` is a sign-in to make again. */
  readonly failure: string | undefined
  /** Opens Settings at the agent's sign-in. Without it, no Sign in again. */
  readonly onSignIn?: (() => void) | undefined
  /** Has the agent sum up what it holds, for a context that is full. Without it, no Compact. */
  readonly onCompact?: (() => void) | undefined
  /** Tries the turn again. Without it, no Try again. */
  readonly onTryAgain?: (() => void) | undefined
}

export function WayOut({ failure, onSignIn, onCompact, onTryAgain }: WayOutProps) {
  const signIn = failure === 'auth_required' ? onSignIn : undefined
  const compact = failure === 'context_full' ? onCompact : undefined
  if (signIn === undefined && compact === undefined && onTryAgain === undefined) return null
  return (
    <p className={s.ways}>
      {signIn !== undefined && <LinkButton onClick={signIn}>{wayOutText.signIn}</LinkButton>}
      {compact !== undefined && <LinkButton onClick={compact}>{wayOutText.compact}</LinkButton>}
      {onTryAgain !== undefined && <LinkButton onClick={onTryAgain}>{wayOutText.tryAgain}</LinkButton>}
    </p>
  )
}
