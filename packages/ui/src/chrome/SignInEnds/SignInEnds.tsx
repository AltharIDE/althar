import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './SignInEnds.module.css'

/*
 * An agent's sign-in ends within its last days, or has just ended: the one
 * warning Althar raises about it, in the window's bar beside an update's
 * line, never a banner. It says whose and when, signs in again where that is
 * fixed, and can be put aside: it isn't raised again for the same sign-in.
 * Only the soonest shows; nothing shows while every sign-in is far from its end.
 */

export interface SignInEndsText {
  /** Whose sign-in ends, and by when as the person reads it, the latest its agent gives: Claude Code’s sign-in ends by Mon 14:00. */
  ends: (whose: string, when: string) => string
  ended: (whose: string) => string
  signIn: string
  dismiss: string
}

export const signInEndsText: SignInEndsText = {
  ends: (whose, when) => `${whose}’s sign-in ends by ${when}`,
  ended: (whose) => `${whose}’s sign-in has ended`,
  signIn: 'Sign in again',
  dismiss: 'Dismiss',
}

export type SignInEndsProps = RootProps<
  'output',
  {
    /** Whose sign-in: the agent, with its account where it has several, Claude Code (work). */
    whose: string
    /** When it ends, as the person reads it: Mon 14:00. Leave it out once it has ended. */
    when?: string
    /** Opens the agent's sign-in, started, where it is fixed. */
    onSignIn: () => void
    /** Puts the warning aside for this sign-in. */
    onDismiss: () => void
    text?: Partial<SignInEndsText>
  }
>

export function SignInEnds({ whose, when, onSignIn, onDismiss, text, className, ...rest }: SignInEndsProps) {
  const t = { ...signInEndsText, ...text }
  const says = when === undefined ? t.ended(whose) : t.ends(whose, when)
  return (
    // An output is a live status: the line is read out as it appears.
    <output className={cx(s.line, className)} {...rest}>
      <Icon name="clock" size={12} className={s.icon} />
      <span className={s.says} title={says}>
        {says}
      </span>
      <LinkButton onClick={onSignIn}>{t.signIn}</LinkButton>
      <IconButton icon="close" label={t.dismiss} size="small" onClick={onDismiss} className={s.dismiss} />
    </output>
  )
}
