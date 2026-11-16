import { LinkButton, Problem } from '@althar/ui'

import s from './ThreadBlocks.module.css'

/*
 * An agent's turn that failed, the same in a task's thread and the
 * coordinator's: what went wrong as a problem, in Althar's plain words, and
 * beside it the way out: what puts it right first, as signing a signed-out
 * agent in again in Settings, or compacting a full context, then Try again,
 * which gives the turn what the person said in it again. Try again alone
 * where trying again can work; nothing where neither is offered. The
 * agent's own words follow, quieter, only where they say more.
 */

export const wayOutText = {
  signIn: 'Sign in again',
  compact: 'Compact',
  tryAgain: 'Try again',
}

/* What an agent says when it is only signed out: Althar's line already says so. */
const ONLY_SIGNED_OUT =
  /signed out|auth(entication|orization)? (is )?required|not (authenticated|signed in|logged in)|unauthori[sz]ed|(log|sign) ?in (is )?required/i

/** The agent's own words, where they say more than Althar's plain line for the failure. */
export const saysMore = (failure: string | undefined, said: string | null | undefined, line?: string): said is string => {
  if (said === undefined || said === null || said.trim() === '') return false
  const bare = (words: string) => words.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (line !== undefined && bare(said) === bare(line)) return false
  return !((failure === 'auth_required' || failure === 'signed_out') && ONLY_SIGNED_OUT.test(said))
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

/** The ways out, side by side; nothing where none is offered. */
export function WayOut({ failure, onSignIn, onCompact, onTryAgain }: WayOutProps) {
  const signIn = failure === 'auth_required' ? onSignIn : undefined
  const compact = failure === 'context_full' ? onCompact : undefined
  if (signIn === undefined && compact === undefined && onTryAgain === undefined) return null
  return (
    <span className={s.ways}>
      {signIn !== undefined && <LinkButton onClick={signIn}>{wayOutText.signIn}</LinkButton>}
      {compact !== undefined && <LinkButton onClick={compact}>{wayOutText.compact}</LinkButton>}
      {onTryAgain !== undefined && <LinkButton onClick={onTryAgain}>{wayOutText.tryAgain}</LinkButton>}
    </span>
  )
}

export interface FailedTurnProps extends WayOutProps {
  /** What went wrong, in Althar's words. */
  readonly text: string
  /** The agent's own words for it. */
  readonly detail?: string | undefined
}

/** A failed turn: the problem, its way out beside it, and the agent's words under it where they say more. */
export function FailedTurn({ text, detail, ...ways }: FailedTurnProps) {
  return (
    <Problem as="div" className={s.failed} action={<WayOut {...ways} />}>
      {text}
      {saysMore(ways.failure, detail, text) && <span className={s.detail}>{detail}</span>}
    </Problem>
  )
}
