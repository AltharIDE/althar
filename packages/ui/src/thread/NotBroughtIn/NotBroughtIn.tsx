import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import s from './NotBroughtIn.module.css'

/*
 * What was picked to bring in from other tools and didn't come in, said in the project's conversation, where it stays: the
 * window moved on as it brought them in, so this is where the person learns of it. Each by name and why; Try again where
 * another try could bring it in, which brings in only what is still missing (twice is once). Tried, a new line says what
 * still didn't come in, if anything.
 */

export interface NotBroughtInText {
  tryAgain: string
  trying: string
  tried: string
}

export const notBroughtInText: NotBroughtInText = {
  tryAgain: 'Try again',
  trying: 'Trying again…',
  tried: 'Tried again.',
}

export interface NotBroughtInProps {
  /** What it says: Not everything picked from other tools came in. */
  title: string
  /** What didn't come in, by name, and why; where all of it is down to one why, `error` says it and each has none. */
  missed: ReadonlyArray<{ readonly name: string; readonly why: string }>
  /** Try again, where another try could bring something in; left out where none could. */
  onTryAgain?: () => void
  /** Tried again: under way, or done. Left out before. */
  tried?: 'trying' | 'tried'
  /** Why trying again didn't go through, in a line. */
  error?: string | null
  text?: Partial<NotBroughtInText>
}

export function NotBroughtIn({ title, missed, onTryAgain, tried, error, text }: NotBroughtInProps) {
  const t = { ...notBroughtInText, ...text }
  return (
    <div className={s.missed} data-busy={tried === 'trying' || undefined}>
      <p className={s.line}>
        <span className={s.title}>{title}</span>
        {onTryAgain !== undefined &&
          (tried === undefined ? (
            <LinkButton onClick={onTryAgain}>{t.tryAgain}</LinkButton>
          ) : (
            <span>{tried === 'trying' ? t.trying : t.tried}</span>
          ))}
      </p>
      {missed.length > 0 && (
        <ul className={s.list}>
          {missed.map((one, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- Two picked can share a name; the list never reorders.
            <li key={index}>
              <span className={s.name}>
                {one.name}
                {one.why === '' ? '' : ':'}
              </span>
              {one.why === '' ? '' : ` ${one.why}`}
            </li>
          ))}
        </ul>
      )}
      {error != null && error !== '' && <Problem size="small">{error}</Problem>}
    </div>
  )
}
